import { describe, it, expect, beforeEach } from 'vitest';
import { JobMonitor } from '../job-monitor.js';

describe('JobMonitor', () => {
  let monitor: JobMonitor;

  beforeEach(() => {
    monitor = new JobMonitor();
  });

  it('should start with zero stats', () => {
    const stats = monitor.getStats();
    expect(stats.total).toBe(0);
    expect(stats.success).toBe(0);
    expect(stats.failed).toBe(0);
    expect(stats.running).toBe(0);
    expect(stats.avgDurationMs).toBe(0);
  });

  it('should track a scan job from start to completion', async () => {
    const id = await monitor.startJob('scan');

    const stats = monitor.getStats();
    expect(stats.total).toBe(1);
    expect(stats.running).toBe(1);

    await new Promise((r) => setTimeout(r, 10));

    await monitor.completeJob(id, { vaultsScanned: 5 });

    const record = monitor.getLatestJob('scan');
    expect(record).toBeDefined();
    expect(record!.status).toBe('success');
    expect(record!.durationMs).toBeGreaterThanOrEqual(10);
    expect(record!.details).toEqual({ vaultsScanned: 5 });

    const statsAfter = monitor.getStats();
    expect(statsAfter.success).toBe(1);
    expect(statsAfter.running).toBe(0);
    expect(statsAfter.avgDurationMs).toBeGreaterThanOrEqual(10);
  });

  it('should track a renewal job that fails', async () => {
    const id = await monitor.startJob('renewal');
    await monitor.failJob(id, 'Insufficient gas');

    const record = monitor.getLatestJob('renewal');
    expect(record).toBeDefined();
    expect(record!.status).toBe('failed');
    expect(record!.error).toBe('Insufficient gas');
    expect(record!.durationMs).toBeGreaterThanOrEqual(0);

    const stats = monitor.getStats();
    expect(stats.failed).toBe(1);
    expect(stats.total).toBe(1);
  });

  it('should get stats after multiple jobs', async () => {
    const scan1 = await monitor.startJob('scan');
    const scan2 = await monitor.startJob('scan');
    const renewal1 = await monitor.startJob('renewal');

    await monitor.completeJob(scan1, { vaultsScanned: 3 });
    await monitor.completeJob(scan2, { vaultsScanned: 7 });
    await monitor.failJob(renewal1, 'RPC timeout');

    const stats = monitor.getStats();
    expect(stats.total).toBe(3);
    expect(stats.success).toBe(2);
    expect(stats.failed).toBe(1);
    expect(stats.running).toBe(0);
  });

  it('should return latest job per type', async () => {
    const scan1 = await monitor.startJob('scan');
    const renewal1 = await monitor.startJob('renewal');
    const scan2 = await monitor.startJob('scan');
    const renewal2 = await monitor.startJob('renewal');

    await monitor.completeJob(scan1);
    await monitor.completeJob(renewal1);
    await monitor.failJob(scan2, 'timeout');
    await monitor.completeJob(renewal2);

    const latestScan = monitor.getLatestJob('scan');
    expect(latestScan).toBeDefined();
    expect(latestScan!.id).toBe(scan2);
    expect(latestScan!.status).toBe('failed');

    const latestRenewal = monitor.getLatestJob('renewal');
    expect(latestRenewal).toBeDefined();
    expect(latestRenewal!.id).toBe(renewal2);
    expect(latestRenewal!.status).toBe('success');

    expect(monitor.getLatestJob('notification')).toBeUndefined();
  });

  it('should respect max record limit', async () => {
    const smallMonitor = new JobMonitor(3);

    const ids = [];
    for (let i = 0; i < 5; i++) {
      ids.push(await smallMonitor.startJob('scan'));
    }

    expect(smallMonitor.getRecentJobs().length).toBe(3);
    expect(smallMonitor.getStats().total).toBe(3);
  });

  it('should reset all records', async () => {
    await monitor.startJob('scan');
    await monitor.startJob('renewal');
    expect(monitor.getStats().total).toBe(2);

    monitor.reset();
    expect(monitor.getStats().total).toBe(0);
    expect(monitor.getRecentJobs()).toEqual([]);
  });

  it('should return recent jobs in reverse order', async () => {
    const ids = [];
    for (let i = 0; i < 3; i++) {
      ids.push(await monitor.startJob('scan'));
    }

    const recent = monitor.getRecentJobs();
    expect(recent[0].id).toBe(ids[2]);
    expect(recent[1].id).toBe(ids[1]);
    expect(recent[2].id).toBe(ids[0]);
  });
});
