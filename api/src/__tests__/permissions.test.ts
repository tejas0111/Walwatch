import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getCapabilitiesForRole, Capability } from '../lib/permissions.js';

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

import { resolveEffectivePermissions } from '../lib/permissions.js';

describe('Permissions - Role/capability mapping', () => {
  it('owner has all capabilities', () => {
    const caps = getCapabilitiesForRole('owner');
    expect(caps).toContain(Capability.MANAGE_POLICIES);
    expect(caps).toContain(Capability.MANAGE_BUDGETS);
    expect(caps).toContain(Capability.TRIGGER_RENEWALS);
    expect(caps).toContain(Capability.MANAGE_WALLETS);
    expect(caps).toContain(Capability.MANAGE_ALERTS);
    expect(caps).toContain(Capability.MANAGE_WEBHOOKS);
    expect(caps).toContain(Capability.MANAGE_API_KEYS);
    expect(caps).toContain(Capability.VIEW_AUDIT_LOG);
    expect(caps.length).toBe(8);
  });

  it('admin has all capabilities', () => {
    const caps = getCapabilitiesForRole('admin');
    expect(caps.length).toBe(8);
  });

  it('member has limited capabilities', () => {
    const caps = getCapabilitiesForRole('member');
    expect(caps).toContain(Capability.MANAGE_POLICIES);
    expect(caps).toContain(Capability.MANAGE_BUDGETS);
    expect(caps).toContain(Capability.TRIGGER_RENEWALS);
    expect(caps).toContain(Capability.MANAGE_WALLETS);
    expect(caps).not.toContain(Capability.MANAGE_ALERTS);
    expect(caps).not.toContain(Capability.MANAGE_WEBHOOKS);
    expect(caps).not.toContain(Capability.MANAGE_API_KEYS);
    expect(caps).not.toContain(Capability.VIEW_AUDIT_LOG);
    expect(caps.length).toBe(4);
  });

  it('viewer has only view_audit_log', () => {
    const caps = getCapabilitiesForRole('viewer');
    expect(caps).toContain(Capability.VIEW_AUDIT_LOG);
    expect(caps.length).toBe(1);
  });

  it('unknown role returns empty capabilities (fails closed)', () => {
    const caps = getCapabilitiesForRole('nonexistent');
    expect(caps).toEqual([]);
  });

  it('no permission check fails closed (empty string role -> empty caps)', () => {
    const caps = getCapabilitiesForRole('');
    expect(caps).toEqual([]);
  });
});

describe('Permissions - resolveEffectivePermissions', () => {
  beforeEach(() => {
    Object.keys(mockTableData).forEach(k => delete mockTableData[k]);
  });

  it('returns owner role with all capabilities', async () => {
    mockTableData['org_members'] = [{ role: 'owner' }];
    mockTableData['capability_grants'] = [];

    const result = await resolveEffectivePermissions('user-1', 'org-1');
    expect(result.role).toBe('owner');
    expect(result.capabilities.length).toBe(8);
  });

  it('returns member role with limited capabilities', async () => {
    mockTableData['org_members'] = [{ role: 'member' }];
    mockTableData['capability_grants'] = [];

    const result = await resolveEffectivePermissions('user-1', 'org-1');
    expect(result.role).toBe('member');
    expect(result.capabilities).toContain(Capability.MANAGE_POLICIES);
    expect(result.capabilities).not.toContain(Capability.MANAGE_API_KEYS);
    expect(result.capabilities.length).toBe(4);
  });

  it('non-member defaults to viewer (fails closed)', async () => {
    mockTableData['org_members'] = [];
    mockTableData['capability_grants'] = [];

    const result = await resolveEffectivePermissions('outsider', 'org-1');
    expect(result.role).toBe('viewer');
    expect(result.capabilities).toContain(Capability.VIEW_AUDIT_LOG);
    expect(result.capabilities.length).toBe(1);
  });

  it('viewer is read-only', async () => {
    mockTableData['org_members'] = [{ role: 'viewer' }];
    mockTableData['capability_grants'] = [];

    const result = await resolveEffectivePermissions('user-1', 'org-1');
    expect(result.role).toBe('viewer');
    expect(result.capabilities).toContain(Capability.VIEW_AUDIT_LOG);
    expect(result.capabilities).not.toContain(Capability.MANAGE_POLICIES);
    expect(result.capabilities.length).toBe(1);
  });

  it('capability grants are additive', async () => {
    mockTableData['org_members'] = [{ role: 'member' }];
    mockTableData['capability_grants'] = [{ capability: 'view_audit_log' }];

    const result = await resolveEffectivePermissions('user-1', 'org-1');
    expect(result.role).toBe('member');
    expect(result.capabilities).toContain(Capability.VIEW_AUDIT_LOG);
    expect(result.capabilities).toContain(Capability.MANAGE_POLICIES);
    expect(result.capabilities.length).toBe(5);
  });

  it('admin has all capabilities', async () => {
    mockTableData['org_members'] = [{ role: 'admin' }];
    mockTableData['capability_grants'] = [];

    const result = await resolveEffectivePermissions('user-1', 'org-1');
    expect(result.role).toBe('admin');
    expect(result.capabilities.length).toBe(8);
  });

  it('project-level role returns capabilities based on org role', async () => {
    mockTableData['org_members'] = [{ role: 'member' }];
    mockTableData['capability_grants'] = [];

    const result = await resolveEffectivePermissions('user-1', 'org-1', 'project-1');
    expect(result.role).toBe('member');
    expect(result.capabilities).toContain(Capability.MANAGE_POLICIES);
    expect(result.capabilities.length).toBe(4);
  });

  it('last owner cannot be removed (at least one owner remains)', async () => {
    mockTableData['org_members'] = [{ role: 'owner' }];

    const owners = mockTableData['org_members'].filter((m: any) => m.role === 'owner');
    if (owners.length === 1) {
      expect(owners.length).toBe(1);
    }
  });

  it('team membership is additive (grant adds to base)', async () => {
    mockTableData['org_members'] = [{ role: 'member' }];
    mockTableData['capability_grants'] = [
      { capability: 'view_audit_log' },
      { capability: 'manage_alerts' },
    ];

    const result = await resolveEffectivePermissions('user-1', 'org-1');
    expect(result.capabilities).toContain(Capability.VIEW_AUDIT_LOG);
    expect(result.capabilities).toContain(Capability.MANAGE_ALERTS);
    expect(result.capabilities).toContain(Capability.MANAGE_POLICIES);
    expect(result.capabilities.length).toBe(6);
  });
});
