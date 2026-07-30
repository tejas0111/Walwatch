import { pgTable, pgEnum, uuid, text, timestamp, uniqueIndex, primaryKey, index, jsonb, bigint, integer, boolean, numeric } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  name: text('name'),
  // OAuth / zkLogin fields
  oauthProvider: text('oauth_provider'),
  oauthSubject: text('oauth_subject'),
  oauthEmail: text('oauth_email'),
  zkloginAddress: text('zklogin_address'),
  ephemeralKeyEncrypted: text('ephemeral_key_encrypted'),
  ephemeralKeyExpiry: timestamp('ephemeral_key_expiry', { withTimezone: true }),
  zkloginProofEncrypted: text('zklogin_proof_encrypted'),
  zkloginJwtRandomness: text('zklogin_jwt_randomness'),
  zkloginMaxEpoch: bigint('zklogin_max_epoch', { mode: 'number' }),
  lastKeyExportAt: timestamp('last_key_export_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  emailUnique: uniqueIndex('users_email_unique').on(table.email),
  oauthUnique: uniqueIndex('users_oauth_unique').on(table.oauthProvider, table.oauthSubject),
}));

export const sessions = pgTable('sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const organizations = pgTable('organizations', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  status: text('status').default('active').notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  suspendedAt: timestamp('suspended_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  slugUnique: uniqueIndex('orgs_slug_unique').on(table.slug),
}));

export const orgMembers = pgTable('org_members', {
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').notNull().default('member'),
  joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.orgId, table.userId] }),
}));

export const projects = pgTable('projects', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  description: text('description'),
  environment: text('environment').default('development'),
  defaultWalletId: text('default_wallet_id'),
  status: text('status').default('active').notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  orgSlugUnique: uniqueIndex('projects_org_slug_unique').on(table.orgId, table.slug),
}));

/**
 * Blob lifecycle per spec 07 (10 states):
 *   Discovered -> Verified -> Tracked -> Protected -> Expiring -> Renewing
 *     -> Renewed (back to Tracked/Protected)
 *     -> Expired -> Archived -> Deleted
 */
export const blobRegistrations = pgTable('blob_registrations', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'set null' }),
  walletId: uuid('wallet_id').references(() => wallets.id, { onDelete: 'set null' }),
  blobId: text('blob_id').notNull(),
  name: text('name'),
  sizeBytes: bigint('size_bytes', { mode: 'number' }),
  contentType: text('content_type'),
  // 10-state lifecycle: discovered, verified, tracked, protected, expiring, renewing, renewed, expired, archived, deleted
  status: text('status').default('discovered').notNull(),
  uploadDate: timestamp('upload_date', { withTimezone: true }),
  expiryEpoch: bigint('expiry_epoch', { mode: 'number' }),
  metadata: jsonb('metadata').default({}),
  tags: text('tags').array().default([]),
  suiVaultId: text('sui_vault_id'),
  ownerAddress: text('owner_address'),
  // Transition timestamps for lifecycle tracking
  discoveredAt: timestamp('discovered_at', { withTimezone: true }).defaultNow().notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  trackedAt: timestamp('tracked_at', { withTimezone: true }),
  protectedAt: timestamp('protected_at', { withTimezone: true }),
  expiringAt: timestamp('expiring_at', { withTimezone: true }),
  renewingAt: timestamp('renewing_at', { withTimezone: true }),
  renewedAt: timestamp('renewed_at', { withTimezone: true }),
  expiredAt: timestamp('expired_at', { withTimezone: true }),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  blobIdIndex: uniqueIndex('blob_registrations_blob_id_idx').on(table.blobId),
}));

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id'),  // nullable for system-generated events (notification failures, escalations)
  action: text('action').notNull(),
  resourceType: text('resource_type').notNull(),
  resourceId: text('resource_id'),
  details: jsonb('details').default({}),
  ipAddress: text('ip_address'),
  traceId: text('trace_id'),  // correlation ID for traceability (Spec 18)
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Activity Feed (Spec 18) — human-readable, reverse-chronological event log.
 * Derived from the same events as audit_logs but optimized for browsing.
 * May be pruned; losing feed entries is acceptable.
 */
export const activityFeed = pgTable('activity_feed', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  actorType: text('actor_type').notNull(),  // 'human' | 'system' | 'api_key'
  actorId: text('actor_id'),  // userId, keyId, or system identifier
  action: text('action').notNull(),
  resourceType: text('resource_type').notNull(),
  resourceId: text('resource_id'),
  summary: text('summary').notNull(),  // human-readable summary of what happened
  details: jsonb('details').default({}),
  traceId: text('trace_id'),  // correlation ID linking to audit_logs
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  feedOrgIdx: index('idx_activity_feed_org_id').on(table.orgId),
  feedOrgTimeIdx: index('idx_activity_feed_org_time').on(table.orgId, table.createdAt),
}));

/**
 * Policy state machine (spec 25):
 *   Draft -> Active <-> Paused -> Archived (terminal)
 */
export const policies = pgTable('policies', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  rules: jsonb('rules').default([]).notNull(),
  renewThreshold: integer('renew_threshold').notNull(),
  renewExtension: integer('renew_extension').notNull(),
  maxTotalEpochs: integer('max_total_epochs'),
  autoRenewalEnabled: boolean('auto_renewal_enabled').default(true).notNull(),
  active: boolean('active').default(true).notNull(),
  scope: text('scope'),  // organization | project | wallet | blob | tag
  scopeTargetId: text('scope_target_id'),
  budgetId: uuid('budget_id').references(() => budgets.id, { onDelete: 'set null' }),
  spendingLimitId: uuid('spending_limit_id').references(() => spendingLimits.id, { onDelete: 'set null' }),
  publisherPriorityOverride: integer('publisher_priority_override'),
  maxRetries: integer('max_retries').default(5),
  status: text('status').default('draft').notNull(),  // draft | active | paused | archived
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const wallets = pgTable('wallets', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
  address: text('address').notNull(),
  label: text('label'),
  type: text('type').default('owned').notNull(),
  isDefault: boolean('is_default').default(false).notNull(),
  spendingLimit: bigint('spending_limit', { mode: 'number' }),
  balance: bigint('balance', { mode: 'number' }).default(0).notNull(),
  status: text('status').default('active').notNull(),
  delegationRevokedAt: timestamp('delegation_revoked_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  orgAddressUnique: uniqueIndex('wallets_org_address_unique').on(table.orgId, table.projectId, table.address).where(sql`deleted_at IS NULL`),
}));

export const delegations = pgTable('delegations', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  walletId: uuid('wallet_id').notNull().references(() => wallets.id, { onDelete: 'cascade' }),
  delegateAddress: text('delegate_address').notNull(),
  scope: text('scope').notNull(),
  scopeTargets: jsonb('scope_targets').default([]),
  spendCeiling: text('spend_ceiling').default('0').notNull(),
  timeBoundStart: timestamp('time_bound_start', { withTimezone: true }).defaultNow().notNull(),
  timeBoundEnd: timestamp('time_bound_end', { withTimezone: true }),
  isRevoked: boolean('is_revoked').default(false),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  walletIdx: index('idx_delegations_wallet').on(table.walletId),
  delegateIdx: index('idx_delegations_delegate').on(table.delegateAddress),
}));

export const policyAssignments = pgTable('policy_assignments', {
  policyId: uuid('policy_id').notNull().references(() => policies.id, { onDelete: 'cascade' }),
  blobRegistrationId: uuid('blob_registration_id').notNull().references(() => blobRegistrations.id, { onDelete: 'cascade' }),
}, (table) => ({
  pk: primaryKey({ columns: [table.policyId, table.blobRegistrationId] }),
}));

export const notificationChannels = pgTable('notification_channels', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  name: text('name').notNull(),
  config: jsonb('config').notNull(),
  enabled: boolean('enabled').default(true).notNull(),
  status: text('status').default('active').notNull(),
  keyVersion: integer('key_version').default(1).notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Alert Rule state machine (spec 25):
 *   Active <-> Paused -> Deleted (terminal)
 */
export const alertRules = pgTable('alert_rules', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  trigger: text('trigger').notNull(),
  conditions: jsonb('conditions').default({}),
  channelIds: text('channel_ids').array().notNull().default([]),
  projectIds: text('project_ids').array().default([]),
  enabled: boolean('enabled').default(true).notNull(),
  status: text('status').default('active').notNull(),  // active | paused | deleted
  dedupWindowSeconds: integer('dedup_window_seconds').default(300),  // tunable dedup window (default 5 min)
  escalationChannels: jsonb('escalation_channels').default('[]'),
  pausedAt: timestamp('paused_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }).unique(),
  plan: text('plan').notNull().default('free'),
  status: text('status').notNull().default('active'),
  currentPeriodStart: timestamp('current_period_start', { withTimezone: true }).defaultNow().notNull(),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  paymentMethod: text('payment_method'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const usageRecords = pgTable('usage_records', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  metric: text('metric').notNull(),
  value: bigint('value', { mode: 'number' }).notNull(),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * API Key state machine (spec 25):
 *   Created -> Active -> Rotated -> Revoked (terminal)
 */
export const apiKeys = pgTable('api_keys', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  keyHash: text('key_hash').notNull(),
  previousKeyHash: text('previous_key_hash'),
  keyPrefix: text('key_prefix').notNull(),
  role: text('role').default('member'),
  permissions: text('permissions').array().default([]),
  status: text('status').default('active').notNull(),  // created | active | rotated | revoked
  rotatedAt: timestamp('rotated_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const invoices = pgTable('invoices', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  subscriptionId: uuid('subscription_id').references(() => subscriptions.id, { onDelete: 'set null' }),
  amount: bigint('amount', { mode: 'number' }).notNull(),
  currency: text('currency').default('usd').notNull(),
  status: text('status').default('pending').notNull(),
  dueDate: timestamp('due_date', { withTimezone: true }),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const publishers = pgTable('publishers', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  endpoint: text('endpoint'),
  walletAddress: text('wallet_address'),
  suiVaultId: text('sui_vault_id'),
  status: text('status').default('active').notNull(),
  lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Project-Publisher assignment with priority ordering (Spec 08).
 * Publishers are ordered by priority (ascending) per project.
 * The renewal engine selects the highest-priority healthy publisher.
 */
export const projectMembers = pgTable('project_members', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull(),
  role: text('role').notNull().default('member'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  uniqueMembership: uniqueIndex('project_members_unique').on(table.projectId, table.userId),
}));

export const projectPublishers = pgTable('project_publishers', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  publisherId: uuid('publisher_id').notNull().references(() => publishers.id, { onDelete: 'cascade' }),
  priority: integer('priority').notNull().default(0),
  status: text('status').default('active').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  projectPriorityUnique: uniqueIndex('project_publishers_priority_unique').on(table.projectId, table.publisherId),
}));

export const aggregators = pgTable('aggregators', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  publisherId: uuid('publisher_id').references(() => publishers.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  endpoint: text('endpoint'),
  status: text('status').default('active').notNull(),
  lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Budget state machine (spec 25):
 *   Defined -> Active (accruing) -> Window_Closed -> Active (next window)
 *                                      |
 *                                  Archived (terminal)
 */
export const budgets = pgTable('budgets', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  amount: bigint('amount', { mode: 'number' }).notNull(),
  period: text('period').default('monthly').notNull(),
  spent: bigint('spent', { mode: 'number' }).default(0).notNull(),
  currency: text('currency').default('usd').notNull(),
  status: text('status').default('defined').notNull(),  // defined | active | window_closed | archived
  alertThreshold: integer('alert_threshold').default(80),
  windowStart: timestamp('window_start', { withTimezone: true }).defaultNow().notNull(),
  windowEnd: timestamp('window_end', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Spending Limit state machine (spec 25):
 *   Defined -> Active (enforcing) <-> Paused (not enforcing) -> Archived (terminal)
 */
export const spendingLimitScope = pgEnum('spending_limit_scope', ['organization', 'project', 'wallet', 'policy']);

export const spendingLimits = pgTable('spending_limits', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  scope: spendingLimitScope('scope').notNull(),
  scopeTargetId: uuid('scope_target_id').notNull(),
  name: text('name'),
  amount: bigint('amount', { mode: 'number' }).notNull(),
  period: text('period').default('daily').notNull(),
  spent: bigint('spent', { mode: 'number' }).default(0).notNull(),
  status: text('status').default('defined').notNull(),  // defined | active | paused | archived
  pausedAt: timestamp('paused_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Renewal Job state machine (spec 25):
 *   estimated -> pending -> in_progress -> succeeded (terminal)
 *                                |
 *                             retrying -> in_progress (loop, bounded)
 *                                |
 *                        failed_final (terminal)
 *                                |
 *                        blocked_by_budget (terminal, override creates new record)
 */
export const renewalJobs = pgTable('renewal_jobs', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  blobRegistrationId: uuid('blob_registration_id').notNull().references(() => blobRegistrations.id, { onDelete: 'cascade' }),
  policyId: uuid('policy_id').references(() => policies.id, { onDelete: 'set null' }),
  status: text('status').default('estimated').notNull(),
  attempt: integer('attempt').default(0).notNull(),
  maxAttempts: integer('max_attempts').default(5).notNull(),
  lastError: text('last_error'),
  estimatedCost: bigint('estimated_cost', { mode: 'number' }),
  actualCost: numeric('actual_cost', { precision: 20, scale: 2 }),
  txDigest: text('tx_digest'),
  blockedByLimitId: uuid('blocked_by_limit_id').references(() => spendingLimits.id, { onDelete: 'set null' }),
  supersedes: uuid('supersedes'),
  priority: integer('priority').default(50),
  spendingLimitOverridden: boolean('spending_limit_overridden').default(false),
  metadata: jsonb('metadata').default({}),
  scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
  estimatedAt: timestamp('estimated_at', { withTimezone: true }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Cost Records — immutable append-only ledger for renewal costs (Spec 11).
 * Once written, records cannot be updated or deleted (enforced by DB trigger).
 * Budget spent is derived from this table via SUM queries.
 */
export const costRecords = pgTable('cost_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  blobRegistrationId: uuid('blob_registration_id').references(() => blobRegistrations.id, { onDelete: 'set null' }),
  renewalJobId: uuid('renewal_job_id').references(() => renewalJobs.id, { onDelete: 'set null' }),
  estimatedCost: numeric('estimated_cost', { precision: 20, scale: 6 }),
  actualCost: numeric('actual_cost', { precision: 20, scale: 6 }),
  windowId: text('window_id'),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).defaultNow(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
});

/**
 * Teams
 */
export const teams = pgTable('teams', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  status: text('status').default('active').notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const teamMembers = pgTable('team_members', {
  teamId: uuid('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').default('member').notNull(),
  joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.teamId, table.userId] }),
}));

export const invitations = pgTable('invitations', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  role: text('role').default('member').notNull(),
  token: text('token').notNull(),
  status: text('status').default('pending').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Webhook state machine (spec 25):
 *   Created -> Active -> (Failing -> Disabled) -> Deleted (terminal)
 */
export const webhooks = pgTable('webhooks', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  url: text('url').notNull(),
  secret: text('secret'),
  events: text('events').array().notNull().default([]),
  status: text('status').default('created').notNull(),  // created | active | failing | disabled | deleted
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  lastFailureAt: timestamp('last_failure_at', { withTimezone: true }),
  failureCount: integer('failure_count').default(0).notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Alert Event state machine (spec 25):
 *   Fired -> Delivered -> Acknowledged (terminal)
 *      |
 *   delivery_failed -> (retry) -> Delivered
 *      | (retries exhausted)
 *   delivery_failed_final -> Escalated (terminal-ish)
 */
export const alertEvents = pgTable('alert_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  alertRuleId: uuid('alert_rule_id').references(() => alertRules.id, { onDelete: 'set null' }),
  blobRegistrationId: uuid('blob_registration_id').references(() => blobRegistrations.id, { onDelete: 'set null' }),
  renewalJobId: uuid('renewal_job_id').references(() => renewalJobs.id, { onDelete: 'set null' }),
  eventType: text('event_type').notNull(),
  severity: text('severity').default('info').notNull(),  // info | warning | error | critical
  message: text('message').notNull(),
  details: jsonb('details').default({}),
  status: text('status').default('fired').notNull(),  // fired | delivered | delivery_failed | delivery_failed_final | escalated | acknowledged
  channelId: text('channel_id'),
  linkToEntity: text('link_to_entity'),
  firedAt: timestamp('fired_at', { withTimezone: true }).defaultNow().notNull(),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
  escalatedAt: timestamp('escalated_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Notification delivery records — tracks each delivery attempt for an alert event
 */
export const notifications = pgTable('notifications', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  alertEventId: uuid('alert_event_id').notNull().references(() => alertEvents.id, { onDelete: 'cascade' }),
  channelId: uuid('channel_id').references(() => notificationChannels.id, { onDelete: 'set null' }),
  status: text('status').default('queued').notNull(),  // queued | sent | failed
  error: text('error'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Schedule state machine (spec 10):
 *   Active -> Deleted (terminal)
 *
 * System schedules are seeded by migration and are not user-configurable.
 * User schedules have system-enforced min_interval_ms and max_staleness_ms bounds.
 */
export const schedules = pgTable('schedules', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: text('type').notNull().default('system'),   // 'system' | 'user'
  cronExpr: text('cron_expr').notNull(),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  lastCompletedAt: timestamp('last_completed_at', { withTimezone: true }),
  enabled: boolean('enabled').default(true).notNull(),
  minIntervalMs: bigint('min_interval_ms', { mode: 'number' }),      // system-enforced floor for user schedules
  maxStalenessMs: bigint('max_staleness_ms', { mode: 'number' }),    // system-enforced ceiling for user schedules
  config: jsonb('config').default({}),
  status: text('status').default('active').notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Schedule run history (spec 10) — tracks every scheduler execution for
 * observability, audit, and missed-run detection.
 */
export const scheduleRuns = pgTable('schedule_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  scheduleId: uuid('schedule_id').notNull().references(() => schedules.id, { onDelete: 'cascade' }),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('running'),  // running | completed | failed
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  durationMs: bigint('duration_ms', { mode: 'number' }),
  error: text('error'),
  details: jsonb('details').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  scheduleRunIdx: index('idx_schedule_runs_schedule_id').on(table.scheduleId),
}));

export const capabilityEnum = pgEnum('capability_enum', [
  'manage_policies', 'manage_budgets', 'trigger_renewals',
  'manage_wallets', 'manage_alerts', 'manage_webhooks',
  'manage_api_keys', 'view_audit_log',
]);

export const capabilityGrants = pgTable('capability_grants', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  capability: capabilityEnum('capability').notNull(),
  grantedBy: uuid('granted_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  uniqueGrant: uniqueIndex('cap_grants_unique').on(table.orgId, table.userId, table.capability),
  userIdx: index('idx_cap_grants_user').on(table.userId),
  orgIdx: index('idx_cap_grants_org').on(table.orgId),
}));

export const featureFlags = pgTable('feature_flags', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
  description: text('description'),
  enabled: boolean('enabled').default(false).notNull(),
  orgIds: uuid('org_ids').array().default([]),
  type: text('type').default('release').notNull(),
  config: jsonb('config').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const experiments = pgTable('experiments', {
  name: text('name').primaryKey(),
  description: text('description'),
  variants: jsonb('variants').default([]),
  targetingRules: jsonb('targeting_rules').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const experimentAssignments = pgTable('experiment_assignments', {
  id: uuid('id').defaultRandom().primaryKey(),
  experimentName: text('experiment_name').notNull(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  variant: text('variant').notNull(),
  assignedAt: timestamp('assigned_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Generic job queue — powers background jobs of any type.
 * Job statuses: queued | processing | completed | failed | dlq
 */
export const jobQueue = pgTable('job_queue', {
  id: uuid('id').defaultRandom().primaryKey(),
  type: text('type').notNull(),
  payload: jsonb('payload'),
  entityType: text('entity_type'),
  entityId: text('entity_id'),
  priority: integer('priority').default(50),
  status: text('status').notNull().default('queued'),
  scheduledFor: timestamp('scheduled_for', { withTimezone: true }).defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  error: text('error'),
  attempts: integer('attempts').default(0),
  maxAttempts: integer('max_attempts').default(5),
  traceId: text('trace_id'),
  orgId: uuid('org_id'),
});

export const jobExecutions = pgTable('job_executions', {
  id: uuid('id').primaryKey().defaultRandom(),
  jobType: text('job_type').notNull(),
  entityType: text('entity_type'),
  entityId: uuid('entity_id'),
  status: text('status').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  durationMs: integer('duration_ms'),
  error: text('error'),
  metadata: jsonb('metadata'),
  traceId: text('trace_id'),
  orgId: uuid('org_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const eventLog = pgTable('event_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventName: text('event_name').notNull(),
  payload: jsonb('payload'),
  actorId: text('actor_id'),
  entityId: text('entity_id'),
  entityType: text('entity_type'),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).defaultNow(),
  orgId: uuid('org_id'),
  processed: boolean('processed').default(false),
  traceId: text('trace_id'),
});

export const jobDlq = pgTable('job_dlq', {
  id: uuid('id').primaryKey(),
  type: text('type').notNull(),
  payload: jsonb('payload'),
  entityType: text('entity_type'),
  entityId: text('entity_id'),
  priority: integer('priority'),
  status: text('status').default('dlq'),
  scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  error: text('error'),
  attempts: integer('attempts'),
  maxAttempts: integer('max_attempts'),
  traceId: text('trace_id'),
  orgId: uuid('org_id'),
  dlqReason: text('dlq_reason').notNull(),
  dlqgedAt: timestamp('dlqged_at', { withTimezone: true }).defaultNow(),
});
