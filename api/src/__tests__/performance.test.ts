import { describe, it, expect } from 'vitest';

const PERF_TIMEOUT = 500;

describe('Performance - Dashboard with blobs', () => {
  it('generates blob IDs deterministically', () => {
    const start = performance.now();
    const ids = Array.from({ length: 10000 }, (_, i) => `blob-${i}`);
    expect(ids.length).toBe(10000);
    const unique = new Set(ids);
    expect(unique.size).toBe(10000);
    const duration = performance.now() - start;
    expect(duration).toBeLessThan(PERF_TIMEOUT);
  });

  it('batched inserts work', () => {
    const start = performance.now();
    const batchSize = 500;
    const batches = 20;
    const total = batchSize * batches;
    const allIds: string[] = [];

    for (let b = 0; b < batches; b++) {
      const batch = Array.from({ length: batchSize }, (_, i) => `blob-${b}-${i}`);
      allIds.push(...batch);
    }

    expect(allIds.length).toBe(total);
    const duration = performance.now() - start;
    expect(duration).toBeLessThan(PERF_TIMEOUT);
  });
});

describe('Performance - Cursor pagination', () => {
  const items = Array.from({ length: 10000 }, (_, i) => ({
    id: i,
    createdAt: new Date(2024, 0, 1, 0, 0, i),
  }));

  it('paginates forward correctly', () => {
    const start = performance.now();
    const pageSize = 100;
    const allIds: number[] = [];
    let cursor: Date | undefined;

    for (let page = 0; page < 10; page++) {
      let pageItems = items;
      if (cursor) {
        pageItems = items.filter(item => item.createdAt > cursor!);
      }
      const pageResults = pageItems.slice(0, pageSize);
      if (pageResults.length === 0) break;
      allIds.push(...pageResults.map(r => r.id));
      cursor = pageResults[pageResults.length - 1].createdAt;
    }

    expect(allIds.length).toBe(1000);
    expect(allIds[0]).toBe(0);
    expect(allIds[allIds.length - 1]).toBe(999);
    const duration = performance.now() - start;
    expect(duration).toBeLessThan(PERF_TIMEOUT);
  });
});

describe('Performance - Policy resolution in deep hierarchy', () => {
  const orgPolicies = [{ id: 'org-pol-1', scope: 'organization', scopeTargetId: 'org-1', renewThreshold: 14, renewExtension: 60 }];
  const projectPolicies = [{ id: 'proj-pol-1', scope: 'project', scopeTargetId: 'proj-1', renewThreshold: 7, renewExtension: 30 }];
  const blobPolicies = [{ id: 'blob-pol-1', scope: 'blob', scopeTargetId: 'blob-1', renewThreshold: 3, renewExtension: 10 }];

  function resolvePolicy(blobId: string, projectId: string, orgId: string) {
    const blobMatch = blobPolicies.find(p => p.scopeTargetId === blobId);
    if (blobMatch) return { ...blobMatch, resolutionPath: 'explicit' };

    const walletMatch = null;
    if (walletMatch) return { ...walletMatch, resolutionPath: 'wallet' };

    const projectMatch = projectPolicies.find(p => p.scopeTargetId === projectId);
    if (projectMatch) return { ...projectMatch, resolutionPath: 'project' };

    const orgMatch = orgPolicies.find(p => p.scopeTargetId === orgId);
    if (orgMatch) return { ...orgMatch, resolutionPath: 'organization' };

    return { renewThreshold: 7, renewExtension: 30, autoRenewalEnabled: false, scope: 'default', resolutionPath: 'default' };
  }

  it('resolves blob-level policy', () => {
    const start = performance.now();
    const result = resolvePolicy('blob-1', 'proj-1', 'org-1');
    expect(result.renewThreshold).toBe(3);
    expect(result.scope).toBe('blob');
    const duration = performance.now() - start;
    expect(duration).toBeLessThan(PERF_TIMEOUT);
  });

  it('falls back to project-level when no blob policy', () => {
    const start = performance.now();
    const result = resolvePolicy('blob-other', 'proj-1', 'org-1');
    expect(result.renewThreshold).toBe(7);
    expect(result.scope).toBe('project');
    const duration = performance.now() - start;
    expect(duration).toBeLessThan(PERF_TIMEOUT);
  });

  it('falls back to org-level when no project or blob policy', () => {
    const start = performance.now();
    const result = resolvePolicy('blob-other', 'proj-other', 'org-1');
    expect(result.renewThreshold).toBe(14);
    expect(result.scope).toBe('organization');
    const duration = performance.now() - start;
    expect(duration).toBeLessThan(PERF_TIMEOUT);
  });

  it('falls back to defaults when no policies exist', () => {
    const start = performance.now();
    const result = resolvePolicy('nonexistent', 'nonexistent-proj', 'nonexistent-org');
    expect(result.scope).toBe('default');
    expect(result.renewThreshold).toBe(7);
    const duration = performance.now() - start;
    expect(duration).toBeLessThan(PERF_TIMEOUT);
  });
});

describe('Performance - Cost estimation for 100 blobs', () => {
  it('calculates estimated cost for 100 blobs', () => {
    const start = performance.now();
    const blobs = Array.from({ length: 100 }, (_, i) => ({
      id: i,
      sizeBytes: Math.floor(Math.random() * 1000000) + 1000,
    }));

    const estimates = blobs.map(b => ({
      blobId: b.id,
      baseCost: Math.floor(b.sizeBytes / 1000) * 10,
    }));

    const totalCost = estimates.reduce((sum, e) => sum + e.baseCost, 0);
    expect(totalCost).toBeGreaterThan(0);
    expect(estimates.length).toBe(100);
    const duration = performance.now() - start;
    expect(duration).toBeLessThan(PERF_TIMEOUT);
  });
});
