import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@mysten/sui/client', () => ({
  SuiClient: vi.fn().mockImplementation(() => ({
    getLatestCheckpointSequenceNumber: vi.fn().mockResolvedValue(1000),
    getCheckpoint: vi.fn().mockResolvedValue({ epoch: 42 }),
    call: vi.fn().mockResolvedValue({ data: [], hasNextPage: false, nextCursor: null }),
    multiGetObjects: vi.fn().mockResolvedValue([]),
    signAndExecuteTransaction: vi.fn().mockResolvedValue({
      digest: '0xtx',
      effects: { status: { status: 'success' }, gasUsed: { computationCost: '1000' } },
      events: [],
    }),
    getCoins: vi.fn().mockResolvedValue({ data: [] }),
    queryEvents: vi.fn().mockResolvedValue({ data: [] }),
  })),
}));

vi.mock('node-cron', () => ({
  default: {
    schedule: vi.fn().mockReturnValue({ stop: vi.fn() }),
  },
}));

import { VaultScanner } from '../scanner.js';
import { RenewalExecutor } from '../executor.js';
import { SuiClientPool } from '../sui-pool.js';
import { NotificationService, type AlertEvent } from '../notification.js';
import { MetricsCollector } from '../metrics.js';
import { JobMonitor } from '../job-monitor.js';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

/**
 * Create a SuiClientPool with a single URL for tests.
 * SuiClient is mocked at the module level, so the pool
 * wraps the mock automatically.
 */
function createTestPool(): SuiClientPool {
  return new SuiClientPool({
    urls: ['http://fake'],
    breakerThreshold: 100,  // high threshold — don't trip in tests
    breakerTimeout: 50,
  });
}

function createMockKeypair() {
  const secretKey = new Uint8Array(32);
  for (let i = 0; i < 32; i++) secretKey[i] = i;
  return Ed25519Keypair.fromSecretKey(secretKey);
}

describe('Keeper E2E: Scan -> Execute -> Notify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should scan due vaults, execute renewal, and record metrics on success', async () => {
    const keypair = createMockKeypair();
    const pool = createTestPool();

    process.env.PACKAGE_ID = '0xpackage';
    process.env.SYSTEM_OBJECT_ID = '0xsystem';

    const metrics = new MetricsCollector();
    const jobMonitor = new JobMonitor();
    const scanner = new VaultScanner(pool, 50, false, '0xpackage');
    const executor = new RenewalExecutor(pool, keypair, 100, '0xpackage');

    const mockVaults = [
      {
        id: '0x123',
        objectId: '0x123',
        beneficiary: '0xbeneficiary1',
        blobId: '42',
        walBalance: BigInt(1000),
        renewThresholdEpochs: 10,
        renewByEpochs: 5,
        maxTotalEpochs: 365,
        active: true,
        currentEndEpoch: 50,
      },
    ];

    const scanSpy = vi.spyOn(scanner, 'findDueVaults').mockResolvedValue(mockVaults);
    const execSpy = vi.spyOn(executor, 'executeRenewal').mockResolvedValue({
      vaultId: '0x123',
      digest: '0xtxdigest',
      gasUsed: BigInt(1000),
      alerts: [],
    });

    const dueVaults = await scanner.findDueVaults();
    expect(dueVaults.length).toBe(1);
    expect(dueVaults[0].id).toBe('0x123');

    metrics.setQueueDepth(dueVaults.length);
    for (const vault of dueVaults) {
      metrics.recordStart(vault.id);
      const renewalJobId = await jobMonitor.startJob('renewal');
      try {
        const result = await executor.executeRenewal(vault);
        metrics.recordSuccess(result);
        await jobMonitor.completeJob(renewalJobId, { vaultId: vault.id, txDigest: result.digest });
      } catch (error) {
        metrics.recordFailure(vault.id, error as Error);
        await jobMonitor.failJob(renewalJobId, (error as Error).message);
      }
    }

    const summary = metrics.summarize();
    expect(summary.attempted).toBe(1);
    expect(summary.succeeded).toBe(1);
    expect(summary.failed).toBe(0);
    expect(summary.totalGasUsed).toBe(BigInt(1000));

    const stats = jobMonitor.getStats();
    expect(stats.total).toBe(1);
    expect(stats.success).toBe(1);
    expect(stats.failed).toBe(0);

    expect(execSpy).toHaveBeenCalledWith(mockVaults[0]);
    expect(scanSpy).toHaveBeenCalled();
  });

  it('should handle scanner failure gracefully', async () => {
    const pool = createTestPool();
    const scanner = new VaultScanner(pool, 50, false, '0xpackage');

    vi.spyOn(scanner, 'findDueVaults').mockRejectedValue(new Error('RPC Error'));

    let caughtError: Error | null = null;
    let dueVaults: { id: string }[] = [];
    try {
      dueVaults = await scanner.findDueVaults();
    } catch (e) {
      caughtError = e as Error;
    }

    expect(caughtError).not.toBeNull();
    expect(caughtError!.message).toBe('RPC Error');
    expect(dueVaults).toEqual([]);
  });

  it('should handle individual vault execution failure and continue', async () => {
    const keypair = createMockKeypair();
    const pool = createTestPool();
    const metrics = new MetricsCollector();
    const jobMonitor = new JobMonitor();
    const executor = new RenewalExecutor(pool, keypair, 100, '0xpackage');

    const mockVaults = [
      { id: '0x123', objectId: '0x123', beneficiary: '0xben1', blobId: '1', walBalance: BigInt(100), renewThresholdEpochs: 10, renewByEpochs: 5, maxTotalEpochs: 365, active: true, currentEndEpoch: 50 },
      { id: '0x456', objectId: '0x456', beneficiary: '0xben2', blobId: '2', walBalance: BigInt(200), renewThresholdEpochs: 10, renewByEpochs: 5, maxTotalEpochs: 365, active: true, currentEndEpoch: 50 },
    ];

    const execSpy = vi.spyOn(executor, 'executeRenewal')
      .mockResolvedValueOnce({ vaultId: '0x123', digest: '0xtx1', gasUsed: BigInt(500), alerts: [] })
      .mockRejectedValueOnce(new Error('Execution failed'));

    for (const vault of mockVaults) {
      metrics.recordStart(vault.id);
      const jobId = await jobMonitor.startJob('renewal');
      try {
        const result = await executor.executeRenewal(vault);
        metrics.recordSuccess(result);
        await jobMonitor.completeJob(jobId, { vaultId: vault.id });
      } catch (error) {
        metrics.recordFailure(vault.id, error as Error);
        await jobMonitor.failJob(jobId, (error as Error).message);
      }
    }

    expect(execSpy).toHaveBeenCalledTimes(2);

    const summary = metrics.summarize();
    expect(summary.attempted).toBe(2);
    expect(summary.succeeded).toBe(1);
    expect(summary.failed).toBe(1);

    const stats = jobMonitor.getStats();
    expect(stats.total).toBe(2);
    expect(stats.success).toBe(1);
    expect(stats.failed).toBe(1);
  });

  it('should send notifications for alerts emitted during execution', async () => {
    const keypair = createMockKeypair();
    const pool = createTestPool();
    const executor = new RenewalExecutor(pool, keypair, 100, '0xpackage');

    const alert: AlertEvent = {
      type: 'InsufficientBalance',
      vaultId: '0x123',
      blobId: '42',
      beneficiary: '0xben',
      timestamp: Date.now(),
      required: BigInt(1000),
      available: BigInt(500),
    };

    vi.spyOn(executor, 'executeRenewal').mockResolvedValue({
      vaultId: '0x123',
      digest: '0xtx',
      gasUsed: BigInt(500),
      alerts: [alert],
    });

    const vault = {
      id: '0x123', objectId: '0x123', beneficiary: '0xben', blobId: '42',
      walBalance: BigInt(500), renewThresholdEpochs: 10, renewByEpochs: 5,
      maxTotalEpochs: 365, active: true, currentEndEpoch: 50,
    };

    const result = await executor.executeRenewal(vault);
    expect(result.alerts.length).toBe(1);
    expect(result.alerts[0].type).toBe('InsufficientBalance');

    const notifier = new NotificationService({ enableConsole: false });
    const sendResults = await notifier.sendAlert(alert);
    expect(sendResults.length).toBe(0);

    const notifierWithConsole = new NotificationService({ enableConsole: true });
    const results = await notifierWithConsole.sendAlert(alert);
    expect(results.length).toBe(1);
    expect(results[0].success).toBe(true);
    expect(results[0].provider).toBe('console');
  });

  it('should handle execution failure due to missing env vars', async () => {
    const keypair = createMockKeypair();
    const pool = createTestPool();

    process.env.PACKAGE_ID = '0xpackage';
    process.env.SYSTEM_OBJECT_ID = '';

    const executor = new RenewalExecutor(pool, keypair, 100, '0xpackage');

    const vault = {
      id: '0x123', objectId: '0x123', beneficiary: '0xben', blobId: '42',
      walBalance: BigInt(500), renewThresholdEpochs: 10, renewByEpochs: 5,
      maxTotalEpochs: 365, active: true, currentEndEpoch: 50,
    };

    let error: Error | null = null;
    try {
      await executor.executeRenewal(vault);
    } catch (e) {
      error = e as Error;
    }
    expect(error).toBeTruthy();
    expect(error!.message).toContain('SYSTEM_OBJECT_ID');
  });
});
