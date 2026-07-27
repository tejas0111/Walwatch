import { describe, it, expect, beforeEach } from 'vitest';
import {
  validateTransition,
  validNextStates,
  isTerminal,
  StateTransitionError,
} from '../lib/state-machine.js';

describe('State Machine - Blob lifecycle', () => {
  it('allows discovered -> verified', () => {
    const result = validateTransition('blob', 'discovered', 'verified');
    expect(result.from).toBe('discovered');
    expect(result.to).toBe('verified');
    expect(result.type).toBe('automatic');
  });

  it('allows verified -> tracked', () => {
    const result = validateTransition('blob', 'verified', 'tracked');
    expect(result.to).toBe('tracked');
  });

  it('allows tracked -> protected', () => {
    const result = validateTransition('blob', 'tracked', 'protected');
    expect(result.to).toBe('protected');
  });

  it('allows protected -> expiring', () => {
    const result = validateTransition('blob', 'protected', 'expiring');
    expect(result.to).toBe('expiring');
  });

  it('allows expiring -> renewing (automatic)', () => {
    const result = validateTransition('blob', 'expiring', 'renewing');
    expect(result.type).toBe('automatic');
  });

  it('allows renewing -> renewed', () => {
    const result = validateTransition('blob', 'renewing', 'renewed');
    expect(result.to).toBe('renewed');
  });

  it('allows renewed -> tracked', () => {
    const result = validateTransition('blob', 'renewed', 'tracked');
    expect(result.to).toBe('tracked');
  });

  it('allows expired -> archived', () => {
    const result = validateTransition('blob', 'expired', 'archived');
    expect(result.to).toBe('archived');
  });

  it('allows archived -> deleted', () => {
    const result = validateTransition('blob', 'archived', 'deleted');
    expect(result.to).toBe('deleted');
  });

  it('allows discovered -> archived (any state -> archived)', () => {
    const result = validateTransition('blob', 'discovered', 'archived');
    expect(result.to).toBe('archived');
    expect(result.type).toBe('manual');
  });

  it('allows verified -> archived (any state -> archived)', () => {
    const result = validateTransition('blob', 'verified', 'archived');
    expect(result.to).toBe('archived');
    expect(result.type).toBe('manual');
  });

  it('allows renewing -> expiring (terminal failure rollback)', () => {
    const result = validateTransition('blob', 'renewing', 'expiring');
    expect(result.to).toBe('expiring');
    expect(result.type).toBe('automatic');
  });
});

describe('State Machine - Invalid transitions', () => {
  it('throws StateTransitionError for undefined transition', () => {
    expect(() => validateTransition('blob', 'discovered', 'expired')).toThrow(StateTransitionError);
  });

  it('throws for invalid from state', () => {
    expect(() => validateTransition('blob', 'nonexistent', 'verified' as any)).toThrow(StateTransitionError);
  });

  it('throws for invalid to state', () => {
    expect(() => validateTransition('blob', 'discovered', 'nonexistent' as any)).toThrow(StateTransitionError);
  });

  it('throws transitioning from deleted (terminal)', () => {
    expect(() => validateTransition('blob', 'deleted', 'archived')).toThrow(StateTransitionError);
  });

  it('throws for renewal estimated -> succeeded (direct, not allowed)', () => {
    expect(() => validateTransition('renewal', 'estimated', 'succeeded')).toThrow(StateTransitionError);
  });

  it('throws discovered -> protected (forbidden - must go via verified)', () => {
    expect(() => validateTransition('blob', 'discovered', 'protected')).toThrow(StateTransitionError);
  });

  it('throws expired -> renewing (forbidden - blob must be re-registered)', () => {
    expect(() => validateTransition('blob', 'expired', 'renewing')).toThrow(StateTransitionError);
  });

  it('throws tracked -> expiring (not allowed - must go via protected)', () => {
    expect(() => validateTransition('blob', 'tracked', 'expiring')).toThrow(StateTransitionError);
  });
});

describe('State Machine - Terminal states', () => {
  it('rejects transition from terminal state', () => {
    expect(() => validateTransition('renewal', 'succeeded', 'estimated')).toThrow(StateTransitionError);
  });

  it('rejects transition from failed_final terminal', () => {
    expect(() => validateTransition('renewal', 'failed_final', 'estimated')).toThrow(StateTransitionError);
  });

  it('rejects transition from blocked_by_budget terminal', () => {
    expect(() => validateTransition('renewal', 'blocked_by_budget', 'estimated')).toThrow(StateTransitionError);
  });

  it('isTerminal returns true for deleted', () => {
    expect(isTerminal('blob', 'deleted')).toBe(true);
  });

  it('isTerminal returns false for discovered', () => {
    expect(isTerminal('blob', 'discovered')).toBe(false);
  });

  it('isTerminal returns true for renewal terminal states', () => {
    expect(isTerminal('renewal', 'succeeded')).toBe(true);
    expect(isTerminal('renewal', 'failed_final')).toBe(true);
    expect(isTerminal('renewal', 'blocked_by_budget')).toBe(true);
  });
});

describe('State Machine - allowTerminalOverride', () => {
  it('allows transition from terminal when override is set', () => {
    const result = validateTransition('renewal', 'in_progress', 'succeeded', { allowTerminalOverride: true });
    expect(result.from).toBe('in_progress');
    expect(result.to).toBe('succeeded');
  });

  it('terminal state still requires defined transition even with override', () => {
    expect(() => validateTransition('blob', 'deleted', 'archived', { allowTerminalOverride: true })).toThrow(StateTransitionError);
  });
});

describe('State Machine - validNextStates', () => {
  it('returns correct next states for discovered (verified + archived)', () => {
    const next = validNextStates('blob', 'discovered');
    const toStates = next.map((n) => n.to);
    expect(toStates).toContain('verified');
    expect(toStates).toContain('archived');
    expect(next).toHaveLength(2);
  });

  it('returns correct next states for verified (tracked + archived)', () => {
    const next = validNextStates('blob', 'verified');
    const toStates = next.map((n) => n.to);
    expect(toStates).toContain('tracked');
    expect(toStates).toContain('archived');
  });

  it('returns correct next states for tracked', () => {
    const next = validNextStates('blob', 'tracked');
    const toStates = next.map((n) => n.to);
    expect(toStates).toContain('protected');
    expect(toStates).toContain('archived');
    expect(toStates).toContain('deleted');
  });

  it('returns correct next states for renewing', () => {
    const next = validNextStates('blob', 'renewing');
    const toStates = next.map((n) => n.to);
    expect(toStates).toContain('renewed');
    expect(toStates).toContain('expiring');
    expect(toStates).toContain('archived');
  });

  it('returns correct next states for expiring', () => {
    const next = validNextStates('blob', 'expiring');
    const toStates = next.map((n) => n.to);
    expect(toStates).toContain('renewing');   // both automatic and manual
    expect(toStates).toContain('expired');
    expect(toStates).toContain('archived');
  });

  it('returns empty for terminal state (no outgoing transitions)', () => {
    const next = validNextStates('blob', 'deleted');
    expect(next).toHaveLength(0);
  });
});

describe('State Machine - Renewal (spec 25)', () => {
  it('allows estimated -> pending', () => {
    const result = validateTransition('renewal', 'estimated', 'pending');
    expect(result.to).toBe('pending');
    expect(result.type).toBe('automatic');
  });

  it('allows pending -> in_progress', () => {
    const result = validateTransition('renewal', 'pending', 'in_progress');
    expect(result.to).toBe('in_progress');
    expect(result.type).toBe('automatic');
  });

  it('allows pending -> blocked_by_budget', () => {
    const result = validateTransition('renewal', 'pending', 'blocked_by_budget');
    expect(result.to).toBe('blocked_by_budget');
    expect(result.type).toBe('automatic');
  });

  it('allows in_progress -> succeeded', () => {
    const result = validateTransition('renewal', 'in_progress', 'succeeded');
    expect(result.to).toBe('succeeded');
    expect(result.type).toBe('automatic');
  });

  it('allows in_progress -> retrying', () => {
    const result = validateTransition('renewal', 'in_progress', 'retrying');
    expect(result.to).toBe('retrying');
    expect(result.type).toBe('automatic');
  });

  it('allows in_progress -> failed_final', () => {
    const result = validateTransition('renewal', 'in_progress', 'failed_final');
    expect(result.to).toBe('failed_final');
    expect(result.type).toBe('automatic');
  });

  it('allows retrying -> in_progress', () => {
    const result = validateTransition('renewal', 'retrying', 'in_progress');
    expect(result.to).toBe('in_progress');
    expect(result.type).toBe('automatic');
  });

  it('rejects estimated -> blocked_by_budget (not in spec)', () => {
    expect(() => validateTransition('renewal', 'estimated', 'blocked_by_budget')).toThrow(StateTransitionError);
  });

  it('rejects in_progress -> pending (spec 25 does not allow requeue)', () => {
    expect(() => validateTransition('renewal', 'in_progress', 'pending')).toThrow(StateTransitionError);
  });

  it('rejects retrying -> pending (spec 25 does not allow requeue)', () => {
    expect(() => validateTransition('renewal', 'retrying', 'pending')).toThrow(StateTransitionError);
  });

  it('rejects retrying -> blocked_by_budget (not in spec)', () => {
    expect(() => validateTransition('renewal', 'retrying', 'blocked_by_budget')).toThrow(StateTransitionError);
  });

  it('rejects in_progress -> blocked_by_budget (not in spec)', () => {
    expect(() => validateTransition('renewal', 'in_progress', 'blocked_by_budget')).toThrow(StateTransitionError);
  });

  it('validNextStates for estimated: only pending', () => {
    const next = validNextStates('renewal', 'estimated');
    const toStates = next.map((n) => n.to);
    expect(toStates).toEqual(['pending']);
  });

  it('validNextStates for pending: in_progress and blocked_by_budget', () => {
    const next = validNextStates('renewal', 'pending');
    const toStates = next.map((n) => n.to);
    expect(toStates).toContain('in_progress');
    expect(toStates).toContain('blocked_by_budget');
    expect(next).toHaveLength(2);
  });

  it('validNextStates for in_progress: succeeded, retrying, failed_final', () => {
    const next = validNextStates('renewal', 'in_progress');
    const toStates = next.map((n) => n.to);
    expect(toStates).toContain('succeeded');
    expect(toStates).toContain('retrying');
    expect(toStates).toContain('failed_final');
    expect(next).toHaveLength(3);
  });

  it('validNextStates for retrying: only in_progress', () => {
    const next = validNextStates('renewal', 'retrying');
    const toStates = next.map((n) => n.to);
    expect(toStates).toEqual(['in_progress']);
  });

  it('validNextStates for terminal states return empty', () => {
    expect(validNextStates('renewal', 'succeeded')).toHaveLength(0);
    expect(validNextStates('renewal', 'failed_final')).toHaveLength(0);
    expect(validNextStates('renewal', 'blocked_by_budget')).toHaveLength(0);
  });
});

describe('State Machine - Alert Event (spec 25)', () => {
  it('allows fired -> delivered', () => {
    const result = validateTransition('alert_event', 'fired', 'delivered');
    expect(result.to).toBe('delivered');
    expect(result.type).toBe('automatic');
  });

  it('allows fired -> delivery_failed', () => {
    const result = validateTransition('alert_event', 'fired', 'delivery_failed');
    expect(result.to).toBe('delivery_failed');
    expect(result.type).toBe('automatic');
  });

  it('allows delivery_failed -> delivered (retry)', () => {
    const result = validateTransition('alert_event', 'delivery_failed', 'delivered');
    expect(result.to).toBe('delivered');
    expect(result.type).toBe('automatic');
  });

  it('allows delivery_failed -> delivery_failed_final (retries exhausted)', () => {
    const result = validateTransition('alert_event', 'delivery_failed', 'delivery_failed_final');
    expect(result.to).toBe('delivery_failed_final');
    expect(result.type).toBe('automatic');
  });

  it('allows delivery_failed_final -> escalated', () => {
    const result = validateTransition('alert_event', 'delivery_failed_final', 'escalated');
    expect(result.to).toBe('escalated');
    expect(result.type).toBe('automatic');
  });

  it('allows delivered -> acknowledged', () => {
    const result = validateTransition('alert_event', 'delivered', 'acknowledged');
    expect(result.to).toBe('acknowledged');
    expect(result.type).toBe('manual');
  });

  it('rejects partial_delivery (state removed per spec 25)', () => {
    expect(() => validateTransition('alert_event', 'fired', 'partial_delivery' as any)).toThrow(StateTransitionError);
  });

  it('rejects fired -> acknowledged (must go via delivered)', () => {
    expect(() => validateTransition('alert_event', 'fired', 'acknowledged')).toThrow(StateTransitionError);
  });
});

describe('State Machine - API Key (spec 25)', () => {
  it('allows created -> active', () => {
    const result = validateTransition('api_key', 'created', 'active');
    expect(result.to).toBe('active');
    expect(result.type).toBe('manual');
  });

  it('allows active -> rotated', () => {
    const result = validateTransition('api_key', 'active', 'rotated');
    expect(result.to).toBe('rotated');
    expect(result.type).toBe('manual');
  });

  it('allows active -> revoked', () => {
    const result = validateTransition('api_key', 'active', 'revoked');
    expect(result.to).toBe('revoked');
    expect(result.type).toBe('manual');
  });

  it('allows rotated -> revoked (overlap window expired)', () => {
    const result = validateTransition('api_key', 'rotated', 'revoked');
    expect(result.to).toBe('revoked');
    expect(result.type).toBe('automatic');
  });

  it('rejects revoked -> anything (terminal)', () => {
    expect(() => validateTransition('api_key', 'revoked', 'active')).toThrow(StateTransitionError);
  });
});

describe('State Machine - Budget (spec 25)', () => {
  it('allows defined -> active', () => {
    const result = validateTransition('budget', 'defined', 'active');
    expect(result.to).toBe('active');
  });

  it('allows active -> window_closed', () => {
    const result = validateTransition('budget', 'active', 'window_closed');
    expect(result.to).toBe('window_closed');
    expect(result.type).toBe('automatic');
  });

  it('allows window_closed -> active (rollover)', () => {
    const result = validateTransition('budget', 'window_closed', 'active');
    expect(result.to).toBe('active');
    expect(result.type).toBe('automatic');
  });

  it('rejects paused state (not a valid budget state per spec 25)', () => {
    expect(() => validateTransition('budget', 'active', 'paused' as any)).toThrow(StateTransitionError);
  });
});

describe('State Machine - Alert Rule machine', () => {
  it('allows active -> paused', () => {
    const result = validateTransition('alert_rule', 'active', 'paused');
    expect(result.to).toBe('paused');
  });

  it('allows paused -> active', () => {
    const result = validateTransition('alert_rule', 'paused', 'active');
    expect(result.to).toBe('active');
  });

  it('allows paused -> deleted', () => {
    const result = validateTransition('alert_rule', 'paused', 'deleted');
    expect(result.to).toBe('deleted');
  });

  it('rejects deleted -> anything (terminal)', () => {
    expect(() => validateTransition('alert_rule', 'deleted', 'active')).toThrow(StateTransitionError);
  });
});

describe('State Machine - Spending Limit (spec 25)', () => {
  it('allows defined -> active', () => {
    const result = validateTransition('spending_limit', 'defined', 'active');
    expect(result.to).toBe('active');
  });

  it('allows active -> paused', () => {
    const result = validateTransition('spending_limit', 'active', 'paused');
    expect(result.to).toBe('paused');
  });

  it('allows paused -> active', () => {
    const result = validateTransition('spending_limit', 'paused', 'active');
    expect(result.to).toBe('active');
  });

  it('allows active -> archived', () => {
    const result = validateTransition('spending_limit', 'active', 'archived');
    expect(result.to).toBe('archived');
  });

  it('allows defined -> archived', () => {
    const result = validateTransition('spending_limit', 'defined', 'archived');
    expect(result.to).toBe('archived');
  });

  it('rejects archived -> anything (terminal)', () => {
    expect(() => validateTransition('spending_limit', 'archived', 'active')).toThrow(StateTransitionError);
  });
});

describe('State Machine - Policy', () => {
  it('allows draft -> active', () => {
    const result = validateTransition('policy', 'draft', 'active');
    expect(result.to).toBe('active');
    expect(result.type).toBe('manual');
  });

  it('allows active -> paused', () => {
    const result = validateTransition('policy', 'active', 'paused');
    expect(result.to).toBe('paused');
    expect(result.type).toBe('manual');
  });

  it('allows paused -> active', () => {
    const result = validateTransition('policy', 'paused', 'active');
    expect(result.to).toBe('active');
    expect(result.type).toBe('manual');
  });

  it('allows active -> archived', () => {
    const result = validateTransition('policy', 'active', 'archived');
    expect(result.to).toBe('archived');
    expect(result.type).toBe('manual');
  });

  it('allows paused -> archived', () => {
    const result = validateTransition('policy', 'paused', 'archived');
    expect(result.to).toBe('archived');
    expect(result.type).toBe('manual');
  });

  it('rejects draft -> archived (not in spec)', () => {
    expect(() => validateTransition('policy', 'draft', 'archived')).toThrow(StateTransitionError);
  });

  it('rejects archived -> anything (terminal)', () => {
    expect(() => validateTransition('policy', 'archived', 'active')).toThrow(StateTransitionError);
  });

  it('rejects draft -> paused (not in spec)', () => {
    expect(() => validateTransition('policy', 'draft', 'paused')).toThrow(StateTransitionError);
  });
});

describe('State Machine - Webhook', () => {
  it('allows created -> active', () => {
    const result = validateTransition('webhook', 'created', 'active');
    expect(result.to).toBe('active');
    expect(result.type).toBe('manual');
  });

  it('allows active -> failing', () => {
    const result = validateTransition('webhook', 'active', 'failing');
    expect(result.to).toBe('failing');
    expect(result.type).toBe('automatic');
  });

  it('allows failing -> active', () => {
    const result = validateTransition('webhook', 'failing', 'active');
    expect(result.to).toBe('active');
    expect(result.type).toBe('automatic');
  });

  it('allows failing -> disabled', () => {
    const result = validateTransition('webhook', 'failing', 'disabled');
    expect(result.to).toBe('disabled');
    expect(result.type).toBe('automatic');
  });

  it('allows disabled -> active', () => {
    const result = validateTransition('webhook', 'disabled', 'active');
    expect(result.to).toBe('active');
    expect(result.type).toBe('manual');
  });

  it('allows active -> deleted', () => {
    const result = validateTransition('webhook', 'active', 'deleted');
    expect(result.to).toBe('deleted');
    expect(result.type).toBe('manual');
  });

  it('allows created -> deleted', () => {
    const result = validateTransition('webhook', 'created', 'deleted');
    expect(result.to).toBe('deleted');
    expect(result.type).toBe('manual');
  });

  it('rejects created -> failing (must activate first)', () => {
    expect(() => validateTransition('webhook', 'created', 'failing')).toThrow(StateTransitionError);
  });

  it('rejects created -> disabled (must go via failing)', () => {
    expect(() => validateTransition('webhook', 'created', 'disabled')).toThrow(StateTransitionError);
  });

  it('rejects deleted -> anything (terminal)', () => {
    expect(() => validateTransition('webhook', 'deleted', 'active')).toThrow(StateTransitionError);
  });
});

describe('State Machine - Schedule', () => {
  it('allows active -> paused', () => {
    const result = validateTransition('schedule', 'active', 'paused');
    expect(result.to).toBe('paused');
    expect(result.type).toBe('manual');
  });

  it('allows paused -> active', () => {
    const result = validateTransition('schedule', 'paused', 'active');
    expect(result.to).toBe('active');
    expect(result.type).toBe('manual');
  });

  it('allows active -> deleted', () => {
    const result = validateTransition('schedule', 'active', 'deleted');
    expect(result.to).toBe('deleted');
    expect(result.type).toBe('manual');
  });

  it('allows paused -> deleted', () => {
    const result = validateTransition('schedule', 'paused', 'deleted');
    expect(result.to).toBe('deleted');
    expect(result.type).toBe('manual');
  });

  it('rejects deleted -> anything (terminal)', () => {
    expect(() => validateTransition('schedule', 'deleted', 'active')).toThrow(StateTransitionError);
  });

  it('rejects paused -> active -> invalid direction test', () => {
    expect(() => validateTransition('schedule', 'paused', 'nonexistent' as any)).toThrow(StateTransitionError);
  });
});

describe('State Machine - Organization', () => {
  it('allows active -> suspended', () => {
    const result = validateTransition('organization', 'active', 'suspended');
    expect(result.to).toBe('suspended');
    expect(result.type).toBe('manual');
  });

  it('allows suspended -> active', () => {
    const result = validateTransition('organization', 'suspended', 'active');
    expect(result.to).toBe('active');
    expect(result.type).toBe('manual');
  });

  it('allows active -> deleted', () => {
    const result = validateTransition('organization', 'active', 'deleted');
    expect(result.to).toBe('deleted');
    expect(result.type).toBe('manual');
  });

  it('allows suspended -> deleted', () => {
    const result = validateTransition('organization', 'suspended', 'deleted');
    expect(result.to).toBe('deleted');
    expect(result.type).toBe('manual');
  });

  it('rejects deleted -> anything (terminal)', () => {
    expect(() => validateTransition('organization', 'deleted', 'active')).toThrow(StateTransitionError);
  });

  it('rejects suspended -> nonexistent state', () => {
    expect(() => validateTransition('organization', 'suspended', 'archived' as any)).toThrow(StateTransitionError);
  });
});

describe('State Machine - Project', () => {
  it('allows active -> archived', () => {
    const result = validateTransition('project', 'active', 'archived');
    expect(result.to).toBe('archived');
    expect(result.type).toBe('manual');
  });

  it('allows archived -> active', () => {
    const result = validateTransition('project', 'archived', 'active');
    expect(result.to).toBe('active');
    expect(result.type).toBe('manual');
  });

  it('allows active -> deleted', () => {
    const result = validateTransition('project', 'active', 'deleted');
    expect(result.to).toBe('deleted');
    expect(result.type).toBe('manual');
  });

  it('allows archived -> deleted', () => {
    const result = validateTransition('project', 'archived', 'deleted');
    expect(result.to).toBe('deleted');
    expect(result.type).toBe('manual');
  });

  it('rejects deleted -> anything (terminal)', () => {
    expect(() => validateTransition('project', 'deleted', 'active')).toThrow(StateTransitionError);
  });

  it('rejects active -> suspended (not a project state)', () => {
    expect(() => validateTransition('project', 'active', 'suspended' as any)).toThrow(StateTransitionError);
  });
});

describe('State Machine - Wallet', () => {
  it('allows active -> delegation_revoked', () => {
    const result = validateTransition('wallet', 'active', 'delegation_revoked');
    expect(result.to).toBe('delegation_revoked');
    expect(result.type).toBe('manual');
  });

  it('allows delegation_revoked -> active', () => {
    const result = validateTransition('wallet', 'delegation_revoked', 'active');
    expect(result.to).toBe('active');
    expect(result.type).toBe('manual');
  });

  it('allows active -> deleted', () => {
    const result = validateTransition('wallet', 'active', 'deleted');
    expect(result.to).toBe('deleted');
    expect(result.type).toBe('manual');
  });

  it('rejects deleted -> anything (terminal)', () => {
    expect(() => validateTransition('wallet', 'deleted', 'active')).toThrow(StateTransitionError);
  });

  it('rejects delegation_revoked -> deleted (not in spec)', () => {
    expect(() => validateTransition('wallet', 'delegation_revoked', 'deleted')).toThrow(StateTransitionError);
  });

  it('rejects active -> suspended (not a wallet state)', () => {
    expect(() => validateTransition('wallet', 'active', 'suspended' as any)).toThrow(StateTransitionError);
  });
});

describe('State Machine - Notification', () => {
  it('allows queued -> sent', () => {
    const result = validateTransition('notification', 'queued', 'sent');
    expect(result.to).toBe('sent');
    expect(result.type).toBe('automatic');
  });

  it('allows sent -> delivered', () => {
    const result = validateTransition('notification', 'sent', 'delivered');
    expect(result.to).toBe('delivered');
    expect(result.type).toBe('automatic');
  });

  it('allows sent -> failed', () => {
    const result = validateTransition('notification', 'sent', 'failed');
    expect(result.to).toBe('failed');
    expect(result.type).toBe('automatic');
  });

  it('rejects failed -> delivered (terminal)', () => {
    expect(() => validateTransition('notification', 'failed', 'delivered')).toThrow(StateTransitionError);
  });

  it('rejects delivered -> anything (terminal)', () => {
    expect(() => validateTransition('notification', 'delivered', 'sent')).toThrow(StateTransitionError);
  });

  it('rejects queued -> delivered (must go via sent)', () => {
    expect(() => validateTransition('notification', 'queued', 'delivered')).toThrow(StateTransitionError);
  });

  it('rejects queued -> failed (must go via sent)', () => {
    expect(() => validateTransition('notification', 'queued', 'failed')).toThrow(StateTransitionError);
  });
});
