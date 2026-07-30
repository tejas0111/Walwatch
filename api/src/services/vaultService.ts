import { SuiObjectResponse } from '@mysten/sui/jsonRpc';
import { Transaction, type TransactionArgument } from '@mysten/sui/transactions';
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { getZkLoginSignature } from '@mysten/sui/zklogin';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import pino from 'pino';
import { withRetry } from '../lib/retry.js';
import { SuiClientPool, createPoolFromEnv } from '../lib/sui-pool.js';
import { decrypt } from '../lib/encryption.js';
import { config } from '../config.js';
import { selectGasCoin } from './gas-wallet-service.js';
import { getDb } from '../db/index.js';
import { users, subscriptions } from '../db/schema.js';
import { eq } from 'drizzle-orm';

const logger = pino({ name: 'vault-service' });

function extractBalanceValue(balanceField: unknown): string {
  if (!balanceField) return '0';
  if (typeof balanceField === 'string') return balanceField;
  if (typeof balanceField === 'number') return String(balanceField);
  if (typeof balanceField === 'object') {
    const obj = balanceField as Record<string, unknown>;
    if (obj.fields && typeof obj.fields === 'object') {
      const f = obj.fields as Record<string, unknown>;
      if (typeof f.value === 'string') return f.value;
      if (typeof f.value === 'number') return String(f.value);
    }
  }
  return '0';
}

const PACKAGE_ID = config.packageId;
const SYSTEM_OBJECT_ID = config.systemObjectId;
const WAL_COIN_TYPE = config.walCoinType;

const FEE_CONFIG_OBJECT_ID = process.env.FEE_CONFIG_OBJECT_ID || '';

const GAS_WALLET_PRIMARY_KEY = process.env.GAS_WALLET_PRIMARY_KEY || '';

interface CreateVaultRequest {
  wallet_address: string;
  blob_id: string;
  initial_wal_amount: string;
  renew_threshold_epochs: number;
  renew_by_epochs: number;
  max_total_epochs?: number;
}

interface DepositRequest {
  wallet_address: string;
  amount: string;
}

interface UpdatePolicyRequest {
  wallet_address: string;
  renew_threshold_epochs: number;
  renew_by_epochs: number;
  max_total_epochs?: number;
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

export class ReAuthRequiredError extends Error {
  constructor() { super('Withdraw requires fresh OAuth re-authentication (session < 15 min)'); }
}

const addressLocks = new Map<string, Promise<unknown>>();

async function withAddressLock<T>(address: string, fn: () => Promise<T>): Promise<T> {
  const prev = addressLocks.get(address) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  addressLocks.set(address, next);
  return next;
}

async function loadUserZkLogin(userId: string): Promise<{
  keypair: Ed25519Keypair;
  encryptedProof: string;
  jwtRandomness: string;
  maxEpoch: number;
  zkloginAddress: string;
}> {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || !user.ephemeralKeyEncrypted || !user.zkloginProofEncrypted) {
    throw new Error('User zkLogin keys not set up. Complete OAuth login first.');
  }
  const keypairHex = decrypt(user.ephemeralKeyEncrypted);
  const keypairBytes = Uint8Array.from(Buffer.from(keypairHex, 'hex'));
  const keypair = Ed25519Keypair.fromSecretKey(keypairBytes);
  return {
    keypair,
    encryptedProof: decrypt(user.zkloginProofEncrypted),
    jwtRandomness: user.zkloginJwtRandomness || '',
    maxEpoch: user.zkloginMaxEpoch || 0,
    zkloginAddress: user.zkloginAddress || '',
  };
}

async function getUserZkLoginAddress(userId: string): Promise<string> {
  const db = getDb();
  const [user] = await db.select({ zkloginAddress: users.zkloginAddress })
    .from(users).where(eq(users.id, userId)).limit(1);
  if (!user?.zkloginAddress) {
    throw new Error('User has no zkLogin address. Complete OAuth login first.');
  }
  return user.zkloginAddress;
}

async function signAndSubmitTx(
  tx: Transaction,
  userId: string,
  gasBudget: number,
): Promise<{ digest: string; effects: Record<string, unknown> }> {
      const pool = createPoolFromEnv({ threshold: 3, timeout: 30_000 });
      const { keypair, encryptedProof, maxEpoch } = await loadUserZkLogin(userId);

      tx.setSender(keypair.toSuiAddress());
      tx.setGasBudget(gasBudget);

      const gasWalletBytes = Uint8Array.from(Buffer.from(GAS_WALLET_PRIMARY_KEY, 'hex'));
      const gasWalletKp = Ed25519Keypair.fromSecretKey(gasWalletBytes);
      const gasWalletAddress = gasWalletKp.toSuiAddress();

      return withAddressLock(gasWalletAddress, async () => {
        const gasRef = await selectGasCoin(gasWalletAddress);
        tx.setGasPayment([gasRef]);

        const bytes = await pool.call(async (client) => tx.build({ client }));

        const userSig = (await keypair.signTransaction(bytes)).signature;

        const zkLoginSig = getZkLoginSignature({
          inputs: JSON.parse(encryptedProof),
          maxEpoch,
          userSignature: userSig,
        });

        const gasSig = (await gasWalletKp.signTransaction(bytes)).signature;

        return pool.call(async (client) => {
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
      });
}

async function getSpendTotal(orgId: string, windowMs: number): Promise<number> {
  try {
    const { default: redis } = await import('redis');
    const r = redis.createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
    await r.connect();
    const key = `spend:${orgId}:total:${windowMs}`;
    const val = await r.get(key);
    await r.quit();
    return val ? Number(val) : 0;
  } catch {
    return 0;
  }
}

async function recordSpend(orgId: string, amount: number): Promise<void> {
  try {
    const { default: redis } = await import('redis');
    const r = redis.createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
    await r.connect();
    const dayKey = `spend:${orgId}:total:${86400000}`;
    await r.incrBy(dayKey, amount);
    await r.expire(dayKey, 86401);
    await r.quit();
  } catch {
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

function checkReAuth(sessionAgeMs: number): void {
  if (sessionAgeMs > 15 * 60 * 1000) {
    throw new ReAuthRequiredError();
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

  async createVault(
    userId: string,
    orgId: string,
    params: {
      blobId: string;
      amount: number;
      threshold: number;
      extension: number;
      maxEpochs?: number;
    },
  ): Promise<{ vaultId: string; digest: string; status: string }> {
    this.ensurePackageId();
    return withAddressLock(userId, async () => {
      const beneficiary = await getUserZkLoginAddress(userId);
      const tx = new Transaction();
      const walCoinArg = await this.selectWalCoin(
        tx,
        beneficiary,
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
          tx.pure.option('u64', params.maxEpochs ?? null),
          tx.pure.address(beneficiary),
          tx.pure.u64(withdrawDelayEpochs),
        ],
      });

      const { digest, effects } = await signAndSubmitTx(tx, userId, 10_000_000);
      const created = (effects as any)?.created?.[0];
      const vaultId = created?.reference?.objectId || '';

      return { vaultId, digest, status: (effects as any)?.status?.status ?? 'failure' };
    });
  }

  async depositToVault(userId: string, vaultId: string, amount: number): Promise<{ digest: string }> {
    this.ensurePackageId();
    return withAddressLock(userId, async () => {
      const userAddress = await getUserZkLoginAddress(userId);
      const tx = new Transaction();
      const walCoinArg = await this.selectWalCoin(tx, userAddress, amount);

      tx.moveCall({
        target: `${PACKAGE_ID}::vault::deposit`,
        arguments: [
          tx.object(FEE_CONFIG_OBJECT_ID),
          tx.object(vaultId),
          walCoinArg,
        ],
      });

      const { digest } = await signAndSubmitTx(tx, userId, 5_000_000);
      return { digest };
    });
  }

  async withdrawFromVault(
    userId: string,
    orgId: string,
    vaultId: string,
    amount: number,
    sessionAgeMs: number,
  ): Promise<{ digest: string }> {
    this.ensurePackageId();
    checkReAuth(sessionAgeMs);
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

      const { digest } = await signAndSubmitTx(tx, userId, 5_000_000);
      return { digest };
    });
  }

  async updatePolicy(
    userId: string,
    vaultId: string,
    request: UpdatePolicyRequest,
  ): Promise<{ digest: string }> {
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
          tx.pure.option('u64', request.max_total_epochs ?? null),
          tx.pure.bool(request.active),
        ],
      });

      const { digest } = await signAndSubmitTx(tx, userId, 5_000_000);
      return { digest };
    });
  }

  async reclaimBlob(
    userId: string,
    vaultId: string,
  ): Promise<{ digest: string }> {
    this.ensurePackageId();
    return withAddressLock(userId, async () => {
      const tx = new Transaction();

      tx.moveCall({
        target: `${PACKAGE_ID}::vault::reclaim_blob`,
        arguments: [
          tx.object(vaultId),
        ],
      });

      const { digest } = await signAndSubmitTx(tx, userId, 5_000_000);
      return { digest };
    });
  }

  async buildCreateVaultTx(_request: CreateVaultRequest): Promise<string> {
    throw new Error('buildCreateVaultTx removed — use createVault which signs and submits');
  }

  async buildDepositTx(_vaultId: string, _request: DepositRequest): Promise<string> {
    throw new Error('buildDepositTx removed — use depositToVault which signs and submits');
  }

  async buildUpdatePolicyTx(_vaultId: string, _request: UpdatePolicyRequest): Promise<string> {
    throw new Error('buildUpdatePolicyTx removed — use updatePolicy which signs and submits');
  }

  async buildWithdrawTx(_vaultId: string, _request: WithdrawRequest): Promise<string> {
    throw new Error('buildWithdrawTx removed — use withdrawFromVault which signs and submits');
  }

  async buildReclaimTx(_vaultId: string, _request: ReclaimRequest): Promise<string> {
    throw new Error('buildReclaimTx removed — use reclaimBlob which signs and submits');
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
            {
              filter: { StructType: vaultType },
              options: { showContent: true, showType: true },
            },
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
      logger.error({ error }, 'Failed to fetch FeeConfig — using stale cache if available');
      if (this.cachedFeeConfig) {
        return this.cachedFeeConfig;
      }
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

  private readonly feeConfigCacheTtl = parseInt(
    process.env.FEE_CONFIG_CACHE_TTL_MS || '300000', 10,
  );

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
