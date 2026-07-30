export interface WalwatchConfig {
  apiUrl?: string;
  apiKey?: string;
  token?: string;
  orgId?: string;
  maxRetries?: number;
}

export interface User {
  id: string;
  email: string;
  name?: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  role?: string;
  createdAt: string;
}

export interface OrgMember {
  id?: string;
  userId: string;
  orgId: string;
  role: string;
  email?: string;
  name?: string;
  joinedAt?: string;
}

export interface Project {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  description?: string;
  environment?: string;
  environmentLabels?: string[];
  blobCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface BlobRegistration {
  id: string;
  orgId: string;
  projectId?: string;
  blobId: string;
  name?: string;
  sizeBytes?: number;
  contentType?: string;
  status: string;
  tags?: string[];
  suiVaultId?: string;
  ownerAddress?: string;
  expiryEpoch?: number;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export interface Policy {
  id: string;
  orgId: string;
  name: string;
  description?: string;
  rules: Record<string, unknown>[];
  renewThreshold?: number;
  renewExtension?: number;
  maxTotalEpochs?: number;
  active: boolean;
  assignments?: PolicyAssignment[];
  createdAt?: string;
  updatedAt?: string;
}

export interface PolicyAssignment {
  policyId: string;
  blobRegistrationId: string;
}

export interface Wallet {
  id: string;
  orgId: string;
  label?: string;
  address: string;
  type?: string;
  isDefault?: boolean;
  spendingLimit?: number;
  balance: number;
  lastCheckedAt?: string;
  createdAt?: string;
}

export interface Subscription {
  id: string;
  orgId: string;
  plan: string;
  status: string;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
  createdAt?: string;
}

export interface Invoice {
  id: string;
  orgId: string;
  subscriptionId?: string;
  amount: number;
  currency?: string;
  status: string;
  description?: string;
  dueDate?: string;
  paidAt?: string;
  createdAt?: string;
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  permissions: string[];
  rawKey?: string;
  expiresAt?: string;
  lastUsedAt?: string;
  createdAt?: string;
}

export interface NotificationChannel {
  id: string;
  orgId: string;
  type: string;
  name: string;
  config: Record<string, unknown>;
  enabled: boolean;
  createdAt?: string;
}

export interface AlertRule {
  id: string;
  orgId: string;
  name: string;
  trigger: string;
  conditions?: Record<string, unknown>;
  channelIds?: string[];
  projectIds?: string[];
  enabled: boolean;
  createdAt?: string;
}

export interface AuditLog {
  id: string;
  orgId: string;
  userId: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  createdAt: string;
}

export interface AnalyticsOverview {
  totalBlobs: number;
  activeBlobs: number;
  totalProjects: number;
  totalPolicies: number;
  totalWallets: number;
}

export interface AnalyticsStorage {
  totalSizeBytes: number;
  averageSizeBytes: number;
  blobCount: number;
  byStatus: { status: string; count: number; totalSize: number }[];
}

export interface AnalyticsCostResponse {
  totalCost: number;
  byPeriod: { period: string; cost: number }[];
}

export interface AnalyticsForecastResponse {
  projectedCost: number;
  byPeriod: { period: string; projectedCost: number }[];
}

export interface Vault {
  id: string;
  walletAddress: string;
  blobId: string;
  status: string;
  initialWalAmount: string;
  remainingWalAmount: string;
  renewThresholdEpochs: number;
  renewByEpochs: number;
  maxTotalEpochs?: number;
  currentEpoch: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface VaultHistoryEntry {
  id: string;
  vaultId: string;
  action: string;
  amount?: string;
  txDigest?: string;
  details?: Record<string, unknown>;
  createdAt?: string;
}

export interface VaultTransaction {
  id?: string;
  txDigest?: string;
  status?: string;
  amount?: string;
  message?: string;
}

export interface CreateVaultParams {
  wallet_address: string;
  blob_id: string;
  initial_wal_amount: string;
  renew_threshold_epochs: number;
  renew_by_epochs: number;
  max_total_epochs: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface UsageRecord {
  metric: string;
  total: number;
}

export interface Publisher {
  id: string;
  orgId: string;
  name: string;
  description?: string;
  endpoint?: string;
  walletAddress?: string;
  suiVaultId?: string;
  status: string;
  lastHeartbeatAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Aggregator {
  id: string;
  orgId: string;
  publisherId?: string;
  name: string;
  endpoint?: string;
  status: string;
  lastHeartbeatAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Budget {
  id: string;
  orgId: string;
  projectId?: string;
  name: string;
  amount: number;
  period: string;
  spent: number;
  currency: string;
  status: string;
  alertThreshold?: number;
  createdAt: string;
  updatedAt: string;
}

export interface SpendingLimit {
  id: string;
  walletId: string;
  orgId: string;
  name?: string;
  amount: number;
  period: string;
  spent: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface RenewalJob {
  id: string;
  orgId: string;
  blobRegistrationId: string;
  policyId?: string;
  status: string;
  attempt: number;
  maxAttempts: number;
  lastError?: string;
  scheduledFor?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
}

export interface Team {
  id: string;
  orgId: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TeamMember {
  teamId: string;
  userId: string;
  role: string;
  joinedAt: string;
}

export interface Invitation {
  id: string;
  orgId: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string;
  acceptedAt?: string;
  createdAt: string;
}

export interface Schedule {
  id: string;
  orgId: string;
  name: string;
  type: 'system' | 'user';
  cronExpr: string;
  lastRunAt: string | null;
  lastCompletedAt: string | null;
  enabled: boolean;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface AlertEvent {
  id: string;
  orgId: string;
  alertRuleId: string | null;
  eventType: string;
  severity: string;
  message: string;
  status: string;
  firedAt: string;
  deliveredAt: string | null;
  acknowledgedAt: string | null;
}

export interface Webhook {
  id: string;
  orgId: string;
  name: string;
  url: string;
  events: string[];
  status: string;
  failureCount: number;
  createdAt: string;
}

export interface DashboardSummary {
  blobsByHealth: { healthy: number; atRisk: number; expiring: number; expired: number };
  storageUnderManagement: { totalBytes: number; totalBlobs: number };
  recentSpend: { totalCost: number; renewalCount: number; failedCount: number; blockedCount: number };
  budgetComparison: Array<{ id: string; name: string; amount: number; spent: number; remaining: number; crossed: boolean }>;
  nextToExpire: Array<{ id: string; blobId: string; name: string | null; expiryEpoch: number | null }>;
  needsAttention: AlertEvent[];
}

export interface AdminHealth {
  status: string;
  queueDepth: number;
  pendingAlerts: number;
  activeSchedules: number;
  timestamp: string;
}

export interface QueueStatus {
  status: string;
  count: number;
}

export interface FeatureFlag {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  type: string;
  orgIds?: string[];
  config?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityFeedEntry {
  id: string;
  orgId: string;
  actorType: 'human' | 'system' | 'api_key';
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  summary: string;
  details: Record<string, unknown> | null;
  traceId: string | null;
  createdAt: string;
}

export interface ActivityFeedResponse {
  entries: ActivityFeedEntry[];
  pagination: {
    nextCursor: string | null;
    hasMore: boolean;
  };
}

export interface AdminMetrics {
  totalJobs: number;
  failedJobs: number;
  totalOrgs: number;
  activeOrgs: number;
  totalBlobs: number;
  timestamp: string;
}

export interface AdminTenantResponse {
  organization: Organization;
  stats: {
    totalJobs: number;
    totalBlobs: number;
    activeSchedules: number;
    totalAlerts: number;
  };
}

export interface AdminRetryJobResponse {
  message: string;
  job: RenewalJob;
}

export interface ExperimentAssignment {
  id: string;
  experimentName: string;
  orgId: string;
  variant: string;
  assignedAt: string;
}
