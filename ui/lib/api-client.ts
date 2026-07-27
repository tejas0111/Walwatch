export interface User { id: string; email: string; name?: string; }
export interface Organization { id: string; name: string; slug: string; created_at: string; }
export interface OrgMember { id: string; user_id: string; org_id: string; role: string; user?: User; }
export interface Project { id: string; org_id: string; name: string; slug: string; environment_labels?: string[]; blob_count?: number; }
export interface BlobRegistration { id: string; org_id: string; project_id?: string; blob_id: string; name?: string; size_bytes?: number; status: string; tags?: string[]; created_at: string; }
export interface Policy { id: string; org_id: string; name: string; rules: Record<string, unknown>; active: boolean; }
export interface Wallet { id: string; org_id: string; label: string; address: string; balance: number; }
export interface NotificationChannel { id: string; org_id: string; type: string; name: string; config: Record<string, unknown>; enabled?: boolean; createdAt?: string; }
export interface AlertRule { id: string; org_id: string; name: string; trigger?: string; conditions?: Record<string, unknown>; channelIds?: string[]; projectIds?: string[]; enabled: boolean; createdAt?: string; }
export interface Subscription { id: string; org_id: string; plan: string; status: string; }
export interface Invoice { id: string; org_id: string; amount: number; currency?: string; status: string; description: string; created_at: string; }
export interface ApiKey { id: string; name: string; prefix: string; permissions: string[]; created_at: string; last_used_at?: string; active: boolean; }
export interface AuditLog { id: string; org_id: string; user_id: string; action: string; resource_type: string; description: string; created_at: string; user?: User; }
export interface Analytics { overview: Record<string, unknown>; storage: Record<string, unknown>; renewals: Record<string, unknown>; }
export interface Vault { id: string; org_id: string; wallet_address: string; blob_id: string; name?: string; status: string; renew_threshold_epochs: number; renew_by_epochs: number; max_total_epochs?: number; balance: number; estimated_cost: number; created_at: string; }

export interface DashboardSummary {
  blobsByHealth: { healthy: number; atRisk: number; expiring: number; expired: number };
  storageUnderManagement: { totalBytes: number; totalBlobs: number };
  recentSpend: { totalCost: number; renewalCount: number; failedCount: number; blockedCount: number };
  budgetComparison: Array<{ id: string; name: string; amount: number; spent: number; remaining: number; crossed: boolean }>;
  nextToExpire: Array<{ id: string; blobId: string; name: string | null; expiryEpoch: number | null }>;
  needsAttention: any[];
}

export interface ListParams {
  limit?: string | number
  page?: string | number
  search?: string
  status?: string
  action?: string
  resource_type?: string
  [key: string]: string | number | undefined
}

export class ApiError extends Error {
  status: number
  body: unknown
  constructor(status: number, body: unknown) {
    const message = typeof body === 'object' && body !== null && 'error' in body
      ? String((body as Record<string, unknown>).error)
      : `Request failed with status ${status}`
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

  getMe(): Promise<User> {
    return this.request('/auth/me')
  }

  listOrgs(): Promise<Organization[]> {
    return this.request('/organizations')
  }

  createOrg(name: string, slug: string): Promise<Organization> {
    return this.request('/organizations', { method: 'POST', body: JSON.stringify({ name, slug }) })
  }

  getOrg(id: string): Promise<Organization> {
    return this.request(`/organizations/${id}`)
  }

  updateOrg(id: string, data: Partial<Organization>): Promise<Organization> {
    return this.request(`/organizations/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
  }

  deleteOrg(id: string): Promise<void> {
    return this.request(`/organizations/${id}`, { method: 'DELETE' })
  }

  listMembers(orgId: string): Promise<OrgMember[]> {
    return this.request(`/organizations/${orgId}/members`)
  }

  addMember(orgId: string, userId: string, role: string): Promise<OrgMember> {
    return this.request(`/organizations/${orgId}/members`, { method: 'POST', body: JSON.stringify({ user_id: userId, role }) })
  }

  inviteMember(orgId: string, email: string, role: string): Promise<OrgMember> {
    return this.request(`/organizations/${orgId}/members`, { method: 'POST', body: JSON.stringify({ email, role }) })
  }

  async getHealth(): Promise<Record<string, unknown>> {
    const healthBaseUrl = this.baseUrl.replace(/\/api$/, '')
    const headers: Record<string, string> = {}
    const token = this.getToken()
    if (token) headers['Authorization'] = `Bearer ${token}`
    const res = await fetch(`${healthBaseUrl}/health`, { headers })
    if (!res.ok) throw new Error('Health check failed')
    return res.json()
  }

  updateMember(orgId: string, memberId: string, role: string): Promise<OrgMember> {
    return this.request(`/organizations/${orgId}/members/${memberId}`, { method: 'PATCH', body: JSON.stringify({ role }) })
  }

  removeMember(orgId: string, memberId: string): Promise<void> {
    return this.request(`/organizations/${orgId}/members/${memberId}`, { method: 'DELETE' })
  }

  listProjects(orgId: string): Promise<Project[]> {
    return this.request(`/organizations/${orgId}/projects`)
  }

  createProject(orgId: string, data: Record<string, unknown>): Promise<Project> {
    return this.request(`/organizations/${orgId}/projects`, { method: 'POST', body: JSON.stringify(data) })
  }

  updateProject(orgId: string, id: string, data: Record<string, unknown>): Promise<Project> {
    return this.request(`/organizations/${orgId}/projects/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
  }

  deleteProject(orgId: string, id: string): Promise<void> {
    return this.request(`/organizations/${orgId}/projects/${id}`, { method: 'DELETE' })
  }

  listBlobs(orgId: string, params?: ListParams): Promise<BlobRegistration[]> {
    const qs = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : ''
    return this.request(`/organizations/${orgId}/blobs${qs}`)
  }

  createBlob(orgId: string, data: Record<string, unknown>): Promise<BlobRegistration> {
    return this.request(`/organizations/${orgId}/blobs`, { method: 'POST', body: JSON.stringify(data) })
  }

  getBlob(orgId: string, id: string): Promise<BlobRegistration> {
    return this.request(`/organizations/${orgId}/blobs/${id}`)
  }

  deleteBlob(orgId: string, id: string): Promise<void> {
    return this.request(`/organizations/${orgId}/blobs/${id}`, { method: 'DELETE' })
  }

  listPolicies(orgId: string): Promise<Policy[]> {
    return this.request(`/organizations/${orgId}/policies`)
  }

  createPolicy(orgId: string, data: Record<string, unknown>): Promise<Policy> {
    return this.request(`/organizations/${orgId}/policies`, { method: 'POST', body: JSON.stringify(data) })
  }

  updatePolicy(orgId: string, id: string, data: Record<string, unknown>): Promise<Policy> {
    return this.request(`/organizations/${orgId}/policies/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
  }

  deletePolicy(orgId: string, id: string): Promise<void> {
    return this.request(`/organizations/${orgId}/policies/${id}`, { method: 'DELETE' })
  }

  listWallets(orgId: string): Promise<Wallet[]> {
    return this.request(`/organizations/${orgId}/wallets`)
  }

  createWallet(orgId: string, data: Record<string, unknown>): Promise<Wallet> {
    return this.request(`/organizations/${orgId}/wallets`, { method: 'POST', body: JSON.stringify(data) })
  }

  listChannels(orgId: string): Promise<NotificationChannel[]> {
    return this.request(`/organizations/${orgId}/channels`)
  }

  createChannel(orgId: string, data: Record<string, unknown>): Promise<NotificationChannel> {
    return this.request(`/organizations/${orgId}/channels`, { method: 'POST', body: JSON.stringify(data) })
  }

  deleteChannel(orgId: string, id: string): Promise<void> {
    return this.request(`/organizations/${orgId}/channels/${id}`, { method: 'DELETE' })
  }

  listAlertRules(orgId: string): Promise<AlertRule[]> {
    return this.request(`/organizations/${orgId}/alert-rules`)
  }

  createAlertRule(orgId: string, data: Record<string, unknown>): Promise<AlertRule> {
    return this.request(`/organizations/${orgId}/alert-rules`, { method: 'POST', body: JSON.stringify(data) })
  }

  deleteAlertRule(orgId: string, id: string): Promise<void> {
    return this.request(`/organizations/${orgId}/alert-rules/${id}`, { method: 'DELETE' })
  }

  getSubscription(orgId: string): Promise<Subscription> {
    return this.request(`/organizations/${orgId}/subscription`)
  }

  listInvoices(orgId: string): Promise<Invoice[]> {
    return this.request(`/organizations/${orgId}/invoices`)
  }

  listApiKeys(orgId: string): Promise<ApiKey[]> {
    return this.request(`/organizations/${orgId}/api-keys`)
  }

  createApiKey(orgId: string, data: Record<string, unknown>): Promise<ApiKey & { key: string }> {
    return this.request(`/organizations/${orgId}/api-keys`, { method: 'POST', body: JSON.stringify(data) })
  }

  revokeApiKey(orgId: string, id: string): Promise<void> {
    return this.request(`/organizations/${orgId}/api-keys/${id}`, { method: 'DELETE' })
  }

  listAuditLogs(orgId: string, params?: ListParams): Promise<AuditLog[]> {
    const qs = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : ''
    return this.request(`/organizations/${orgId}/audit-logs${qs}`)
  }

  getAnalytics(orgId: string): Promise<Analytics> {
    return this.request(`/organizations/${orgId}/analytics`)
  }

  createVault(orgId: string, data: Record<string, unknown>): Promise<Vault> {
    return this.request(`/organizations/${orgId}/vaults`, { method: 'POST', body: JSON.stringify(data) })
  }

  updateSubscription(orgId: string, plan: string): Promise<Subscription> {
    return this.request(`/organizations/${orgId}/subscription`, { method: 'POST', body: JSON.stringify({ plan }) })
  }

  async getDashboardSummary(orgId: string, projectId?: string): Promise<DashboardSummary> {
    const query = projectId ? `?projectId=${projectId}` : '';
    return this.request<DashboardSummary>(`/dashboard/summary${query}`, { headers: { 'X-Org-Id': orgId } });
  }
}

export const api = new ApiClient()
