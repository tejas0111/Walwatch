import { Transaction, type TransactionArgument } from '@mysten/sui/transactions';
import { SuiJsonRpcClient, SuiObjectResponse } from '@mysten/sui/jsonRpc';
import { getZkLoginSignature } from '@mysten/sui/zklogin';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import pino from 'pino';
import { withRetry } from '../lib/retry.js';
import { SuiClientPool, createPoolFromEnv } from '../lib/sui-pool.js';
import { config } from '../config.js';
import { selectGasCoin } from './gas-wallet-service.js';
import { getDb } from '../db/index.js';
import { users, subscriptions } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import crypto from 'node:crypto';

const logger = pino({ name: 'vault-service' });

function extractBalanceValue(balanceField: unknown): string {
  if (!balanceField) return '0';
  if (typeof balanceField === 'string') return balanceField;
  if (typeof balanceField === 'number') return String(balanceField);
  if (typeof balanceField === 'object') {
    const obj = balanceField as Record<string, unknown>;
    // Try direct value first (common v2 Sui response format)
    if (typeof (obj as any).value === 'string') return (obj as any).value;
    if (typeof (obj as any).value === 'number') return String((obj as any).value);
    // Try nested fields (v1 / nested object format)
    if (obj.fields && typeof obj.fields === 'object') {
      const f = obj.fields as Record<string, unknown>;
      if (typeof f.value === 'string') return f.value;
      if (typeof f.value === 'number') return String(f.value);
    }
  }
  logger.warn({ balanceField }, 'Unexpected balance field shape — returning 0');
  return '0';
}

const PACKAGE_ID = config.packageId;
const SYSTEM_OBJECT_ID = config.systemObjectId;
const WAL_COIN_TYPE = config.walCoinType;

const FEE_CONFIG_OBJECT_ID = process.env.FEE_CONFIG_OBJECT_ID || '';

// Load gas wallet key into module-level variable, then scrub from env
// to prevent accidental leaks to child processes or crash dumps.
const GAS_WALLET_PRIMARY_KEY = process.env.GAS_WALLET_PRIMARY_KEY || '';
delete process.env.GAS_WALLET_PRIMARY_KEY;

// Shared Redis client singleton — prevents connection leaks from per-call clients.
let redisClient: ReturnType<typeof import('redis').createClient> | null = null;
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

async function getRedis(): Promise<ReturnType<typeof import('redis').createClient>> {
  if (redisClient?.isOpen) return redisClient;
  const { default: redis } = await import('redis');
  redisClient = redis.createClient({ url: REDIS_URL });
  redisClient.on('error', (err: Error) => logger.error({ err }, 'Redis client error'));
  await redisClient.connect();
  return redisClient;
}

interface CreateVaultRequest {
  wallet_address: string;
  blob_id: string;
  initial_wal_amount: string;
  renew_threshold_epochs: number;
  renew_by_epochs: number;
  max_total_epochs: number;
}

interface DepositRequest {
  wallet_address: string;
  amount: string;
}

interface UpdatePolicyRequest {
  wallet_address: string;
  renew_threshold_epochs: number;
  renew_by_epochs: number;
  max_total_epochs: number;
  active: boolean;
}

interface WithdrawRequest {
  wallet_address: string;
  amount: string;
}

interface ReclaimRequest {
  wallet_address: string;
}

interface VaultInfo {
  id: string;
  beneficiary: string;
  blobId: string;
  walBalance: string;
  policy: {
    renewThresholdEpochs: number;
    renewByEpochs: number;
    maxTotalEpochs: number | null;
    active: boolean;
  };
  totalRenewals: number;
  totalFeesPaid: string;
  createdAtEpoch: number;
  withdrawDelayEpochs: number;
  pendingWithdrawAmount: number;
  pendingWithdrawInitEpoch: number;
}

interface RenewalEvent {
  type: string;
  timestamp: string;
  vaultId: string;
  data: Record<string, unknown>;
}

export class SpendCapExceededError extends Error {
  constructor(limit: string) { super(`Spend cap exceeded: ${limit}`); }
}


const LOCK_TTL_MS = 30_000;

// Lua script for atomic compare-and-delete: only deletes `key` if its value
// matches `token`. Prevents a delayed process from releasing someone else's lock.
const COMPARE_AND_DELETE_SCRIPT = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
  else
    return 0
  end
`;

async function acquireLock(key: string, ttlMs: number): Promise<string | null> {
  try {
    const token = crypto.randomUUID();
    const r = await getRedis();
    const acquired = await r.setNX(key, token);
    if (acquired === 1) {
      await r.pExpire(key, ttlMs);
      return token;
    }
    return null;
  } catch {
    return null;
  }
}

async function releaseLock(key: string, token: string): Promise<void> {
  try {
    const r = await getRedis();
    await r.eval(COMPARE_AND_DELETE_SCRIPT, { keys: [key], arguments: [token] });
  } catch {
  }
}

async function withAddressLock<T>(address: string, fn: () => Promise<T>): Promise<T> {
  const lockKey = `gaslock:${address}`;
  const deadline = Date.now() + LOCK_TTL_MS * 2;
  let delay = 100;
  while (Date.now() < deadline) {
    const token = await acquireLock(lockKey, LOCK_TTL_MS);
    if (token !== null) {
      try {
        return await fn();
      } finally {
        await releaseLock(lockKey, token);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 2, 1000);
  }
  throw new Error(`Could not acquire lock for gas wallet ${address}`);
}

async function getUserZkLoginData(userId: string): Promise<{
  zkloginAddress: string;
  jwtRandomness: string;
  zkloginMaxEpoch: number | null;
}> {
  const db = getDb();
  const [user] = await db.select({
    zkloginAddress: users.zkloginAddress,
    zkloginJwtRandomness: users.zkloginJwtRandomness,
    zkloginMaxEpoch: users.zkloginMaxEpoch,
  }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user?.zkloginAddress) {
    throw new Error('User has no zkLogin address. Complete OAuth login first.');
  }
  return {
    zkloginAddress: user.zkloginAddress,
    jwtRandomness: user.zkloginJwtRandomness || '',
    zkloginMaxEpoch: user.zkloginMaxEpoch,
  };
}

async function buildAndReturnTxBytes(
  tx: Transaction,
  userId: string,
  gasBudget: number,
): Promise<{ txBytes: string; sender: string }> {
  const pool = createPoolFromEnv({ threshold: 3, timeout: 30_000 });
  const { zkloginAddress } = await getUserZkLoginData(userId);

  tx.setSender(zkloginAddress);
  tx.setGasBudget(gasBudget);

  const gasWalletBytes = Uint8Array.from(Buffer.from(GAS_WALLET_PRIMARY_KEY, 'hex'));
  const gasWalletKp = Ed25519Keypair.fromSecretKey(gasWalletBytes);
  const gasWalletAddress = gasWalletKp.toSuiAddress();

  return withAddressLock(gasWalletAddress, async () => {
    const gasRef = await selectGasCoin(gasWalletAddress);
    tx.setGasPayment([gasRef]);

    const bytes = await pool.call(async (client) => tx.build({ client }));

    return { txBytes: Buffer.from(bytes).toString('base64'), sender: zkloginAddress };
  });
}

async function submitUserSignedTx(
  txBytesBase64: string,
  userSignature: string,
  zkloginProof: any,
  maxEpoch: number,
  gasBudget: number,
): Promise<{ digest: string; effects: Record<string, unknown> }> {
  const pool = createPoolFromEnv({ threshold: 3, timeout: 30_000 });
  const bytes = Uint8Array.from(Buffer.from(txBytesBase64, 'base64'));

  const zkLoginSig = getZkLoginSignature({
    inputs: zkloginProof,
    maxEpoch,
    userSignature,
  });

  const gasWalletBytes = Uint8Array.from(Buffer.from(GAS_WALLET_PRIMARY_KEY, 'hex'));
  const gasWalletKp = Ed25519Keypair.fromSecretKey(gasWalletBytes);
  const gasSig = (await gasWalletKp.signTransaction(bytes)).signature;

  return pool.call(async (client) => {
    // Note: SuiJsonRpcClient uses executeTransactionBlock in the installed v2 SDK.
    // The deprecated method name still works; the key v2 upgrade (Transaction class) is already in use.
    const result = await client.executeTransactionBlock({
      transactionBlock: bytes,
      signature: [zkLoginSig, gasSig],
      options: { showEffects: true },
    });
    return {
      digest: result.digest,
      effects: (result.effects || {}) as Record<string, unknown>,
    };
  });
}

async function getSpendTotal(orgId: string, windowMs: number): Promise<number> {
  try {
    const r = await getRedis();
    const key = `spend:${orgId}:total:${windowMs}`;
    const val = await r.get(key);
    return val ? Number(val) : 0;
  } catch (err) {
    logger.warn({ err }, 'Spend cap check failed — allowing through (fallback mode)');
    return 0;
  }
}

async function recordSpend(orgId: string, amount: number): Promise<void> {
  try {
    const r = await getRedis();
    const dayKey = `spend:${orgId}:total:${86400000}`;
    await r.incrBy(dayKey, amount);
    await r.expire(dayKey, 86401);
  } catch (err) {
    logger.warn({ err }, 'Spend recording failed — continuing (fallback mode)');
  }
}

async function getPlanLimits(orgId: string): Promise<{ maxPerTx: number; maxPerDay: number }> {
  try {
    const db = getDb();
    const [sub] = await db.select({ plan: subscriptions.plan })
      .from(subscriptions)
      .where(eq(subscriptions.orgId, orgId))
      .limit(1);
    const plan = sub?.plan || 'free';
    switch (plan) {
      case 'enterprise': return { maxPerTx: 10000, maxPerDay: 50000 };
      case 'pro': return { maxPerTx: 1000, maxPerDay: 5000 };
      default: return { maxPerTx: 100, maxPerDay: 500 };
    }
  } catch {
    return { maxPerTx: 100, maxPerDay: 500 };
  }
}

async function checkWithdrawCaps(orgId: string, amount: number): Promise<void> {
  const limits = await getPlanLimits(orgId);
  if (amount > limits.maxPerTx) throw new SpendCapExceededError(`${limits.maxPerTx} WAL per tx`);
  const dayTotal = await getSpendTotal(orgId, 86400000);
  if (dayTotal + amount > limits.maxPerDay) throw new SpendCapExceededError(`${limits.maxPerDay} WAL per day`);
  await recordSpend(orgId, amount);
}

export class VaultService {
  private pool: SuiClientPool;

  constructor() {
    this.pool = createPoolFromEnv({ threshold: 3, timeout: 30_000 });
  }

  async buildCreateVaultTx(
    userId: string,
    orgId: string,
    params: {
      blobId: string;
      amount: number;
      threshold: number;
      extension: number;
      maxEpochs: number;
    },
  ): Promise<{ txBytes: string; sender: string; vaultId: string }> {
    this.ensurePackageId();
    return withAddressLock(userId, async () => {
      const { zkloginAddress } = await getUserZkLoginData(userId);
      const tx = new Transaction();
      const walCoinArg = await this.selectWalCoin(
        tx,
        zkloginAddress,
        params.amount,
      );

      const withdrawDelayEpochs = 3;

      tx.moveCall({
        target: `${PACKAGE_ID}::vault::create_vault`,
        arguments: [
          tx.object(FEE_CONFIG_OBJECT_ID),
          tx.object(params.blobId),
          walCoinArg,
          tx.pure.u64(params.threshold),
          tx.pure.u64(params.extension),
          tx.pure.u64(params.maxEpochs),
          tx.pure.address(zkloginAddress),
          tx.pure.u64(withdrawDelayEpochs),
        ],
      });

      const { txBytes, sender } = await buildAndReturnTxBytes(tx, userId, 10_000_000);
      return { txBytes, sender, vaultId: '' };
    });
  }

  async buildDepositTx(
    userId: string,
    vaultId: string,
    amount: number,
  ): Promise<{ txBytes: string; sender: string }> {
    this.ensurePackageId();
    return withAddressLock(userId, async () => {
      const { zkloginAddress } = await getUserZkLoginData(userId);
      const tx = new Transaction();
      const walCoinArg = await this.selectWalCoin(tx, zkloginAddress, amount);

      tx.moveCall({
        target: `${PACKAGE_ID}::vault::deposit`,
        arguments: [
          tx.object(FEE_CONFIG_OBJECT_ID),
          tx.object(vaultId),
          walCoinArg,
        ],
      });

      return buildAndReturnTxBytes(tx, userId, 5_000_000);
    });
  }

  async buildWithdrawTx(
    userId: string,
    orgId: string,
    vaultId: string,
    amount: number,
  ): Promise<{ txBytes: string; sender: string }> {
    this.ensurePackageId();
    await checkWithdrawCaps(orgId, amount);

    return withAddressLock(userId, async () => {
      const tx = new Transaction();
      tx.moveCall({
        target: `${PACKAGE_ID}::vault::initiate_withdraw`,
        arguments: [
          tx.object(vaultId),
          tx.pure.u64(amount),
        ],
      });

      return buildAndReturnTxBytes(tx, userId, 5_000_000);
    });
  }

  async buildUpdatePolicyTx(
    userId: string,
    vaultId: string,
    request: UpdatePolicyRequest,
  ): Promise<{ txBytes: string; sender: string }> {
    this.ensurePackageId();
    return withAddressLock(userId, async () => {
      const tx = new Transaction();

      tx.moveCall({
        target: `${PACKAGE_ID}::vault::update_policy_fields`,
        arguments: [
          tx.object(FEE_CONFIG_OBJECT_ID),
          tx.object(vaultId),
          tx.pure.u64(request.renew_threshold_epochs),
          tx.pure.u64(request.renew_by_epochs),
          tx.pure.u64(request.max_total_epochs),
          tx.pure.bool(request.active),
        ],
      });

      return buildAndReturnTxBytes(tx, userId, 5_000_000);
    });
  }

  async buildReclaimTx(
    userId: string,
    vaultId: string,
  ): Promise<{ txBytes: string; sender: string }> {
    this.ensurePackageId();
    return withAddressLock(userId, async () => {
      const tx = new Transaction();

      tx.moveCall({
        target: `${PACKAGE_ID}::vault::reclaim_blob`,
        arguments: [
          tx.object(vaultId),
        ],
      });

      return buildAndReturnTxBytes(tx, userId, 5_000_000);
    });
  }

  async submitTx(bytes: {
    txBytes: string;
    userSignature: string;
    zkloginProof: any;
    maxEpoch: number;
  }): Promise<{ digest: string }> {
    const { digest } = await submitUserSignedTx(
      bytes.txBytes,
      bytes.userSignature,
      bytes.zkloginProof,
      bytes.maxEpoch,
      10_000_000,
    );
    return { digest };
  }

  private async selectWalCoin(
    tx: Transaction,
    ownerAddress: string,
    amountStr: number | string,
  ): Promise<TransactionArgument> {
    this.ensureWalCoinType();
    const amount = BigInt(amountStr);

    const coins = await withRetry(async () => {
      return await this.pool.call(async (client) => {
        return await client.getCoins({
          owner: ownerAddress,
          coinType: WAL_COIN_TYPE,
        });
      });
    }, { maxRetries: 3, label: 'selectWalCoin', baseDelay: 1000 });

    if (!coins.data || coins.data.length === 0) {
      throw new Error(`No WAL coins found for address ${ownerAddress}`);
    }

    const totalAvailable = coins.data.reduce(
      (sum, c) => sum + BigInt(c.balance),
      BigInt(0),
    );

    if (totalAvailable < amount) {
      throw new Error(
        `Insufficient WAL balance: requested ${amountStr} but only ${totalAvailable} available.`,
      );
    }

    const primaryCoin = coins.data[0];
    let walInput: TransactionArgument = tx.object(primaryCoin.coinObjectId);

    if (coins.data.length > 1) {
      const restCoins = coins.data.slice(1).map((c) => tx.object(c.coinObjectId));
      tx.mergeCoins(walInput, restCoins);
    }

    const primaryBalance = BigInt(primaryCoin.balance);
    if (amount < (coins.data.length > 1 ? totalAvailable : primaryBalance)) {
      const [splitCoin] = tx.splitCoins(walInput, [tx.pure.u64(amount)]);
      walInput = splitCoin;
    }

    return walInput;
  }

  async getVaultById(vaultId: string): Promise<VaultInfo | null> {
    if (!PACKAGE_ID) {
      logger.warn('PACKAGE_ID not set — cannot look up vault by ID');
      return null;
    }

    try {
      return await withRetry(async () => {
        return await this.pool.call(async (client) => {
          const result = await client.getObject({
            id: vaultId,
            options: { showContent: true, showType: true },
          });

          if (!result.data?.content || result.data.content.dataType !== 'moveObject') {
            return null;
          }

          const content = result.data.content as { fields: Record<string, unknown> };
          const fields = content.fields;
          const policyFields = (fields.policy as { fields: Record<string, unknown> } | undefined)?.fields || {};

          const blobOption = (fields.blob as { vec?: Array<{ fields: Record<string, unknown> }> } | undefined)?.vec;
          const blobData = blobOption?.[0]?.fields;
          const blobId = blobData?.blob_id?.toString() || '';

          return {
            id: result.data.objectId,
            beneficiary: String(fields.beneficiary || ''),
            blobId,
            walBalance: extractBalanceValue(fields.wal_balance),
            policy: {
              renewThresholdEpochs: parseInt(String(policyFields.renew_threshold_epochs || '0'), 10),
              renewByEpochs: parseInt(String(policyFields.renew_by_epochs || '0'), 10),
              maxTotalEpochs: policyFields.max_total_epochs
                ? parseInt(String(policyFields.max_total_epochs), 10)
                : null,
              active: policyFields.active === true,
            },
            totalRenewals: parseInt(String(fields.total_renewals_executed || '0'), 10),
            totalFeesPaid: String(fields.total_fees_paid || '0'),
            createdAtEpoch: parseInt(String(fields.created_at_epoch || '0'), 10),
            withdrawDelayEpochs: parseInt(String((fields.withdraw_delay_epochs as string) || '0'), 10),
            pendingWithdrawAmount: parseInt(String((fields.pending_withdraw_amount as string) || '0'), 10),
            pendingWithdrawInitEpoch: parseInt(String((fields.pending_withdraw_init_epoch as string) || '0'), 10),
          };
        });
      }, { maxRetries: 3, label: 'getVaultById', baseDelay: 1000 });
    } catch (error) {
      logger.error({ error, vaultId }, 'Failed to get vault by ID');
      return null;
    }
  }

  async getVaults(walletAddress: string): Promise<VaultInfo[]> {
    if (!PACKAGE_ID) {
      logger.warn('PACKAGE_ID not set — returning empty vault list');
      return [];
    }

    const vaultType = `${PACKAGE_ID}::vault::RenewalVault`;

    try {
      return await withRetry(async () => {
        return await this.pool.call(async (client) => {
          const result = await client.call<{ data: SuiObjectResponse[] }>('suix_queryObjects', [
            { filter: { StructType: vaultType }, options: { showContent: true, showType: true } },
            null,
            50,
          ]);

          if (!result.data) return [];

          return result.data
            .filter((obj: SuiObjectResponse) => {
              if (!obj.data?.content || obj.data.content.dataType !== 'moveObject') return false;
              const content = obj.data.content as { fields: Record<string, unknown> };
              return content.fields?.beneficiary === walletAddress;
            })
            .map((obj: SuiObjectResponse) => {
              const content = obj.data!.content as { fields: Record<string, unknown> };
              const fields = content.fields;
              const policyFields = (fields.policy as { fields: Record<string, unknown> } | undefined)?.fields || {};

              const blobOption = (fields.blob as { vec?: Array<{ fields: Record<string, unknown> }> } | undefined)?.vec;
              const blobData = blobOption?.[0]?.fields;
              const blobId = blobData?.blob_id?.toString() || '';

              return {
                id: obj.data!.objectId,
                beneficiary: String(fields.beneficiary || ''),
                blobId,
                walBalance: extractBalanceValue(fields.wal_balance),
                policy: {
                  renewThresholdEpochs: parseInt(String(policyFields.renew_threshold_epochs || '0'), 10),
                  renewByEpochs: parseInt(String(policyFields.renew_by_epochs || '0'), 10),
                  maxTotalEpochs: policyFields.max_total_epochs
                    ? parseInt(String(policyFields.max_total_epochs), 10)
                    : null,
                  active: policyFields.active === true,
                },
                totalRenewals: parseInt(String(fields.total_renewals_executed || '0'), 10),
                totalFeesPaid: String(fields.total_fees_paid || '0'),
                createdAtEpoch: parseInt(String(fields.created_at_epoch || '0'), 10),
                withdrawDelayEpochs: parseInt(String((fields.withdraw_delay_epochs as string) || '0'), 10),
                pendingWithdrawAmount: parseInt(String((fields.pending_withdraw_amount as string) || '0'), 10),
                pendingWithdrawInitEpoch: parseInt(String((fields.pending_withdraw_init_epoch as string) || '0'), 10),
              };
            });
        });
      }, { maxRetries: 3, label: 'getVaults', baseDelay: 1000 });
    } catch (error) {
      logger.error({ error, walletAddress }, 'Failed to get vaults');
      return [];
    }
  }

  async getVaultHistory(
    vaultId: string,
    page: number,
    limit: number,
  ): Promise<RenewalEvent[]> {
    if (!PACKAGE_ID) {
      logger.warn('PACKAGE_ID not set — returning empty history');
      return [];
    }

    const eventType = `${PACKAGE_ID}::vault::RenewalExecuted`;
    const cappedLimit = Math.min(Math.max(1, limit), 100);

    try {
      return await withRetry(async () => {
        return await this.pool.call(async (client) => {
          const result = await client.queryEvents({
            query: { MoveEventType: eventType },
            limit: cappedLimit,
            order: 'descending',
          });

          if (!result.data) return [];

          return result.data
            .filter((event) => {
              const parsed = event.parsedJson as Record<string, unknown> | null;
              return parsed?.vault_id === vaultId;
            })
            .map((event) => ({
              type: event.type,
              timestamp: event.timestampMs || '',
              vaultId,
              data: (event.parsedJson as Record<string, unknown>) || {},
            }));
        });
      }, { maxRetries: 3, label: 'getVaultHistory', baseDelay: 1000 });
    } catch (error) {
      logger.error({ error, vaultId }, 'Failed to get vault history');
      return [];
    }
  }

  async getFeeConfig(): Promise<{
    treasury: string;
    protocolFeeBps: number;
    keeperFee: number;
    storagePrice: number;
    version: number;
    paused: boolean;
  } | null> {
    if (!PACKAGE_ID) {
      logger.warn('PACKAGE_ID not set — cannot fetch FeeConfig');
      return null;
    }

    if (this.cachedFeeConfig && Date.now() - this.cachedFeeConfig.fetchedAt < this.feeConfigCacheTtl) {
      return this.cachedFeeConfig;
    }

    try {
      const result = await withRetry(async () => {
        return await this.pool.call(async (client) => {
          const objects = await client.call<{ data: Array<{ data: { objectId: string; content: { fields: Record<string, unknown> } } }> }>('suix_queryObjects', [
            { filter: { StructType: `${PACKAGE_ID}::vault::FeeConfig` }, options: { showContent: true } },
            null,
            10,
          ]);

          if (!objects.data || objects.data.length === 0) return null;
          const fields = objects.data[0].data.content.fields;

          const cached = {
            treasury: String(fields.treasury || ''),
            protocolFeeBps: parseInt(String(fields.protocol_fee_bps || '0'), 10),
            keeperFee: parseInt(String(fields.keeper_fee || '0'), 10),
            storagePrice: parseInt(String(fields.storage_price_per_epoch || '0'), 10),
            version: parseInt(String(fields.version || '0'), 10),
            paused: fields.paused === true,
            fetchedAt: Date.now(),
          };

          this.cachedFeeConfig = cached;
          return cached;
        });
      }, { maxRetries: 2, label: 'getFeeConfig', baseDelay: 1000 });

      return result;
    } catch (error) {
      logger.error({ error }, 'Failed to fetch FeeConfig — invalidating cache');
      this.cachedFeeConfig = null;
      return null;
    }
  }

  invalidateFeeConfigCache(): void {
    this.cachedFeeConfig = null;
  }

  private cachedFeeConfig: {
    treasury: string;
    protocolFeeBps: number;
    keeperFee: number;
    storagePrice: number;
    version: number;
    paused: boolean;
    fetchedAt: number;
  } | null = null;

  private readonly feeConfigCacheTtl = config.feeConfigCacheTtlMs;

  private ensurePackageId(): void {
    if (!PACKAGE_ID) {
      throw new Error(
        'PACKAGE_ID environment variable is not set. ' +
          'Deploy the Move contract and set PACKAGE_ID before calling transaction-building methods.',
      );
    }
  }

  private ensureWalCoinType(): void {
    if (!WAL_COIN_TYPE) {
      throw new Error(
        'WAL_COIN_TYPE environment variable is not set. ' +
          'Set it to the full WAL coin type, e.g. "0x...::wal::WAL".',
      );
    }
  }
}
