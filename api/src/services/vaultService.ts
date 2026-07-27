/**
 * Vault Service
 *
 * Handles on-chain interactions with RenewalVault objects:
 * - Reads vault state from the Sui chain
 * - Builds unsigned Transaction blocks for user signing
 * - Queries vault events from the indexer
 *
 * For create_vault and deposit, the service queries the sender's
 * owned Coin<WAL> objects (via the provided WAL_COIN_TYPE env var),
 * selects one with sufficient balance, and builds the transaction
 * with proper mergeCoins/splitCoins instructions.
 */

import { SuiObjectResponse } from '@mysten/sui/client';
import { Transaction, type TransactionArgument } from '@mysten/sui/transactions';
import pino from 'pino';
import { withRetry } from '../lib/retry.js';
import { SuiClientPool, createPoolFromEnv } from '../lib/sui-pool.js';

const logger = pino({ name: 'vault-service' });

// These MUST be set before the service can be used.
const PACKAGE_ID = process.env.PACKAGE_ID || '';
const SYSTEM_OBJECT_ID = process.env.SYSTEM_OBJECT_ID || '';
const FEE_CONFIG_OBJECT_ID = process.env.FEE_CONFIG_OBJECT_ID || '';
/**
 * WAL coin type in full format, e.g. "0x...::wal::WAL".
 * Found by checking the Walrus system deployment on testnet.
 * Falls back to placeholder if not set; tx building will fail at runtime.
 */
const WAL_COIN_TYPE =
  process.env.WAL_COIN_TYPE || '';

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
}

interface RenewalEvent {
  type: string;
  timestamp: string;
  vaultId: string;
  data: Record<string, unknown>;
}

export class VaultService {
  private pool: SuiClientPool;

  constructor() {
    this.pool = createPoolFromEnv({ threshold: 3, timeout: 30_000 });
  }

  /**
   * Build an unsigned transaction for creating a new vault.
   *
   * Move function:
   *   public entry fun create_vault(
   *     blob: Blob,
   *     initial_wal: Coin<WAL>,
   *     renew_threshold_epochs: u64,
   *     renew_by_epochs: u64,
   *     max_total_epochs: Option<u64>,
   *     ctx: &mut TxContext
   *   )
   *
   * The initial_wal Coin<WAL> is selected from the sender's owned WAL coins,
   * merging multiple coins if necessary and splitting the exact amount.
   */
  async buildCreateVaultTx(request: CreateVaultRequest): Promise<string> {
    this.ensurePackageId();
    const tx = new Transaction();

    // Resolve the WAL coin to use as payment
    const walCoinArg = await this.selectWalCoin(
      tx,
      request.wallet_address,
      request.initial_wal_amount,
    );

    tx.moveCall({
      target: `${PACKAGE_ID}::vault::create_vault`,
      arguments: [
        tx.object(FEE_CONFIG_OBJECT_ID),
        tx.object(request.blob_id),
        walCoinArg,
        tx.pure.u64(request.renew_threshold_epochs),
        tx.pure.u64(request.renew_by_epochs),
        tx.pure.option('u64', request.max_total_epochs ?? null),
      ],
    });

    tx.setSender(request.wallet_address);
    return tx.serialize();
  }

  /**
   * Build an unsigned deposit transaction.
   *
   * Move function:
   *   public entry fun deposit(config: &FeeConfig, vault: &mut RenewalVault, coin: Coin<WAL>, ctx: &mut TxContext)
   *
   * Selects a WAL coin from the sender's owned coins, merges/splits as needed.
   */
  async buildDepositTx(vaultId: string, request: DepositRequest): Promise<string> {
    this.ensurePackageId();
    const tx = new Transaction();

    const walCoinArg = await this.selectWalCoin(
      tx,
      request.wallet_address,
      request.amount,
    );

    tx.moveCall({
      target: `${PACKAGE_ID}::vault::deposit`,
      arguments: [
        tx.object(FEE_CONFIG_OBJECT_ID),
        tx.object(vaultId),
        walCoinArg,
      ],
    });

    tx.setSender(request.wallet_address);
    return tx.serialize();
  }

  /**
   * Build an unsigned update_policy transaction.
   *
   * Move function:
   *   public entry fun update_policy_fields(
   *     vault: &mut RenewalVault,
   *     renew_threshold_epochs: u64,
   *     renew_by_epochs: u64,
   *     max_total_epochs: Option<u64>,
   *     active: bool,
   *     ctx: &TxContext
   *   )
   *
   * Uses the convenience entry added to vault.move that takes individual
   * fields, avoiding the need to BCS-serialize the RenewalPolicy struct
   * in the TS SDK.
   */
  async buildUpdatePolicyTx(vaultId: string, request: UpdatePolicyRequest): Promise<string> {
    this.ensurePackageId();
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

    tx.setSender(request.wallet_address);
    return tx.serialize();
  }

  /**
   * Build an unsigned withdraw transaction.
   *
   * Move function:
   *   public entry fun withdraw(vault: &mut RenewalVault, amount: u64, ctx: &mut TxContext)
   */
  async buildWithdrawTx(vaultId: string, request: WithdrawRequest): Promise<string> {
    this.ensurePackageId();
    const tx = new Transaction();

    tx.moveCall({
      target: `${PACKAGE_ID}::vault::withdraw`,
      arguments: [
        tx.object(vaultId),
        tx.pure.u64(BigInt(request.amount)),
      ],
    });

    tx.setSender(request.wallet_address);
    return tx.serialize();
  }

  /**
   * Build an unsigned reclaim_blob transaction.
   *
   * Move function:
   *   public entry fun reclaim_blob(vault: &mut RenewalVault, ctx: &mut TxContext)
   */
  async buildReclaimTx(vaultId: string, request: ReclaimRequest): Promise<string> {
    this.ensurePackageId();
    const tx = new Transaction();

    tx.moveCall({
      target: `${PACKAGE_ID}::vault::reclaim_blob`,
      arguments: [
        tx.object(vaultId),
      ],
    });

    tx.setSender(request.wallet_address);
    return tx.serialize();
  }

  /**
   * Select a WAL coin with sufficient balance from the sender's wallet,
   * merge multiple coins if needed, and split the exact amount.
   *
   * Returns a TransactionResult that can be used as an argument in moveCall.
   */
  /**
   * Select a WAL coin with sufficient balance, merging/splitting as needed.
   * Returns a transaction argument that can be passed to moveCall.
   */
  private async selectWalCoin(
    tx: Transaction,
    ownerAddress: string,
    amountStr: string,
  ): Promise<TransactionArgument> {
    this.ensureWalCoinType();

    const amount = BigInt(amountStr);

    // Query the sender's owned WAL coins via pool (multi-RPC failover)
    const coins = await withRetry(async () => {
      return await this.pool.call(async (client) => {
        return await client.getCoins({
          owner: ownerAddress,
          coinType: WAL_COIN_TYPE,
        });
      });
    }, { maxRetries: 3, label: 'selectWalCoin', baseDelay: 1000 });

    if (!coins.data || coins.data.length === 0) {
      throw new Error(
        `No WAL coins found for address ${ownerAddress}. ` +
          `Make sure the address has Coin<${WAL_COIN_TYPE}> objects.`,
      );
    }

    // Calculate total available balance
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

    // Merge additional coins into the primary one if there are multiple
    if (coins.data.length > 1) {
      const restCoins = coins.data.slice(1).map((c) => tx.object(c.coinObjectId));
      tx.mergeCoins(walInput, restCoins);
    }

    // If we need less than the full balance, split the exact amount
    const primaryBalance = BigInt(primaryCoin.balance);
    if (amount < (coins.data.length > 1 ? totalAvailable : primaryBalance)) {
      const [splitCoin] = tx.splitCoins(walInput, [tx.pure.u64(amount)]);
      walInput = splitCoin;
    }

    return walInput;
  }

  /**
   * Get a single vault by its on-chain object ID.
   */
  async getVaultById(vaultId: string): Promise<{ walletAddress: string } | null> {
    if (!PACKAGE_ID) {
      logger.warn('PACKAGE_ID not set — cannot look up vault by ID');
      return null;
    }

    try {
      return await withRetry(async () => {
        return await this.pool.call(async (client) => {
          const result = await client.getObject({
            id: vaultId,
            options: { showContent: true },
          });

          if (!result.data?.content || result.data.content.dataType !== 'moveObject') {
            return null;
          }

          const fields = (result.data.content as { fields: Record<string, unknown> }).fields;
          const walletAddress = fields?.beneficiary;
          if (typeof walletAddress !== 'string') {
            return null;
          }

          return { walletAddress };
        });
      }, { maxRetries: 3, label: 'getVaultById', baseDelay: 1000 });
    } catch (error) {
      logger.error({ error, vaultId }, 'Failed to get vault by ID');
      return null;
    }
  }

  /**
   * Get all vaults for a wallet address.
   */
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
                walBalance: String(fields.wal_balance || '0'),
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
              };
            });
        });
      }, { maxRetries: 3, label: 'getVaults', baseDelay: 1000 });
    } catch (error) {
      logger.error({ error, walletAddress }, 'Failed to get vaults');
      return [];
    }
  }

  /**
   * Get paginated renewal history for a vault.
   */
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
          // Note: Cursor-based pagination is not implemented for vault history.
          // The Sui event query API requires cursor for true pagination, but since
          // we filter by vault_id client-side, we fetch the latest events each time.
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

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

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
          'Set it to the full WAL coin type, e.g. "0x...::wal::WAL". ' +
          'Find the wal package address from the Walrus testnet deployment.',
      );
    }
  }

  // -----------------------------------------------------------------------
  // FeeConfig Caching
  // -----------------------------------------------------------------------

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
    process.env.FEE_CONFIG_CACHE_TTL_MS || '300_000', 10,
  );

  /**
   * Fetch the FeeConfig object from the chain with caching.
   * Cache TTL is configurable via FEE_CONFIG_CACHE_TTL_MS (default 5 min).
   */
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

    // Return cached value if still fresh
    if (this.cachedFeeConfig && Date.now() - this.cachedFeeConfig.fetchedAt < this.feeConfigCacheTtl) {
      return {
        treasury: this.cachedFeeConfig.treasury,
        protocolFeeBps: this.cachedFeeConfig.protocolFeeBps,
        keeperFee: this.cachedFeeConfig.keeperFee,
        storagePrice: this.cachedFeeConfig.storagePrice,
        version: this.cachedFeeConfig.version,
        paused: this.cachedFeeConfig.paused,
      };
    }

    try {
      const result = await withRetry(async () => {
        return await this.pool.call(async (client) => {
          // FeeConfig is the first shared object of type FeeConfig
          // We query by owner (shared) and filter by type
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
          return {
            treasury: cached.treasury,
            protocolFeeBps: cached.protocolFeeBps,
            keeperFee: cached.keeperFee,
            storagePrice: cached.storagePrice,
            version: cached.version,
            paused: cached.paused,
          };
        });
      }, { maxRetries: 2, label: 'getFeeConfig', baseDelay: 1000 });

      return result;
    } catch (error) {
      logger.error({ error }, 'Failed to fetch FeeConfig — using stale cache if available');
      if (this.cachedFeeConfig) {
        return {
          treasury: this.cachedFeeConfig.treasury,
          protocolFeeBps: this.cachedFeeConfig.protocolFeeBps,
          keeperFee: this.cachedFeeConfig.keeperFee,
          storagePrice: this.cachedFeeConfig.storagePrice,
          version: this.cachedFeeConfig.version,
          paused: this.cachedFeeConfig.paused,
        };
      }
      return null;
    }
  }

  /** Invalidate FeeConfig cache (e.g., after an admin action). */
  invalidateFeeConfigCache(): void {
    this.cachedFeeConfig = null;
  }
}
