export interface User { id: string; email: string; name?: string; }
export interface Organization { id: string; name: string; slug: string; status?: string; createdAt: string; updatedAt?: string; deletedAt?: string | null; suspendedAt?: string | null; }
export interface OrgMember { userId: string; email: string; name?: string; role: string; joinedAt?: string; }
export interface Project { id: string; orgId: string; name: string; slug: string; environment?: string; blobCount?: number; description?: string; createdAt: string; updatedAt?: string; }
export interface BlobRegistration { id: string; orgId: string; projectId?: string; blobId: string; name?: string; sizeBytes?: number; status: string; tags?: string[]; createdAt: string; updatedAt?: string; deletedAt?: string | null; }
export interface Policy { id: string; orgId: string; name: string; description?: string; renewThreshold: number; renewExtension: number; maxTotalEpochs?: number; scope?: string; scopeTargetId?: string; active: boolean; createdAt: string; updatedAt?: string; }
export interface Wallet { id: string; orgId: string; label: string; address: string; balance: number; type?: string; isDefault?: boolean; spendingLimit?: number; lastCheckedAt?: string; status?: string; projectId?: string; createdAt: string; updatedAt?: string; }
export interface NotificationChannel { id: string; orgId: string; type: string; name: string; config?: Record<string, unknown>; enabled?: boolean; createdAt?: string; updatedAt?: string; }
export interface AlertRule { id: string; orgId: string; name: string; trigger?: string; conditions?: Record<string, unknown>; channelIds?: string[]; projectIds?: string[]; enabled: boolean; createdAt?: string; updatedAt?: string; }
export interface Subscription { id: string; orgId: string; plan: string; status: string; currentPeriodStart?: string; currentPeriodEnd?: string; createdAt?: string; updatedAt?: string; }
export interface Invoice { id: string; orgId: string; amount: number; currency?: string; status: string; description: string; createdAt: string; }
export interface ApiKeyEntry { id: string; name: string; keyPrefix: string; permissions: string[]; role?: string; expiresAt?: string | null; createdAt: string; lastUsedAt?: string | null; }
export interface AuditLogEntry { id: string; orgId: string; userId: string; action: string; resourceType: string; resourceId?: string; description: string; details?: string; ipAddress?: string; createdAt: string; user?: User; }
export interface VaultInfo { id: string; beneficiary: string; blobId: string; walBalance: string; policy: { renewThresholdEpochs: number; renewByEpochs: number; maxTotalEpochs: number | null; active: boolean; }; totalRenewals: number; totalFeesPaid: string; createdAtEpoch: number; }

export interface Budget {
  id: string
  orgId: string
  projectId?: string
  name: string
  amount: number
  period: string
  spent: number
  currency: string
  status: string
  alertThreshold?: number
  windowStart: string
  windowEnd?: string
  deletedAt?: string | null
  archivedAt?: string | null
  createdAt: string
  updatedAt: string
}

export interface SpendingLimit {
  id: string
  orgId: string
  scope: string
  scopeTargetId: string
  name?: string
  amount: number
  period: string
  spent: number
  status: string
  pausedAt?: string
  deletedAt?: string | null
  createdAt: string
  updatedAt: string
}

export interface Delegation {
  id: string
  orgId: string
  walletId: string
  delegateAddress: string
  scope: string
  scopeTargets: string[]
  spendCeiling: string
  timeBoundStart: string
  timeBoundEnd?: string | null
  isRevoked: boolean
  createdBy: string
  revokedAt?: string | null
  createdAt: string
  updatedAt: string
}

export interface DashboardSummary {
  blobsByHealth: { healthy: number; atRisk: number; expiring: number; expired: number };
  storageUnderManagement: { totalBytes: number; totalBlobs: number };
  recentSpend: { totalCost: number; renewalCount: number; failedCount: number; blockedCount: number };
  budgetComparison: Array<{ id: string; name: string; amount: number; spent: number; remaining: number; crossed: boolean }>;
  nextToExpire: Array<{ id: string; blobId: string; name: string | null; expiryEpoch: number | null }>;
  needsAttention: any[];
  scope: { orgId: string; projectId?: string };
  dataFreshness: { computedAt: string; stalenessMs: number; maxStalenessMs: number; stale: boolean };
  attentionSummary: { total: number; alertEvents: number; failedRenewals: number; blockedRenewals: number; failedNotifications: number };
  emptyStateGuidance?: string;
  status: string;
}

export interface ListParams {
  limit?: string | number
  page?: string | number
  cursor?: string
  search?: string
  status?: string
  action?: string
  resourceType?: string
  [key: string]: string | number | undefined
}

export class ApiError extends Error {
  status: number
  body: unknown
  constructor(status: number, body: unknown) {
    const message = (() => {
      if (typeof body === 'object' && body !== null && 'error' in body) {
        const err = (body as Record<string, unknown>).error
        if (typeof err === 'string') return err
        if (typeof err === 'object' && err !== null) {
          if ('message' in err) return String((err as Record<string, unknown>).message)
          if ('issues' in err) {
            const issues = (err as Record<string, unknown>).issues
            if (Array.isArray(issues) && issues.length > 0) {
              return issues.map((i: Record<string, unknown>) => i.message).filter(Boolean).join('; ')
            }
          }
        }
        return String(err)
      }
      if (typeof body === 'object' && body !== null && 'success' in body && (body as Record<string, unknown>).success === false) {
        return `Request failed with status ${status}`
      }
      return `Request failed with status ${status}`
    })()
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

export class ApiClient {
  private baseUrl: string
  private token: string | null = null
  private apiKey: string | null = null
  private orgId: string | null = null

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api'
  }

  setToken(token: string) { this.token = token; localStorage.setItem('walwatch_token', token) }
  setApiKey(key: string) { this.apiKey = key }
  setOrgId(id: string) { this.orgId = id; localStorage.setItem('walwatch_org_id', id) }

  getToken() { return this.token || localStorage.getItem('walwatch_token') }
  getOrgId() { return this.orgId || localStorage.getItem('walwatch_org_id') }

  clearAuth() {
    this.token = null
    this.apiKey = null
    this.orgId = null
    localStorage.removeItem('walwatch_token')
    localStorage.removeItem('walwatch_org_id')
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    const token = this.getToken()
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    } else if (this.apiKey) {
      headers['X-API-Key'] = this.apiKey
    }

    const orgId = this.getOrgId()
    if (orgId) {
      headers['X-Org-Id'] = orgId
    }

    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        ...options,
        headers: { ...headers, ...(options.headers as Record<string, string>) },
      })

      if (!res.ok) {
        let body: unknown
        try {
          body = await res.json()
        } catch {
          body = null
        }
        throw new ApiError(res.status, body)
      }

      if (res.status === 204) return undefined as T

      const text = await res.text()
      if (!text) return undefined as T
      return JSON.parse(text) as T
    } catch (err) {
      if (err instanceof ApiError) throw err
      throw new ApiError(0, { error: err instanceof Error ? err.message : 'Network error' })
    }
  }

  register(email: string, password: string): Promise<{ user: User; token: string }> {
    return this.request('/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) })
  }

  login(email: string, password: string): Promise<{ user: User; token: string }> {
    return this.request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
  }

  logout(): Promise<void> {
    return this.request('/auth/logout', { method: 'POST' })
  }

  async getMe(): Promise<User> {
    const res = await this.request<{ user: User }>('/auth/me')
    return res.user
  }

  async listOrgs(): Promise<Organization[]> {
    const res = await this.request<{ organizations: Organization[] }>('/orgs')
    return res.organizations
  }

  async createOrg(name: string, slug: string): Promise<Organization> {
    const res = await this.request<{ organization: Organization }>('/orgs', { method: 'POST', body: JSON.stringify({ name, slug }) })
    return res.organization
  }

  async getOrg(id: string): Promise<Organization> {
    const res = await this.request<{ organization: Organization }>(`/orgs/${id}`)
    return res.organization
  }

  async updateOrg(id: string, data: Partial<Organization>): Promise<Organization> {
    const res = await this.request<{ organization: Organization }>(`/orgs/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
    return res.organization
  }

  async deleteOrg(id: string): Promise<{ message: string }> {
    return this.request(`/orgs/${id}`, { method: 'DELETE' })
  }

  async listMembers(orgId: string): Promise<OrgMember[]> {
    const res = await this.request<{ members: OrgMember[] }>(`/orgs/${orgId}/members`)
    return res.members
  }

  async addMember(orgId: string, email: string, role: string): Promise<{ message: string }> {
    return this.request(`/orgs/${orgId}/members`, { method: 'POST', body: JSON.stringify({ email, role }) })
  }

  // URL construction is fragile: strips /api suffix to reach the root-level /health endpoint.
  // If baseUrl doesn't end in /api, this will produce an incorrect URL.
  async getHealth(): Promise<Record<string, unknown>> {
    const healthBaseUrl = this.baseUrl.replace(/\/api$/, '')
    const headers: Record<string, string> = {}
    const token = this.getToken()
    if (token) headers['Authorization'] = `Bearer ${token}`
    const res = await fetch(`${healthBaseUrl}/health`, { headers })
    if (!res.ok) throw new Error('Health check failed')
    return res.json()
  }

  async updateMember(orgId: string, memberId: string, role: string): Promise<{ message: string }> {
    return this.request(`/orgs/${orgId}/members/${memberId}`, { method: 'PATCH', body: JSON.stringify({ role }) })
  }

  async removeMember(orgId: string, memberId: string): Promise<{ message: string }> {
    return this.request(`/orgs/${orgId}/members/${memberId}`, { method: 'DELETE' })
  }

  async listProjects(): Promise<Project[]> {
    const res = await this.request<{ projects: Project[] }>('/projects')
    return res.projects
  }

  createProject(data: Record<string, unknown>): Promise<Project> {
    return this.request('/projects', { method: 'POST', body: JSON.stringify(data) })
  }

  getProject(id: string): Promise<Project> {
    return this.request(`/projects/${id}`)
  }

  updateProject(id: string, data: Record<string, unknown>): Promise<Project> {
    return this.request(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
  }

  async deleteProject(id: string): Promise<{ message: string }> {
    return this.request(`/projects/${id}`, { method: 'DELETE' })
  }

  async listBlobs(params?: ListParams): Promise<BlobRegistration[]> {
    const qs = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : ''
    const res = await this.request<{ blobs: BlobRegistration[] }>(`/blobs${qs}`)
    return res.blobs
  }

  createBlob(data: Record<string, unknown>): Promise<BlobRegistration> {
    return this.request('/blobs', { method: 'POST', body: JSON.stringify(data) })
  }

  getBlob(id: string): Promise<BlobRegistration> {
    return this.request(`/blobs/${id}`)
  }

  updateBlob(id: string, data: Record<string, unknown>): Promise<BlobRegistration> {
    return this.request(`/blobs/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
  }

  async deleteBlob(id: string): Promise<{ message: string }> {
    return this.request(`/blobs/${id}`, { method: 'DELETE' })
  }

  getPolicy(id: string): Promise<Policy> {
    return this.request(`/policies/${id}`)
  }

  async listPolicies(): Promise<Policy[]> {
    const res = await this.request<{ policies: Policy[] }>('/policies')
    return res.policies
  }

  createPolicy(data: Record<string, unknown>): Promise<Policy> {
    return this.request('/policies', { method: 'POST', body: JSON.stringify(data) })
  }

  updatePolicy(id: string, data: Record<string, unknown>): Promise<Policy> {
    return this.request(`/policies/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
  }

  async deletePolicy(id: string): Promise<{ message: string }> {
    return this.request(`/policies/${id}`, { method: 'DELETE' })
  }

  async listBudgets(): Promise<Budget[]> {
    const res = await this.request<{ budgets: Budget[] }>('/budgets')
    return res.budgets
  }

  createBudget(data: Record<string, unknown>): Promise<Budget> {
    return this.request('/budgets', { method: 'POST', body: JSON.stringify(data) })
  }

  async updateBudget(id: string, data: Record<string, unknown>): Promise<Budget> {
    return this.request(`/budgets/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
  }

  async archiveBudget(id: string): Promise<{ message: string }> {
    return this.request(`/budgets/${id}/archive`, { method: 'POST' })
  }

  async activateBudget(id: string): Promise<{ message: string }> {
    return this.request(`/budgets/${id}/activate`, { method: 'POST' })
  }

  async listSpendingLimits(): Promise<SpendingLimit[]> {
    const res = await this.request<{ spendingLimits: SpendingLimit[] }>('/spending-limits')
    return res.spendingLimits
  }

  createSpendingLimit(data: Record<string, unknown>): Promise<SpendingLimit> {
    return this.request('/spending-limits', { method: 'POST', body: JSON.stringify(data) })
  }

  async updateSpendingLimit(id: string, data: Record<string, unknown>): Promise<SpendingLimit> {
    return this.request(`/spending-limits/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
  }

  async deleteSpendingLimit(id: string): Promise<{ message: string }> {
    return this.request(`/spending-limits/${id}`, { method: 'DELETE' })
  }

  async activateSpendingLimit(id: string): Promise<SpendingLimit> {
    return this.request(`/spending-limits/${id}/activate`, { method: 'POST' })
  }

  async pauseSpendingLimit(id: string): Promise<SpendingLimit> {
    return this.request(`/spending-limits/${id}/pause`, { method: 'POST' })
  }

  async listWalletDelegations(walletId: string): Promise<Delegation[]> {
    const res = await this.request<{ delegations: Delegation[] }>(`/wallets/${walletId}/delegations`)
    return res.delegations
  }

  createDelegation(walletId: string, data: Record<string, unknown>): Promise<Delegation> {
    return this.request(`/wallets/${walletId}/delegate`, { method: 'POST', body: JSON.stringify(data) })
  }

  async revokeDelegation(walletId: string, delegationId: string): Promise<{ message: string }> {
    return this.request(`/wallets/${walletId}/delegations/${delegationId}/revoke`, { method: 'POST' })
  }

  async listWallets(): Promise<Wallet[]> {
    const res = await this.request<{ wallets: Wallet[] }>('/wallets')
    return res.wallets
  }

  createWallet(data: Record<string, unknown>): Promise<Wallet> {
    return this.request('/wallets', { method: 'POST', body: JSON.stringify(data) })
  }

  updateWallet(id: string, data: Record<string, unknown>): Promise<Wallet> {
    return this.request(`/wallets/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
  }

  async listChannels(): Promise<NotificationChannel[]> {
    const res = await this.request<{ channels: NotificationChannel[] }>('/alerts/channels')
    return res.channels
  }

  createChannel(data: Record<string, unknown>): Promise<NotificationChannel> {
    return this.request('/alerts/channels', { method: 'POST', body: JSON.stringify(data) })
  }

  updateChannel(id: string, data: Record<string, unknown>): Promise<NotificationChannel> {
    return this.request(`/alerts/channels/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
  }

  async deleteChannel(id: string): Promise<{ message: string }> {
    return this.request(`/alerts/channels/${id}`, { method: 'DELETE' })
  }

  async listAlertRules(): Promise<AlertRule[]> {
    const res = await this.request<{ rules: AlertRule[] }>('/alerts/rules')
    return res.rules
  }

  createAlertRule(data: Record<string, unknown>): Promise<AlertRule> {
    return this.request('/alerts/rules', { method: 'POST', body: JSON.stringify(data) })
  }

  updateAlertRule(id: string, data: Record<string, unknown>): Promise<AlertRule> {
    return this.request(`/alerts/rules/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
  }

  async deleteAlertRule(id: string): Promise<{ message: string }> {
    return this.request(`/alerts/rules/${id}`, { method: 'DELETE' })
  }

  async getSubscription(): Promise<Subscription> {
    const res = await this.request<{ subscription: Subscription }>('/billing/subscription')
    return res.subscription
  }

  async listInvoices(): Promise<Invoice[]> {
    const res = await this.request<{ invoices: Invoice[] }>('/billing/invoices')
    return res.invoices
  }

  updateSubscription(plan: string): Promise<Subscription> {
    return this.request('/billing/subscription', { method: 'POST', body: JSON.stringify({ plan }) })
  }

  async listApiKeys(): Promise<ApiKeyEntry[]> {
    const res = await this.request<{ apiKeys: ApiKeyEntry[] }>('/api-keys')
    return res.apiKeys
  }

  async createApiKey(data: Record<string, unknown>): Promise<ApiKeyEntry & { key: string }> {
    const res = await this.request<{ apiKey: ApiKeyEntry & { rawKey: string } }>('/api-keys', { method: 'POST', body: JSON.stringify(data) })
    return { ...res.apiKey, key: res.apiKey.rawKey }
  }

  async revokeApiKey(id: string): Promise<{ message: string }> {
    return this.request(`/api-keys/${id}`, { method: 'DELETE' })
  }

  async listAuditLogs(params?: ListParams): Promise<AuditLogEntry[]> {
    const qs = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : ''
    const res = await this.request<{ logs: AuditLogEntry[] }>(`/audit-logs${qs}`)
    return res.logs
  }

  async getAnalytics(): Promise<{ totalBlobs: number; activeBlobs: number; totalProjects: number; totalPolicies: number; totalWallets: number }> {
    return this.request('/analytics/overview')
  }

  async listVaults(): Promise<VaultInfo[]> {
    const res = await this.request<{ vaults: VaultInfo[] }>('/vaults')
    return res.vaults
  }

  async getVault(id: string): Promise<VaultInfo> {
    const res = await this.request<{ vault: VaultInfo }>(`/vaults/${id}`)
    return res.vault
  }

  async simulateCost(data: { blobIds: string[]; extensionEpochs?: number }): Promise<{ simulation: boolean; estimate: Array<{ estimatedCost: number }> }> {
    return this.request('/cost-engine/simulate', { method: 'POST', body: JSON.stringify(data) })
  }

  // Backend expects snake_case body fields (e.g. wallet_address, blob_id).
  // Callers must pass snake_case keys in `data`.
  createVault(data: Record<string, unknown>): Promise<{ transaction: Record<string, unknown> }> {
    return this.request('/vaults', { method: 'POST', body: JSON.stringify(data) })
  }

  async depositVault(vaultId: string, data: { amount: number }): Promise<{ transaction: Record<string, unknown> }> {
    return this.request(`/vaults/${vaultId}/deposit`, { method: 'POST', body: JSON.stringify(data) })
  }

  async updateVaultPolicy(vaultId: string, data: { renew_threshold_epochs: number; renew_by_epochs: number; max_total_epochs?: number; active?: boolean }): Promise<{ transaction: Record<string, unknown> }> {
    return this.request(`/vaults/${vaultId}/policy`, { method: 'POST', body: JSON.stringify(data) })
  }

  async getDashboardSummary(): Promise<DashboardSummary> {
    return this.request<DashboardSummary>('/dashboard/summary')
  }
}

export const api = new ApiClient()
