import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockTableData = vi.hoisted(() => {
  const store: Record<string, any[]> = {};
  return store;
});

vi.mock('../db/index.js', () => {
  let lastTableName: string | null = null;

  function thenable(result: any) {
    const p = Promise.resolve(result);
    return {
      then: (onfulfilled: (v: any) => any, onrejected?: (e: any) => any) => p.then(onfulfilled, onrejected),
      catch: (onrejected: (e: any) => any) => p.catch(onrejected),
      finally: (onfinally: () => any) => p.finally(onfinally),
      [Symbol.toStringTag]: 'Promise',
    };
  }

  const mockQuery: any = new Proxy({}, {
    get(_target, prop) {
      if (prop === 'from') return (table: any) => {
        lastTableName = typeof table === 'object' && table !== null
          ? (table._?.name ?? table[Symbol.for('drizzle:Name')] ?? table.name ?? 'unknown')
          : String(table);
        return mockQuery;
      };
      if (prop === 'where') return () => mockQuery;
      if (prop === 'limit') return (n: number) => thenable(mockTableData[lastTableName ?? '']?.slice(0, n) ?? []);
      if (prop === 'orderBy') return () => mockQuery;
      if (prop === 'select') return () => mockQuery;
      if (prop === 'then') return (fn: Function, _r?: Function) => Promise.resolve(fn(mockTableData[lastTableName ?? ''] ?? []));
      if (prop === 'catch') return (fn: Function) => Promise.resolve().catch(fn);
      if (prop === 'finally') return (fn: Function) => Promise.resolve().finally(fn);
      if (prop === Symbol.toStringTag) return 'Promise';
      return mockQuery;
    },
  });

  const mockDb: any = new Proxy({}, {
    get(_target, prop) {
      if (prop === 'select') return () => mockQuery;
      if (prop === 'insert') return () => ({ values: () => ({ returning: () => thenable([{ id: 'mock-id' }]) }) });
      if (prop === 'delete') return () => ({ where: () => thenable(undefined) });
      if (prop === 'update') return () => ({ set: () => ({ where: () => thenable(undefined) }) });
      return undefined;
    },
  });

  return { getDb: () => mockDb };
});

import { requireOrg } from '../middleware/org-scope.js';

describe('Multi-tenancy isolation', () => {
  beforeEach(() => {
    Object.keys(mockTableData).forEach(k => delete mockTableData[k]);
  });

  it('rejects access when org does not exist', async () => {
    mockTableData['organizations'] = [];
    mockTableData['org_members'] = [];

    const ctx: any = {
      get: (k: string) => k === 'userId' ? 'user-1' : undefined,
      set: vi.fn(),
      req: { param: () => 'nonexistent-org', header: () => null },
      json: vi.fn().mockReturnValue({ error: 'not found' }),
    };
    const next = vi.fn();
    await requireOrg(ctx, next);
  });

  it('rejects access when user is not an org member', async () => {
    mockTableData['organizations'] = [{ id: 'org-1', status: 'active' }];
    mockTableData['org_members'] = [];

    const ctx: any = {
      get: (k: string) => k === 'userId' ? 'user-2' : undefined,
      set: vi.fn(),
      req: { param: () => 'org-1', header: () => null },
      json: vi.fn().mockReturnValue({ error: 'forbidden' }),
    };
    const next = vi.fn();
    await requireOrg(ctx, next);
    expect(next).not.toHaveBeenCalled();
  });

  it('allows access when user is a member', async () => {
    const orgId = `org-${Date.now()}`;
    mockTableData['organizations'] = [{ id: orgId, status: 'active' }];
    mockTableData['org_members'] = [{ orgId, userId: 'user-1', role: 'admin' }];

    const ctx: any = {
      get: (k: string) => k === 'userId' ? 'user-1' : undefined,
      set: vi.fn(),
      req: { param: () => orgId, header: () => null },
      json: vi.fn(),
    };
    const next = vi.fn();
    await requireOrg(ctx, next);
    expect(next).toHaveBeenCalled();
  });

  it('rejects access to suspended org', async () => {
    const orgId = `org-suspended-${Date.now()}`;
    mockTableData['organizations'] = [{ id: orgId, status: 'suspended' }];
    mockTableData['org_members'] = [{ orgId, userId: 'user-1', role: 'admin' }];

    const ctx: any = {
      get: (k: string) => k === 'userId' ? 'user-1' : undefined,
      set: vi.fn(),
      req: { param: () => orgId, header: () => null },
      json: vi.fn().mockReturnValue({ error: 'suspended' }),
    };
    const next = vi.fn();
    await requireOrg(ctx, next);
    expect(next).not.toHaveBeenCalled();
  });

  it('different users cannot access each others org data', async () => {
    mockTableData['organizations'] = [
      { id: 'org-a', status: 'active' },
      { id: 'org-b', status: 'active' },
    ];

    const ctxA: any = {
      get: (k: string) => k === 'userId' ? 'user-a' : undefined,
      set: vi.fn(),
      req: { param: () => 'org-b', header: () => null },
      json: vi.fn().mockReturnValue({ error: 'not member' }),
    };
    const nextA = vi.fn();
    await requireOrg(ctxA, nextA);
    expect(nextA).not.toHaveBeenCalled();
  });
});
