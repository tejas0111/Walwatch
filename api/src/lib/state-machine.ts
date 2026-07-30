/**
 * State Machine Enforcement (spec 25)
 *
 * Generic state machine engine that validates transitions for all
 * stateful entities. Every stateful entity in the codebase must
 * register its state machine here.
 *
 * Design:
 * - Each entity defines its states and allowed transitions
 * - Transitions can be automatic (system-driven) or manual (API/human)
 * - Terminal states are tracked for invariant checks
 * - A forbidden transition throws a StateTransitionError (Persistent class)
 */

import { AppError, ErrorCodes } from './errors.js';

// ── Types ──────────────────────────────────────────────────────

export type TransitionType = 'automatic' | 'manual';
export type StateMachineName =
  | 'blob'
  | 'renewal'
  | 'policy'
  | 'alert_rule'
  | 'alert_event'
  | 'webhook'
  | 'notification'
  | 'wallet'
  | 'project'
  | 'organization'
  | 'api_key'
  | 'budget'
  | 'spending_limit'
  | 'schedule'
  | 'subscription';

export interface Transition<TState extends string = string> {
  from: TState;
  to: TState;
  type: TransitionType;
  description?: string;
}

export interface StateMachineDefinition<TState extends string = string> {
  name: StateMachineName;
  states: TState[];
  initial: TState;
  terminal: TState[];
  transitions: Transition<TState>[];
}

// ── Error ──────────────────────────────────────────────────────

export class StateTransitionError extends AppError {
  constructor(entityName: string, from: string, to: string, reason?: string) {
    const msg = reason
      ? `Invalid state transition for ${entityName}: ${from} -> ${to} (${reason})`
      : `Invalid state transition for ${entityName}: ${from} -> ${to}`;
    super(msg, 400, ErrorCodes.VALIDATION_ERROR);
    this.name = 'StateTransitionError';
  }
}

// ── Machine Registry ───────────────────────────────────────────

const machines = new Map<StateMachineName, StateMachineDefinition>();

export function registerMachine<TState extends string>(
  def: StateMachineDefinition<TState>,
): void {
  if (machines.has(def.name)) {
    throw new Error(`State machine '${def.name}' is already registered`);
  }
  machines.set(def.name, def);
}

export function getMachine(name: StateMachineName): StateMachineDefinition {
  const m = machines.get(name);
  if (!m) throw new Error(`State machine '${name}' not found — did you register it?`);
  return m;
}

// ── Transition Validation ──────────────────────────────────────

export interface TransitionOptions {
  /** Allow manual overrides of terminal states (for renewal blocked_by_budget override) */
  allowTerminalOverride?: boolean;
}

/**
 * Validate that `from -> to` is an allowed transition for the given machine.
 * Throws StateTransitionError if not.
 * Returns the transition definition on success.
 */
export function validateTransition<TState extends string>(
  machineName: StateMachineName,
  from: TState,
  to: TState,
  options?: TransitionOptions,
): Transition<TState> {
  const machine = getMachine(machineName) as StateMachineDefinition<TState>;

  if (!machine.states.includes(from)) {
    throw new StateTransitionError(machineName, from, to, `'${from}' is not a valid state`);
  }
  if (!machine.states.includes(to)) {
    throw new StateTransitionError(machineName, from, to, `'${to}' is not a valid state`);
  }

  // Terminal state check
  if (machine.terminal.includes(from) && !options?.allowTerminalOverride) {
    throw new StateTransitionError(
      machineName, from, to,
      `'${from}' is a terminal state — no transitions allowed`,
    );
  }

  const transition = machine.transitions.find(
    (t) => t.from === from && t.to === to,
  );
  if (!transition) {
    throw new StateTransitionError(
      machineName, from, to,
      'transition not defined in spec',
    );
  }

  return transition;
}

/**
 * Build a set of valid next states from a given current state.
 * Useful for API-side validation (e.g. what actions are available).
 */
export function validNextStates<TState extends string>(
  machineName: StateMachineName,
  current: TState,
): { to: TState; type: TransitionType }[] {
  const machine = getMachine(machineName) as StateMachineDefinition<TState>;
  return machine.transitions
    .filter((t) => t.from === current)
    .map((t) => ({ to: t.to as TState, type: t.type }));
}

/**
 * Check if a state is terminal.
 */
export function isTerminal<TState extends string>(
  machineName: StateMachineName,
  state: TState,
): boolean {
  const machine = getMachine(machineName) as StateMachineDefinition<TState>;
  return machine.terminal.includes(state);
}

// ── Entity-specific Machine Definitions ────────────────────────

// Helper to build transitions with less boilerplate
function t<T extends string>(from: T, to: T, type: TransitionType, description?: string): Transition<T> {
  return { from, to, type, description };
}

// Blob (spec 07 — 10 states)
registerMachine({
  name: 'blob',
  initial: 'discovered',
  states: ['discovered', 'verified', 'tracked', 'protected', 'expiring', 'renewing', 'renewed', 'expired', 'archived', 'deleted'],
  terminal: ['deleted'],
  transitions: [
    t('discovered', 'verified', 'automatic', 'On first successful verification'),
    t('verified', 'tracked', 'automatic'),
    t('tracked', 'protected', 'automatic', 'Policy match'),
    t('protected', 'tracked', 'automatic', 'Policy unmatch'),
    t('protected', 'expiring', 'automatic', 'Threshold crossed'),
    t('expiring', 'renewing', 'automatic', 'If protected — auto-renewal'),
    t('expiring', 'renewing', 'manual', 'If tracked — manual request'),
    t('renewing', 'renewed', 'automatic', 'Renewal succeeded'),
    t('renewing', 'expiring', 'automatic', 'Renewal terminal failure'),
    t('renewed', 'tracked', 'automatic'),
    t('renewed', 'protected', 'automatic'),
    t('expiring', 'expired', 'automatic', 'Epoch passed without renewal'),
    t('tracked', 'archived', 'manual'),
    t('protected', 'archived', 'manual'),
    t('discovered', 'archived', 'manual'),
    t('verified', 'archived', 'manual'),
    t('expiring', 'archived', 'manual'),
    t('renewing', 'archived', 'manual'),
    t('renewed', 'archived', 'manual'),
    t('expired', 'archived', 'manual'),
    t('tracked', 'deleted', 'manual'),
    t('protected', 'deleted', 'manual'),
    t('archived', 'deleted', 'manual'),
    t('expired', 'deleted', 'manual'),
  ],
});

// Renewal (spec 25)
registerMachine({
  name: 'renewal',
  initial: 'estimated',
  states: ['estimated', 'pending', 'in_progress', 'succeeded', 'retrying', 'failed_final', 'blocked_by_budget'],
  terminal: ['succeeded', 'failed_final', 'blocked_by_budget'],
  transitions: [
    t('estimated', 'pending', 'automatic', 'Cost check passed (spec 25)'),
    t('pending', 'in_progress', 'automatic', 'Dequeued for execution'),
    t('pending', 'blocked_by_budget', 'automatic', 'Hard spending limit would be exceeded'),
    t('in_progress', 'succeeded', 'automatic', 'Renewal completed'),
    t('in_progress', 'retrying', 'automatic', 'Transient failure, retry budget remaining'),
    t('in_progress', 'failed_final', 'automatic', 'Retries exhausted'),
    t('retrying', 'in_progress', 'automatic', 'Next attempt'),
  ],
});

// Policy (spec 25)
registerMachine({
  name: 'policy',
  initial: 'draft',
  states: ['draft', 'active', 'paused', 'archived'],
  terminal: ['archived'],
  transitions: [
    t('draft', 'active', 'manual', 'Published'),
    t('active', 'paused', 'manual'),
    t('paused', 'active', 'manual'),
    t('active', 'archived', 'manual'),
    t('paused', 'archived', 'manual'),
  ],
});

// Alert Rule (spec 25)
registerMachine({
  name: 'alert_rule',
  initial: 'active',
  states: ['active', 'paused', 'deleted'],
  terminal: ['deleted'],
  transitions: [
    t('active', 'paused', 'manual'),
    t('paused', 'active', 'manual'),
    t('active', 'deleted', 'manual'),
    t('paused', 'deleted', 'manual'),
  ],
});

// Alert Event (spec 25)
registerMachine({
  name: 'alert_event',
  initial: 'fired',
  states: ['fired', 'delivered', 'acknowledged', 'delivery_failed', 'delivery_failed_final', 'escalated'],
  terminal: ['acknowledged', 'escalated'],
  transitions: [
    t('fired', 'delivered', 'automatic', 'All channels delivered'),
    t('fired', 'delivery_failed', 'automatic', 'All channels failed'),
    t('delivery_failed', 'delivered', 'automatic', 'Retry succeeded'),
    t('delivery_failed', 'delivery_failed_final', 'automatic', 'Retries exhausted'),
    t('delivery_failed_final', 'escalated', 'automatic', 'Escalated for human intervention'),
    t('delivered', 'acknowledged', 'manual', 'User acknowledged'),
  ],
});

// Webhook (spec 25)
registerMachine({
  name: 'webhook',
  initial: 'created',
  states: ['created', 'active', 'failing', 'disabled', 'deleted'],
  terminal: ['deleted'],
  transitions: [
    t('created', 'active', 'manual'),
    t('created', 'deleted', 'manual', 'Delete before activation'),
    t('active', 'failing', 'automatic', 'Delivery failures cross threshold'),
    t('failing', 'active', 'automatic', 'Subsequent delivery succeeds'),
    t('failing', 'disabled', 'automatic', 'Threshold exhausted'),
    t('disabled', 'active', 'manual', 'Re-enabled after fix'),
    t('active', 'deleted', 'manual'),
    t('disabled', 'deleted', 'manual'),
  ],
});

// API Key (spec 25)
registerMachine({
  name: 'api_key',
  initial: 'created',
  states: ['created', 'active', 'rotated', 'revoked'],
  terminal: ['revoked'],
  transitions: [
    t('created', 'active', 'manual', 'Activated for use'),
    t('active', 'rotated', 'manual', 'New key issued, old key in overlap window'),
    t('active', 'revoked', 'manual', 'Immediate revocation'),
    t('rotated', 'revoked', 'automatic', 'Overlap window expired'),
  ],
});

// Budget (spec 25)
registerMachine({
  name: 'budget',
  initial: 'defined',
  states: ['defined', 'active', 'window_closed', 'archived'],
  terminal: ['archived'],
  transitions: [
    t('defined', 'active', 'manual', 'Published'),
    t('active', 'window_closed', 'automatic', 'Period end'),
    t('window_closed', 'active', 'automatic', 'Next window rollover'),
    t('active', 'archived', 'manual'),
    t('window_closed', 'archived', 'manual'),
    t('defined', 'archived', 'manual'),
  ],
});

// Spending Limit (spec 25)
registerMachine({
  name: 'spending_limit',
  initial: 'defined',
  states: ['defined', 'active', 'paused', 'archived'],
  terminal: ['archived'],
  transitions: [
    t('defined', 'active', 'manual', 'Published'),
    t('active', 'paused', 'manual'),
    t('paused', 'active', 'manual'),
    t('active', 'archived', 'manual'),
    t('paused', 'archived', 'manual'),
    t('defined', 'archived', 'manual'),
  ],
});

// Organization (spec 25)
registerMachine({
  name: 'organization',
  initial: 'active',
  states: ['active', 'suspended', 'deleted'],
  terminal: ['deleted'],
  transitions: [
    t('active', 'suspended', 'manual', 'Suspend organization'),
    t('suspended', 'active', 'manual', 'Unsuspend organization'),
    t('active', 'deleted', 'manual', 'Delete organization'),
    t('suspended', 'deleted', 'manual', 'Delete suspended organization'),
  ],
});

// Project (spec 25)
registerMachine({
  name: 'project',
  initial: 'active',
  states: ['active', 'archived', 'deleted'],
  terminal: ['deleted'],
  transitions: [
    t('active', 'archived', 'manual', 'Archive project'),
    t('archived', 'active', 'manual', 'Unarchive project'),
    t('active', 'deleted', 'manual', 'Delete project'),
    t('archived', 'deleted', 'manual', 'Delete archived project'),
  ],
});

// Wallet (spec 25)
registerMachine({
  name: 'wallet',
  initial: 'active',
  states: ['active', 'delegation_revoked', 'deleted'],
  terminal: ['deleted'],
  transitions: [
    t('active', 'delegation_revoked', 'manual', 'Revoke delegation'),
    t('delegation_revoked', 'active', 'manual', 'Reconnect delegation'),
    t('active', 'deleted', 'manual', 'Delete wallet'),
  ],
});

// Notification (spec 25)
registerMachine({
  name: 'notification',
  initial: 'queued',
  states: ['queued', 'sent', 'delivered', 'failed'],
  terminal: ['delivered', 'failed'],
  transitions: [
    t('queued', 'sent', 'automatic', 'Delivery attempt started'),
    t('sent', 'delivered', 'automatic', 'Delivery confirmed'),
    t('sent', 'failed', 'automatic', 'Permanent delivery failure'),
  ],
});

// Schedule (spec 10)
registerMachine({
  name: 'schedule',
  initial: 'active',
  states: ['active', 'paused', 'deleted'],
  terminal: ['deleted'],
  transitions: [
    t('active', 'paused', 'manual'),
    t('paused', 'active', 'manual'),
    t('active', 'deleted', 'manual'),
    t('paused', 'deleted', 'manual'),
  ],
});

// Subscription (plan transitions)
registerMachine({
  name: 'subscription',
  initial: 'free',
  states: ['free', 'pro', 'team', 'enterprise'],
  terminal: [],
  transitions: [
    t('free', 'pro', 'manual', 'Upgrade'),
    t('pro', 'team', 'manual', 'Upgrade'),
    t('team', 'enterprise', 'manual', 'Upgrade'),
    t('enterprise', 'team', 'manual', 'Downgrade'),
    t('team', 'pro', 'manual', 'Downgrade'),
    t('pro', 'free', 'manual', 'Downgrade / cancel'),
    t('enterprise', 'free', 'manual', 'Cancel'),
    t('team', 'free', 'manual', 'Cancel'),
  ],
});

export default {
  registerMachine,
  getMachine,
  validateTransition,
  validNextStates,
  isTerminal,
  StateTransitionError,
  machines,
};
