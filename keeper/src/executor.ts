/**
 * Renewal Executor
 *
 * Builds and submits execute_renewal transactions for due vaults.
 * Uses a dedicated gas-funded hot wallet that never holds user WAL.
 *
 * The keeper pays SUI gas only; the WAL cost and fees are handled
 * inside the Move contract from the vault's balance.
 *
 * After execution, the executor parses emitted Move events and returns
 * them so the caller can forward alerts to the notification service.
 */

import { SuiClient, type SuiEvent } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import pino from 'pino';

import type { DueVault } from './scanner.js';
import type { AlertEvent } from './notification.js';
import { type SuiClientPool } from './sui-pool.js';
import { withRetry, isRetryableJobError } from './retry.js';
import { verifyOnChainStateBeforeRetry } from './edge-cases.js';
import { resolvePublisher, type PublisherInfo } from './publisher-selector.js';
import { emit, EventNames, createEvent } from '../../api/src/lib/event-bus.js';
import { costEngine, type BudgetCheckResult } from '../../api/src/lib/cost-engine.js';

interface SuiObjectResponse {
  data?: {
    type?: string;
    objectId?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

const logger = pino({ name: 'renewal-executor' });

export interface RenewalResult {
  vaultId: string;
  digest: string;
  gasUsed: bigint;
  /** Parsed Move events that may trigger user notifications */
  alerts: AlertEvent[];
}

// ---------------------------------------------------------------------------
// FeeConfig Cache
// ---------------------------------------------------------------------------

interface FeeConfigCacheEntry {
  objectId: string;
  cachedAt: number;
}

const FEE_CONFIG_CACHE_TTL_MS = parseInt(
  process.env.FEE_CONFIG_CACHE_TTL_MS || '300000', // 5 minutes default
  10,
);

/**
 * Simple in-memory cache for FeeConfig object IDs.
 * Reduces RPC calls: FeeConfig is a singleton that rarely changes.
 * Cache key = packageId (one FeeConfig per deployed contract).
 */
class FeeConfigCache {
  private cache = new Map<string, FeeConfigCacheEntry>();

  get(packageId: string): string | null {
    const entry = this.cache.get(packageId);
    if (!entry) return null;
    if (Date.now() - entry.cachedAt > FEE_CONFIG_CACHE_TTL_MS) {
      this.cache.delete(packageId);
      return null;
    }
    return entry.objectId;
  }

  set(packageId: string, objectId: string): void {
    this.cache.set(packageId, { objectId, cachedAt: Date.now() });
  }

  invalidate(packageId: string): void {
    this.cache.delete(packageId);
  }

  /** Return cache stats for metrics/logging */
  stats(): { size: number; keys: string[] } {
    return { size: this.cache.size, keys: [...this.cache.keys()] };
  }
}

/** Shared singleton — multiple executor instances share one cache */
export const feeConfigCache = new FeeConfigCache();

// ---------------------------------------------------------------------------

export class RenewalExecutor {
  private pool: SuiClientPool;
  private keypair: Ed25519Keypair;
  private retryDelayMs: number;
  private maxRetries = 3;
  private packageId: string;
  private systemObjectId: string;
  private aggregatorUrl: string;
  private selectedPublisher: PublisherInfo | null = null;
  private lastOrgId: string = '';

  constructor(
    pool: SuiClientPool,
    keypair: Ed25519Keypair,
    retryDelayMs = 5000,
    packageId?: string,
    aggregatorUrl?: string,
  ) {
    this.pool = pool;
    this.keypair = keypair;
    this.retryDelayMs = retryDelayMs;
    this.packageId = packageId || process.env.PACKAGE_ID || '';
    this.systemObjectId = process.env.SYSTEM_OBJECT_ID || '';
    this.aggregatorUrl = aggregatorUrl || process.env.AGGREGATOR_URL || '';
  }

  /**
   * Resolve a publisher for the given project/org (Spec 08).
   * Sets the selected publisher for this execution cycle.
   * Returns true if a publisher was found, false if none available.
   */
  async resolvePublisherForRenewal(projectId: string | null, orgId: string, publisherPriorityOverride?: number): Promise<boolean> {
    this.lastOrgId = orgId;
    this.selectedPublisher = await resolvePublisher(projectId, orgId, publisherPriorityOverride);
    if (!this.selectedPublisher) {
      logger.warn({ projectId, orgId }, 'No healthy publisher available for renewal');
      return false;
    }
    logger.info(
      { publisherId: this.selectedPublisher.id, name: this.selectedPublisher.name, priority: this.selectedPublisher.priority },
      'Publisher resolved for renewal',
    );
    return true;
  }

  /**
   * Get the currently selected publisher for this execution cycle.
   */
  getSelectedPublisher(): PublisherInfo | null {
    return this.selectedPublisher;
  }

  /**
   * Execute an RPC call against a healthy endpoint from the pool.
   * Handles automatic failover + per-URL circuit breaker.
   */
  private callClient<T>(fn: (client: SuiClient) => Promise<T>): Promise<T> {
    return this.pool.call(fn);
  }

  /**
   * Build and submit an execute_renewal transaction for a due vault.
   * Returns the result including any Move events that were emitted.
   */
  async executeRenewal(vault: DueVault): Promise<RenewalResult> {
    const packageId = this.packageId;
    if (!packageId) {
      throw new Error('PACKAGE_ID environment variable is required to execute renewals');
    }

    const systemObjectId = this.systemObjectId;
    if (!systemObjectId) {
      throw new Error('SYSTEM_OBJECT_ID environment variable is required to execute renewals');
    }

    // Find the FeeConfig shared object
    const feeConfigObjectId = await this.findFeeConfigObject(packageId);

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const tx = this.buildTransaction(vault, packageId, systemObjectId, feeConfigObjectId);
        const result = await this.callClient((c) =>
          c.signAndExecuteTransaction({
            transaction: tx,
            signer: this.keypair,
            options: {
              showEffects: true,
              showEvents: true,
            },
          }),
        );

        emit(createEvent(EventNames.DELEGATION_USED, this.lastOrgId || 'system', 'wallet', vault.id, { type: 'system' }, { beneficiary: vault.beneficiary, digest: result.digest }));

        // Parse events from the transaction result
        const alerts = this.parseEvents(vault, result.events || []);

        const isSuccess = result.effects?.status?.status === 'success';

        const effects = result.effects;
        if (!effects) {
          throw new Error('Transaction effects missing from RPC response');
        }

        if (!isSuccess) {
          const errorMsg = effects.status?.error || 'Unknown failure';

          // Even on failure, the contract may have emitted InsufficientBalance
          // before aborting — those alerts should still be forwarded
          if (alerts.length > 0) {
            logger.warn(
              { vaultId: vault.id, error: errorMsg, eventsFound: alerts.length },
              'Transaction failed but events were emitted',
            );
            return {
              vaultId: vault.id,
              digest: result.digest,
              gasUsed: BigInt(effects.gasUsed?.computationCost || '0'),
              alerts,
            };
          }

          throw new Error(`Transaction failed: ${errorMsg}`);
        }

        logger.info(
          { vaultId: vault.id, digest: result.digest, alertsFound: alerts.length },
          'Renewal executed successfully',
        );

        return {
          vaultId: vault.id,
          digest: result.digest,
          gasUsed: BigInt(effects.gasUsed?.computationCost || '0'),
          alerts,
        };
      } catch (error) {
        lastError = error as Error;
        logger.warn({
          service: 'sui-rpc',
          operation: 'signAndExecuteTransaction',
          vaultId: vault.id,
          attempt,
          error: (error as Error).message,
          timestamp: new Date().toISOString(),
        }, 'Renewal attempt failed');

        // Non-retryable errors escalate immediately per Spec 16
        if (!isRetryableJobError(error)) {
          logger.warn({ vaultId: vault.id, error: (error as Error).message },
            'Non-retryable transaction error — escalating immediately');
          throw error; // Caught by the outer retry loop which will mark as failed_final
        }

        if (this.aggregatorUrl && attempt < this.maxRetries) {
          const stateCheck = await verifyOnChainStateBeforeRetry(vault.blobId, this.aggregatorUrl);
          if (!stateCheck.verified) {
            logger.warn({ blobId: vault.blobId }, 'Cannot verify on-chain state before retry — continuing with backoff');
            // Apply delay before retrying even when verification is unavailable
            // to avoid burning through retries on a transient aggregator issue.
            if (attempt < this.maxRetries) await this.applyRetryDelay(attempt);
            continue;
          }
          // Spec 27: Check if the blob's epoch was already extended on-chain.
          // If the on-chain expiry matches or exceeds the expected extension, the
          // previous attempt succeeded despite the ambiguous failure — treat as success.
          const currentEpoch = Number(stateCheck.currentState?.epoch ?? stateCheck.currentState?.expiry_epoch ?? 0);
          const expectedEpoch = vault.currentEndEpoch + (vault.renewByEpochs ?? 1);
          if (currentEpoch >= expectedEpoch) {
            logger.info(
              { blobId: vault.blobId, currentEpoch, expectedEpoch },
              'On-chain state confirms renewal already applied — treating as success',
            );
            // Return a synthetic success result — the actual cost/gas was already recorded
            // by the prior attempt's on-chain execution.
            return {
              vaultId: vault.id,
              digest: '(previously committed)',
              gasUsed: BigInt(0),
              alerts: [],
            };
          }
        }

        if (attempt < this.maxRetries) {
          await this.applyRetryDelay(attempt);
        }
      }
    }

    throw lastError || new Error('Max retries exceeded');
  }

  /**
   * Parse Move events from the transaction result into AlertEvent objects.
   *
   * The auto_renewal::vault module emits:
   *   - RenewalExecuted     — successful renewal
   *   - InsufficientBalance — vault ran out of WAL
   *   - PolicyExhausted     — max_total_epochs cap reached
   *
   * Each event's parsedJson contains the event-specific fields.
   */
  private parseEvents(vault: DueVault, events: SuiEvent[]): AlertEvent[] {
    const alerts: AlertEvent[] = [];
    const now = Date.now();

    for (const event of events) {
      const type = event.type as string;
      const parsed = event.parsedJson as Record<string, unknown> | null;
      if (!parsed) continue;

      // RenewalExecuted: successful renewal
      if (type.endsWith('::vault::RenewalExecuted')) {
        alerts.push({
          type: 'RenewalExecuted',
          vaultId: vault.id,
          blobId: (parsed.blob_id as string) || vault.blobId,
          beneficiary: vault.beneficiary,
          timestamp: now,
          actualCost: BigInt(String(parsed.actual_cost || '0')),
          keeperFeePaid: BigInt(String(parsed.keeper_fee_paid || '0')),
        });
      }

      // InsufficientBalance: vault WAL balance too low
      if (type.endsWith('::vault::InsufficientBalance')) {
        alerts.push({
          type: 'InsufficientBalance',
          vaultId: vault.id,
          blobId: vault.blobId,
          beneficiary: vault.beneficiary,
          timestamp: now,
          required: BigInt(String(parsed.required || '0')),
          available: BigInt(String(parsed.available || '0')),
        });
      }

      // PolicyExhausted: max_total_epochs cap reached
      if (type.endsWith('::vault::PolicyExhausted')) {
        alerts.push({
          type: 'PolicyExhausted',
          vaultId: vault.id,
          blobId: (parsed.blob_id as string) || vault.blobId,
          beneficiary: vault.beneficiary,
          timestamp: now,
          maxTotalEpochs: Number(parsed.max_total_epochs || 0),
        });
      }
    }

    return alerts;
  }

  /**
   * Find the FeeConfig shared object for this package.
   *
   * Uses an in-memory cache to avoid redundant RPC calls.
   * Cache TTL is configurable via FEE_CONFIG_CACHE_TTL_MS (default: 5 min).
   * All RPC calls are wrapped with retry + exponential backoff.
   */
  private async findFeeConfigObject(packageId: string): Promise<string> {
    // 1. Check cache first
    const cached = feeConfigCache.get(packageId);
    if (cached) {
      logger.debug({ packageId, cachedAt: Date.now() - (FEE_CONFIG_CACHE_TTL_MS - 0) }, 'FeeConfig cache hit');
      return cached;
    }

    logger.debug({ packageId }, 'FeeConfig cache miss — querying chain');

    const feeConfigType = `${packageId}::vault::FeeConfig`;

    // 2. Query with retry + failover (network errors only — app errors propagate immediately)
    const result = await withRetry(async () => {
      return await this.callClient((c) =>
        c.call<any>('suix_queryObjects', [
          {
            filter: { StructType: feeConfigType },
            options: { showType: true },
          },
          null,
          10,
        ]),
      );
    }, {
      maxRetries: 3,
      baseDelay: 2000,
      operationName: 'findFeeConfigObject',
    });

    if (!result.data || result.data.length === 0) {
      const errMsg = `FeeConfig shared object not found for type ${feeConfigType}`;
      logger.error({
        service: 'sui-rpc',
        operation: 'suix_queryObjects',
        feeConfigType,
        error: errMsg,
        timestamp: new Date().toISOString(),
      }, errMsg);
      throw new Error(`${errMsg}. Make sure the contract has been deployed and init() has run.`);
    }

    const matching = result.data.filter(
      (obj: SuiObjectResponse) => obj.data?.type?.includes(packageId),
    );

    if (matching.length === 0) {
      const errMsg = `FeeConfig shared object found but none match package ${packageId}`;
      logger.error({
        service: 'sui-rpc',
        operation: 'suix_queryObjects',
        packageId,
        error: errMsg,
        timestamp: new Date().toISOString(),
      }, errMsg);
      throw new Error(`${errMsg}. Ensure the deployed package ID is correct.`);
    }

    const objectId = matching[0].data.objectId;

    // 3. Populate cache
    feeConfigCache.set(packageId, objectId);
    logger.info({ packageId, objectId }, 'FeeConfig cached');

    return objectId;
  }

  /**
   * Build an execute_renewal transaction block.
   */
  private buildTransaction(
    vault: DueVault,
    packageId: string,
    systemObjectId: string,
    feeConfigObjectId: string,
  ): Transaction {
    const tx = new Transaction();

    tx.moveCall({
      target: `${packageId}::vault::execute_renewal`,
      arguments: [
        tx.object(vault.objectId),
        tx.object(feeConfigObjectId),
        tx.object(systemObjectId),
      ],
    });

    tx.setSender(this.keypair.getPublicKey().toSuiAddress());
    return tx;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Apply exponential backoff with jitter before a retry.
   * Extracted as a helper so it can be called from multiple retry paths.
   */
  private async applyRetryDelay(attempt: number): Promise<void> {
    const delay = Math.min(this.retryDelayMs * Math.pow(2, attempt - 1), 30000);
    const jitter = Math.round(delay * (0.5 + Math.random() * 0.5));
    await this.delay(jitter);
  }
}

export type { BudgetCheckResult };

export async function checkBudgetBeforeRenewal(
  orgId: string,
  projectId: string | null,
  estimatedCost: bigint,
  walletId?: string,
): Promise<BudgetCheckResult> {
  return costEngine.checkBudgetBeforeExecution(
    orgId,
    projectId,
    walletId,
    null,
    Number(estimatedCost),
  );
}
