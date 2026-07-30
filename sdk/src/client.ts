import type {
  WalwatchConfig,
  User,
  Organization,
  OrgMember,
  Project,
  BlobRegistration,
  Policy,
  Wallet,
  Subscription,
  Invoice,
  ApiKey,
  NotificationChannel,
  AlertRule,
  AuditLog,
  AnalyticsOverview,
  AnalyticsStorage,
  AnalyticsCostResponse,
  AnalyticsForecastResponse,
  Vault,
  VaultTransaction,
  VaultHistoryEntry,
  CreateVaultParams,
  PaginatedResponse,
  UsageRecord,
  Publisher,
  Aggregator,
  Budget,
  SpendingLimit,
  RenewalJob,
  Team,
  TeamMember,
  Invitation,
  Schedule,
  AlertEvent,
  Webhook,
  DashboardSummary,
  AdminHealth,
  QueueStatus,
  FeatureFlag,
  ActivityFeedEntry,
  ActivityFeedResponse,
  AdminMetrics,
  AdminTenantResponse,
  AdminRetryJobResponse,
  ExperimentAssignment,
} from './types.js';

/**
 * Standardized API error shape matching the server's { error: { message, code, details } } format.
 */
export interface ApiErrorShape {
  message: string;
  code?: string;
  details?: unknown;
}

export class WalwatchAuthError extends Error {
  public readonly code?: string;
  public readonly details?: unknown;
  constructor(message: string, code?: string, details?: unknown) {
    super(message);
    this.name = 'WalwatchAuthError';
    this.code = code;
    this.details = details;
  }
  /** Return the structured error shape as the API would. */
  toApiErrorShape(): ApiErrorShape {
    return { message: this.message, code: this.code, details: this.details };
  }
}

export class WalwatchValidationError extends Error {
  public readonly code?: string;
  public readonly details?: unknown;
  constructor(message: string, code?: string, details?: unknown) {
    super(message);
    this.name = 'WalwatchValidationError';
    this.code = code;
    this.details = details;
  }
  toApiErrorShape(): ApiErrorShape {
    return { message: this.message, code: this.code, details: this.details };
  }
}

export class WalwatchNetworkError extends Error {
  public readonly code?: string;
  public readonly details?: unknown;
  constructor(message: string, public statusCode?: number, code?: string, details?: unknown) {
    super(message);
    this.name = 'WalwatchNetworkError';
    this.code = code;
    this.details = details;
  }
  toApiErrorShape(): ApiErrorShape {
    return { message: this.message, code: this.code, details: this.details };
  }
}

/**
 * Current SDK major version.
 * Must track the API major version per spec 28: "SDK major versions track API major versions".
 */
export const SDK_VERSION = '0.1.0';

export class WalwatchClient {
  private config: { apiUrl: string; apiKey?: string; token?: string; orgId?: string };
  private maxRetries: number;

  /**
   * Create a new Walwatch API client.
   *
   * @param config - Optional configuration overrides
   * @param config.apiUrl - Base URL for the Walwatch API (default: http://localhost:3001/api)
   * @param config.apiKey - API key for authentication
   * @param config.token - Bearer token for authentication
   * @param config.orgId - Default organization ID to scope requests
   * @param config.maxRetries - Maximum retry attempts on network/5xx errors (default: 2)
   *
   * @example
   * ```typescript
   * const client = new WalwatchClient({ apiUrl: 'https://api.walwatch.io' });
   * ```
   */
  constructor(config: WalwatchConfig = {}) {
    this.config = { apiUrl: 'http://localhost:3001/api', ...config };
    this.maxRetries = config.maxRetries ?? 2;
  }

  /**
   * Set the bearer token used for authenticated requests.
   *
   * @param token - JWT bearer token
   *
   * @example
   * ```typescript
   * client.setToken('eyJhbGciOi...');
   * ```
   */
  setToken(token: string): void {
    this.config.token = token;
  }

  /**
   * Set the default organization ID used for scoped requests.
   *
   * @param orgId - Organization UUID
   *
   * @example
   * ```typescript
   * client.setOrgId('org_abc123');
   * ```
   */
  setOrgId(orgId: string): void {
    this.config.orgId = orgId;
  }

  private getHeaders(orgId?: string | null): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-API-Version': SDK_VERSION,
    };
    if (this.config.token) {
      headers['Authorization'] = `Bearer ${this.config.token}`;
    } else if (this.config.apiKey) {
      headers['x-api-key'] = this.config.apiKey;
    }
    const effectiveOrgId = orgId !== undefined ? orgId : this.config.orgId;
    if (effectiveOrgId) {
      headers['X-Org-Id'] = effectiveOrgId;
    }
    return headers;
  }

  /**
   * Determine whether an error should trigger a retry.
   * Retries on network errors and 5xx responses, but NOT on 4xx client errors.
   *
   * @param err - The error to evaluate
   * @returns true if the error is retryable
   */
  private isRetryable(err: unknown): boolean {
    if (err instanceof WalwatchNetworkError) return true;
    if (err instanceof WalwatchAuthError) return false;
    if (err instanceof WalwatchValidationError) return false;
    return true;
  }

  private async request<T>(method: string, path: string, body?: any, orgId?: string | null): Promise<T> {
    const url = `${this.config.apiUrl}${path}`;
    const headers = this.getHeaders(orgId);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const options: RequestInit = {
      method,
      headers,
      signal: controller.signal,
    };
    if (body !== undefined) {
      options.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url, options);

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({ error: { message: response.statusText } }));
        // Extract the standardized { error: { message, code, details } } shape (spec 20)
        const apiErr = errorBody.error || errorBody;
        const errMessage = typeof apiErr === 'string' ? apiErr : (apiErr.message || `HTTP ${response.status}: ${response.statusText}`);
        const errCode = typeof apiErr === 'object' && apiErr !== null ? (apiErr as Record<string, unknown>).code as string | undefined : undefined;
        const errDetails = typeof apiErr === 'object' && apiErr !== null ? (apiErr as Record<string, unknown>).details : undefined;

        if (response.status === 401) {
          throw new WalwatchAuthError(errMessage, errCode, errDetails);
        }
        if (response.status === 400 || response.status === 422) {
          throw new WalwatchValidationError(errMessage, errCode, errDetails);
        }
        if (response.status >= 500) {
          throw new WalwatchNetworkError(errMessage, response.status, errCode, errDetails);
        }
        throw new Error(errMessage);
      }

      return response.json() as Promise<T>;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Perform an API request with automatic retry on transient failures.
   *
   * Retries with exponential backoff + jitter on network errors and 5xx responses.
   * Does NOT retry on 4xx client errors. Respects maxRetries configured in the constructor.
   *
   * @param path - API endpoint path (e.g. /blobs)
   * @param method - HTTP method
   * @param body - Optional request body
   * @param orgId - Optional organization ID override
   * @returns The parsed response
   * @throws {WalwatchAuthError} If the request returns 401
   * @throws {WalwatchValidationError} If the request returns 400/422
   * @throws {WalwatchNetworkError} If the request returns 5xx or a network error occurs
   */
  private async requestWithRetry<T>(method: string, path: string, body?: any, orgId?: string | null): Promise<T> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.request<T>(method, path, body, orgId);
      } catch (err) {
        lastError = err as Error;
        if (attempt < this.maxRetries && this.isRetryable(err)) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
          const jitter = delay * 0.5 * Math.random();
          console.info(`[WalwatchClient] Retry attempt ${attempt + 1}/${this.maxRetries} after ${Math.round(delay + jitter)}ms`);
          await new Promise(r => setTimeout(r, delay + jitter));
          continue;
        }
        throw err;
      }
    }
    throw lastError!;
  }

  // ==================== Auth ====================

  /**
   * Register a new user account.
   *
   * @param email - User email address
   * @param password - User password
   * @param name - Optional display name
   * @returns The created user and an authentication token
   * @throws {WalwatchValidationError} If email/password are invalid
   * @throws {WalwatchNetworkError} If the API is unreachable
   *
   * @example
   * ```typescript
   * const { user, token } = await client.register('alice@example.com', 's3cret!', 'Alice');
   * ```
   */
  async register(email: string, password: string, name?: string): Promise<{ user: User; token: string }> {
    return this.requestWithRetry<{ user: User; token: string }>('POST', '/auth/register', { email, password, name });
  }

  /**
   * Log in with email and password.
   *
   * @param email - User email address
   * @param password - User password
   * @returns The authenticated user and a bearer token
   * @throws {WalwatchAuthError} If credentials are invalid
   * @throws {WalwatchNetworkError} If the API is unreachable
   *
   * @example
   * ```typescript
   * const { user, token } = await client.login('alice@example.com', 's3cret!');
   * client.setToken(token);
   * ```
   */
  async login(email: string, password: string): Promise<{ user: User; token: string }> {
    return this.requestWithRetry<{ user: User; token: string }>('POST', '/auth/login', { email, password });
  }

  /**
   * Log out the current session.
   *
   * @returns A confirmation message
   * @throws {WalwatchAuthError} If not authenticated
   *
   * @example
   * ```typescript
   * await client.logout();
   * ```
   */
  async logout(): Promise<{ message: string }> {
    return this.requestWithRetry<{ message: string }>('POST', '/auth/logout');
  }

  /**
   * Get the currently authenticated user's profile.
   *
   * @returns The current user
   * @throws {WalwatchAuthError} If not authenticated
   *
   * @example
   * ```typescript
   * const { user } = await client.me();
   * ```
   */
  async me(): Promise<{ user: User }> {
    return this.requestWithRetry<{ user: User }>('GET', '/auth/me');
  }

  // ==================== Organizations ====================

  /**
   * List all organizations accessible to the authenticated user.
   *
   * @returns Array of organizations
   * @throws {WalwatchAuthError} If not authenticated
   *
   * @example
   * ```typescript
   * const orgs = await client.listOrganizations();
   * ```
   */
  async listOrganizations(): Promise<Organization[]> {
    const res = await this.requestWithRetry<{ organizations: Organization[] }>('GET', '/orgs');
    return res.organizations;
  }

  /**
   * Get an organization by ID.
   *
   * @param id - Organization UUID
   * @returns The organization
   * @throws {WalwatchAuthError} If not authenticated
   *
   * @example
   * ```typescript
   * const org = await client.getOrganization('org_abc123');
   * ```
   */
  async getOrganization(id: string): Promise<Organization> {
    return this.requestWithRetry<Organization>('GET', `/orgs/${id}`);
  }

  /**
   * Create a new organization.
   *
   * @param name - Display name for the organization
   * @param slug - URL-friendly slug (unique)
   * @returns The created organization
   * @throws {WalwatchValidationError} If name/slug are invalid or taken
   *
   * @example
   * ```typescript
   * const org = await client.createOrganization('My Company', 'my-company');
   * ```
   */
  async createOrganization(name: string, slug: string): Promise<Organization> {
    return this.requestWithRetry<Organization>('POST', '/orgs', { name, slug });
  }

  /**
   * Update an organization's properties.
   *
   * @param id - Organization UUID
   * @param data - Partial organization fields to update
   * @returns The updated organization
   * @throws {WalwatchAuthError} If not authenticated
   *
   * @example
   * ```typescript
   * const org = await client.updateOrganization('org_abc123', { name: 'New Name' });
   * ```
   */
  async updateOrganization(id: string, data: Partial<Organization>): Promise<Organization> {
    return this.requestWithRetry<Organization>('PATCH', `/orgs/${id}`, data);
  }

  /**
   * Delete an organization.
   *
   * @param id - Organization UUID
   * @returns A confirmation message
   * @throws {WalwatchAuthError} If not authenticated
   *
   * @example
   * ```typescript
   * await client.deleteOrganization('org_abc123');
   * ```
   */
  async deleteOrganization(id: string): Promise<{ message: string }> {
    return this.requestWithRetry<{ message: string }>('DELETE', `/orgs/${id}`);
  }

  // ==================== Members ====================

  /**
   * List all members of an organization.
   *
   * @param orgId - Organization UUID
   * @returns Array of organization members
   * @throws {WalwatchAuthError} If not authenticated
   *
   * @example
   * ```typescript
   * const members = await client.listMembers('org_abc123');
   * ```
   */
  async listMembers(orgId: string): Promise<OrgMember[]> {
    const res = await this.requestWithRetry<{ members: OrgMember[] }>('GET', '/members', undefined, orgId);
    return res.members;
  }

  /**
   * Add a member to an organization.
   *
   * @param orgId - Organization UUID
   * @param email - Email of the user to add
   * @param role - Role (e.g. "admin", "member")
   * @returns A confirmation message
   * @throws {WalwatchValidationError} If the user does not exist or role is invalid
   *
   * @example
   * ```typescript
   * await client.addMember('org_abc123', 'bob@example.com', 'member');
   * ```
   */
  async addMember(orgId: string, email: string, role: string): Promise<{ message: string }> {
    return this.requestWithRetry<{ message: string }>('POST', '/members', { email, role }, orgId);
  }

  /**
   * Update a member's role within an organization.
   *
   * @param orgId - Organization UUID
   * @param userId - User UUID
   * @param role - New role (e.g. "admin", "member")
   * @returns A confirmation message
   * @throws {WalwatchValidationError} If the role is invalid
   *
   * @example
   * ```typescript
   * await client.updateMemberRole('org_abc123', 'user_xyz', 'admin');
   * ```
   */
  async updateMemberRole(orgId: string, userId: string, role: string): Promise<{ message: string }> {
    return this.requestWithRetry<{ message: string }>('PATCH', `/members/${userId}`, { role }, orgId);
  }

  /**
   * Remove a member from an organization.
   *
   * @param orgId - Organization UUID
   * @param userId - User UUID
   * @returns A confirmation message
   *
   * @example
   * ```typescript
   * await client.removeMember('org_abc123', 'user_xyz');
   * ```
   */
  async removeMember(orgId: string, userId: string): Promise<{ message: string }> {
    return this.requestWithRetry<{ message: string }>('DELETE', `/members/${userId}`, undefined, orgId);
  }

  // ==================== Projects ====================

  /**
   * List all projects in an organization.
   *
   * @param orgId - Organization UUID
   * @returns Array of projects
   *
   * @example
   * ```typescript
   * const projects = await client.listProjects('org_abc123');
   * ```
   */
  async listProjects(orgId: string): Promise<Project[]> {
    const res = await this.requestWithRetry<{ projects: Project[] }>('GET', '/projects', undefined, orgId);
    return res.projects;
  }

  /**
   * Get a project by ID.
   *
   * @param orgId - Organization UUID
   * @param projectId - Project UUID
   * @returns The project
   *
   * @example
   * ```typescript
   * const project = await client.getProject('org_abc123', 'proj_xyz');
   * ```
   */
  async getProject(orgId: string, projectId: string): Promise<Project> {
    return this.requestWithRetry<Project>('GET', `/projects/${projectId}`, undefined, orgId);
  }

  /**
   * Create a new project within an organization.
   *
   * @param orgId - Organization UUID
   * @param data - Project configuration
   * @param data.name - Display name
   * @param data.slug - URL-friendly slug (unique within org)
   * @param data.description - Optional description
   * @param data.environment - Optional environment label (e.g. "production", "staging")
   * @returns The created project
   *
   * @example
   * ```typescript
   * const project = await client.createProject('org_abc123', {
   *   name: 'Main App',
   *   slug: 'main-app',
   *   environment: 'production',
   * });
   * ```
   */
  async createProject(orgId: string, data: { name: string; slug: string; description?: string; environment?: string }): Promise<Project> {
    return this.requestWithRetry<Project>('POST', '/projects', data, orgId);
  }

  /**
   * Update a project's properties.
   *
   * @param orgId - Organization UUID
   * @param projectId - Project UUID
   * @param data - Partial project fields to update
   * @returns The updated project
   *
   * @example
   * ```typescript
   * await client.updateProject('org_abc123', 'proj_xyz', { description: 'Updated description' });
   * ```
   */
  async updateProject(orgId: string, projectId: string, data: Partial<Project>): Promise<Project> {
    return this.requestWithRetry<Project>('PATCH', `/projects/${projectId}`, data, orgId);
  }

  /**
   * Delete a project.
   *
   * @param orgId - Organization UUID
   * @param projectId - Project UUID
   * @returns A confirmation message
   *
   * @example
   * ```typescript
   * await client.deleteProject('org_abc123', 'proj_xyz');
   * ```
   */
  async deleteProject(orgId: string, projectId: string): Promise<{ message: string }> {
    return this.requestWithRetry<{ message: string }>('DELETE', `/projects/${projectId}`, undefined, orgId);
  }

  // ==================== Blobs ====================

  /**
   * List blob registrations with optional search and filtering.
   *
   * @param orgId - Organization UUID
   * @param params - Optional query parameters
   * @param params.search - Search blobs by name/blobId
   * @param params.status - Filter by status (e.g. "active", "expired")
   * @param params.project_id - Filter by project
   * @param params.tag - Filter by tag
   * @param params.page - Page number (1-indexed)
   * @param params.limit - Items per page
   * @returns Paginated list of blobs
   *
   * @example
   * ```typescript
   * const { data, total } = await client.listBlobs('org_abc123', { status: 'active', limit: 20 });
   * ```
   */
  async listBlobs(orgId: string, params?: { search?: string; status?: string; project_id?: string; tag?: string; page?: number; limit?: number }): Promise<PaginatedResponse<BlobRegistration>> {
    const query = new URLSearchParams();
    if (params?.search) query.set('search', params.search);
    if (params?.status) query.set('status', params.status);
    if (params?.project_id) query.set('project_id', params.project_id);
    if (params?.tag) query.set('tag', params.tag);
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    const qs = query.toString();
    return this.requestWithRetry<PaginatedResponse<BlobRegistration>>('GET', `/blobs${qs ? `?${qs}` : ''}`, undefined, orgId);
  }

  /**
   * Get a blob registration by ID.
   *
   * @param orgId - Organization UUID
   * @param blobId - Blob UUID
   * @returns The blob registration
   *
   * @example
   * ```typescript
   * const blob = await client.getBlob('org_abc123', 'blob_xyz');
   * ```
   */
  async getBlob(orgId: string, blobId: string): Promise<BlobRegistration> {
    return this.requestWithRetry<BlobRegistration>('GET', `/blobs/${blobId}`, undefined, orgId);
  }

  /**
   * Register a new blob for renewal tracking.
   *
   * @param orgId - Organization UUID
   * @param data - Blob registration data
   * @param data.projectId - Project to associate the blob with
   * @param data.blobId - On-chain blob identifier
   * @param data.name - Optional human-readable name
   * @param data.sizeBytes - Optional blob size
   * @param data.contentType - Optional MIME type
   * @param data.status - Optional initial status
   * @param data.tags - Optional tags for filtering
   * @param data.suiVaultId - Optional associated Sui vault ID
   * @param data.ownerAddress - Optional owner wallet address
   * @returns The created blob registration
   *
   * @example
   * ```typescript
   * const blob = await client.createBlob('org_abc123', {
   *   projectId: 'proj_xyz',
   *   blobId: '0x123abc...',
   *   name: 'My Blob',
   * });
   * ```
   */
  async createBlob(orgId: string, data: {
    projectId: string;
    blobId: string;
    name?: string;
    sizeBytes?: number;
    contentType?: string;
    status?: string;
    tags?: string[];
    suiVaultId?: string;
    ownerAddress?: string;
  }): Promise<BlobRegistration> {
    return this.requestWithRetry<BlobRegistration>('POST', '/blobs', data, orgId);
  }

  /**
   * Update a blob registration.
   *
   * @param orgId - Organization UUID
   * @param blobId - Blob UUID
   * @param data - Partial blob fields to update
   * @returns The updated blob registration
   *
   * @example
   * ```typescript
   * await client.updateBlob('org_abc123', 'blob_xyz', { name: 'Updated Name' });
   * ```
   */
  async updateBlob(orgId: string, blobId: string, data: Partial<BlobRegistration>): Promise<BlobRegistration> {
    return this.requestWithRetry<BlobRegistration>('PATCH', `/blobs/${blobId}`, data, orgId);
  }

  /**
   * Delete a blob registration.
   *
   * @param orgId - Organization UUID
   * @param blobId - Blob UUID
   * @returns A confirmation message
   *
   * @example
   * ```typescript
   * await client.deleteBlob('org_abc123', 'blob_xyz');
   * ```
   */
  async deleteBlob(orgId: string, blobId: string): Promise<{ message: string }> {
    return this.requestWithRetry<{ message: string }>('DELETE', `/blobs/${blobId}`, undefined, orgId);
  }

  /**
   * Perform a bulk action on multiple blobs.
   *
   * @param orgId - Organization UUID
   * @param action - Action to perform: "archive", "activate", or "delete"
   * @param ids - Array of blob UUIDs
   * @returns Summary with count of processed and skipped items
   *
   * @example
   * ```typescript
   * const result = await client.bulkBlobAction('org_abc123', 'archive', ['blob_1', 'blob_2']);
   * console.log(`Processed: ${result.processed}, Skipped: ${result.skipped}`);
   * ```
   */
  async bulkBlobAction(orgId: string, action: 'archive' | 'activate' | 'delete', ids: string[]): Promise<{ message: string; processed: number; skipped: number }> {
    return this.requestWithRetry<{ message: string; processed: number; skipped: number }>('POST', '/blobs/bulk', { action, ids }, orgId);
  }

  /**
   * Export all blob registrations for an organization.
   *
   * @param orgId - Organization UUID
   * @returns Object containing all blobs
   *
   * @example
   * ```typescript
   * const { blobs } = await client.exportBlobs('org_abc123');
   * ```
   */
  async exportBlobs(orgId: string): Promise<{ blobs: BlobRegistration[] }> {
    return this.requestWithRetry<{ blobs: BlobRegistration[] }>('GET', '/blobs/export', undefined, orgId);
  }

  // ==================== Project Blobs ====================

  /**
   * List blobs scoped to a specific project.
   *
   * @param projectId - Project UUID
   * @param params - Optional query parameters
   * @param params.search - Search blobs by name/blobId
   * @param params.status - Filter by status
   * @param params.page - Page number
   * @param params.limit - Items per page
   * @returns Paginated list of blobs within the project
   *
   * @example
   * ```typescript
   * const result = await client.getProjectBlobs('proj_xyz', { status: 'active' });
   * ```
   */
  async getProjectBlobs(projectId: string, params?: { search?: string; status?: string; page?: number; limit?: number }): Promise<PaginatedResponse<BlobRegistration>> {
    const query = new URLSearchParams();
    if (params?.search) query.set('search', params.search);
    if (params?.status) query.set('status', params.status);
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    const qs = query.toString();
    return this.requestWithRetry<PaginatedResponse<BlobRegistration>>('GET', `/projects/${projectId}/blobs${qs ? `?${qs}` : ''}`);
  }

  // ==================== Policies ====================

  /**
   * List all renewal policies in an organization.
   *
   * @param orgId - Organization UUID
   * @returns Array of policies
   *
   * @example
   * ```typescript
   * const policies = await client.listPolicies('org_abc123');
   * ```
   */
  async listPolicies(orgId: string): Promise<Policy[]> {
    const res = await this.requestWithRetry<{ policies: Policy[] }>('GET', '/policies', undefined, orgId);
    return res.policies;
  }

  /**
   * Get a policy by ID.
   *
   * @param orgId - Organization UUID
   * @param policyId - Policy UUID
   * @returns The policy
   *
   * @example
   * ```typescript
   * const policy = await client.getPolicy('org_abc123', 'pol_xyz');
   * ```
   */
  async getPolicy(orgId: string, policyId: string): Promise<Policy> {
    return this.requestWithRetry<Policy>('GET', `/policies/${policyId}`, undefined, orgId);
  }

  /**
   * Create a new renewal policy.
   *
   * @param orgId - Organization UUID
   * @param data - Policy configuration
   * @param data.name - Policy name
   * @param data.description - Optional description
   * @param data.rules - Optional custom rules
   * @param data.renewThreshold - Epochs before expiry to trigger renewal
   * @param data.renewExtension - Number of epochs to extend on each renewal
   * @param data.maxTotalEpochs - Optional maximum total epochs
   * @param data.active - Whether the policy is active (default: true)
   * @returns The created policy
   *
   * @example
   * ```typescript
   * const policy = await client.createPolicy('org_abc123', {
   *   name: 'Auto-renew 30 days',
   *   renewThreshold: 5,
   *   renewExtension: 10,
   * });
   * ```
   */
  async createPolicy(orgId: string, data: {
    name: string;
    description?: string;
    rules?: Record<string, unknown>[];
    renewThreshold: number;
    renewExtension: number;
    maxTotalEpochs?: number;
    active?: boolean;
  }): Promise<Policy> {
    return this.requestWithRetry<Policy>('POST', '/policies', data, orgId);
  }

  /**
   * Update a policy's configuration.
   *
   * @param orgId - Organization UUID
   * @param policyId - Policy UUID
   * @param data - Partial policy fields to update
   * @returns The updated policy
   *
   * @example
   * ```typescript
   * await client.updatePolicy('org_abc123', 'pol_xyz', { renewThreshold: 10 });
   * ```
   */
  async updatePolicy(orgId: string, policyId: string, data: Partial<Policy>): Promise<Policy> {
    return this.requestWithRetry<Policy>('PATCH', `/policies/${policyId}`, data, orgId);
  }

  /**
   * Delete a policy.
   *
   * @param orgId - Organization UUID
   * @param policyId - Policy UUID
   * @returns A confirmation message
   *
   * @example
   * ```typescript
   * await client.deletePolicy('org_abc123', 'pol_xyz');
   * ```
   */
  async deletePolicy(orgId: string, policyId: string): Promise<{ message: string }> {
    return this.requestWithRetry<{ message: string }>('DELETE', `/policies/${policyId}`, undefined, orgId);
  }

  /**
   * Assign a policy to one or more blobs.
   *
   * @param orgId - Organization UUID
   * @param policyId - Policy UUID
   * @param blobIds - Array of blob UUIDs to assign
   * @returns Object with count of assigned blobs
   *
   * @example
   * ```typescript
   * const result = await client.assignPolicy('org_abc123', 'pol_xyz', ['blob_1', 'blob_2']);
   * ```
   */
  async assignPolicy(orgId: string, policyId: string, blobIds: string[]): Promise<{ assigned: number }> {
    return this.requestWithRetry<{ assigned: number }>('POST', `/policies/${policyId}/assign`, { blob_ids: blobIds }, orgId);
  }

  /**
   * Unassign a policy from one or more blobs.
   *
   * @param orgId - Organization UUID
   * @param policyId - Policy UUID
   * @param blobIds - Array of blob UUIDs to unassign
   * @returns Object with count of unassigned blobs
   *
   * @example
   * ```typescript
   * const result = await client.unassignPolicy('org_abc123', 'pol_xyz', ['blob_1']);
   * ```
   */
  async unassignPolicy(orgId: string, policyId: string, blobIds: string[]): Promise<{ unassigned: number }> {
    return this.requestWithRetry<{ unassigned: number }>('POST', `/policies/${policyId}/unassign`, { blob_ids: blobIds }, orgId);
  }

  // ==================== Wallets ====================

  /**
   * List all wallets in an organization.
   *
   * @param orgId - Organization UUID
   * @returns Array of wallets
   *
   * @example
   * ```typescript
   * const wallets = await client.listWallets('org_abc123');
   * ```
   */
  async listWallets(orgId: string): Promise<Wallet[]> {
    const res = await this.requestWithRetry<{ wallets: Wallet[] }>('GET', '/wallets', undefined, orgId);
    return res.wallets;
  }

  /**
   * Get a wallet by ID.
   *
   * @param orgId - Organization UUID
   * @param walletId - Wallet UUID
   * @returns The wallet
   *
   * @example
   * ```typescript
   * const wallet = await client.getWallet('org_abc123', 'wal_xyz');
   * ```
   */
  async getWallet(orgId: string, walletId: string): Promise<Wallet> {
    return this.requestWithRetry<Wallet>('GET', `/wallets/${walletId}`, undefined, orgId);
  }

  /**
   * Register a new wallet address.
   *
   * @param orgId - Organization UUID
   * @param data - Wallet registration data
   * @param data.address - Sui wallet address
   * @param data.label - Optional human-readable label
   * @param data.type - Wallet type (e.g. "owned", "watch-only")
   * @param data.isDefault - Whether to set as the default wallet
   * @param data.spendingLimit - Optional spending limit
   * @returns The created wallet
   *
   * @example
   * ```typescript
   * const wallet = await client.createWallet('org_abc123', {
   *   address: '0xabc...',
   *   label: 'Primary',
   * });
   * ```
   */
  async createWallet(orgId: string, data: {
    address: string;
    label?: string;
    type?: string;
    isDefault?: boolean;
    spendingLimit?: number;
  }): Promise<Wallet> {
    return this.requestWithRetry<Wallet>('POST', '/wallets', data, orgId);
  }

  /**
   * Update a wallet's settings.
   *
   * @param orgId - Organization UUID
   * @param walletId - Wallet UUID
   * @param data - Fields to update (label, isDefault, spendingLimit)
   * @returns The updated wallet
   *
   * @example
   * ```typescript
   * await client.updateWallet('org_abc123', 'wal_xyz', { spendingLimit: 5000 });
   * ```
   */
  async updateWallet(orgId: string, walletId: string, data: { label?: string; isDefault?: boolean; spendingLimit?: number }): Promise<Wallet> {
    return this.requestWithRetry<Wallet>('PATCH', `/wallets/${walletId}`, data, orgId);
  }

  /**
   * Delete a wallet.
   *
   * @param orgId - Organization UUID
   * @param walletId - Wallet UUID
   * @returns A confirmation message
   *
   * @example
   * ```typescript
   * await client.deleteWallet('org_abc123', 'wal_xyz');
   * ```
   */
  async deleteWallet(orgId: string, walletId: string): Promise<{ message: string }> {
    return this.requestWithRetry<{ message: string }>('DELETE', `/wallets/${walletId}`, undefined, orgId);
  }

  /**
   * Refresh the on-chain balance of a wallet.
   *
   * @param orgId - Organization UUID
   * @param walletId - Wallet UUID
   * @returns Object with confirmation message and updated balance
   *
   * @example
   * ```typescript
   * const { balance } = await client.refreshWalletBalance('org_abc123', 'wal_xyz');
   * ```
   */
  async refreshWalletBalance(orgId: string, walletId: string): Promise<{ message: string; balance: number }> {
    return this.requestWithRetry<{ message: string; balance: number }>('POST', `/wallets/${walletId}/refresh-balance`, undefined, orgId);
  }

  // ==================== Channels ====================

  /**
   * List all notification channels in an organization.
   *
   * @param orgId - Organization UUID
   * @returns Array of notification channels
   *
   * @example
   * ```typescript
   * const channels = await client.listChannels('org_abc123');
   * ```
   */
  async listChannels(orgId: string): Promise<NotificationChannel[]> {
    const res = await this.requestWithRetry<{ channels: NotificationChannel[] }>('GET', '/alerts/channels', undefined, orgId);
    return res.channels;
  }

  /**
   * Get a notification channel by ID.
   *
   * @param orgId - Organization UUID
   * @param channelId - Channel UUID
   * @returns The notification channel
   *
   * @example
   * ```typescript
   * const channel = await client.getChannel('org_abc123', 'ch_xyz');
   * ```
   */
  async getChannel(orgId: string, channelId: string): Promise<NotificationChannel> {
    return this.requestWithRetry<NotificationChannel>('GET', `/alerts/channels/${channelId}`, undefined, orgId);
  }

  /**
   * Create a new notification channel.
   *
   * @param orgId - Organization UUID
   * @param data - Channel configuration
   * @param data.type - Channel type (e.g. "email", "slack", "webhook")
   * @param data.name - Display name
   * @param data.config - Type-specific configuration
   * @param data.enabled - Whether the channel is active (default: true)
   * @returns The created channel
   *
   * @example
   * ```typescript
   * const channel = await client.createChannel('org_abc123', {
   *   type: 'slack',
   *   name: 'Alerts',
   *   config: { webhook_url: 'https://hooks.slack.com/...' },
   * });
   * ```
   */
  async createChannel(orgId: string, data: {
    type: string;
    name: string;
    config: Record<string, unknown>;
    enabled?: boolean;
  }): Promise<NotificationChannel> {
    return this.requestWithRetry<NotificationChannel>('POST', '/alerts/channels', data, orgId);
  }

  /**
   * Update a notification channel.
   *
   * @param orgId - Organization UUID
   * @param channelId - Channel UUID
   * @param data - Partial channel fields to update
   * @returns The updated channel
   *
   * @example
   * ```typescript
   * await client.updateChannel('org_abc123', 'ch_xyz', { enabled: false });
   * ```
   */
  async updateChannel(orgId: string, channelId: string, data: Partial<NotificationChannel>): Promise<NotificationChannel> {
    return this.requestWithRetry<NotificationChannel>('PATCH', `/alerts/channels/${channelId}`, data, orgId);
  }

  /**
   * Delete a notification channel.
   *
   * @param orgId - Organization UUID
   * @param channelId - Channel UUID
   * @returns A confirmation message
   *
   * @example
   * ```typescript
   * await client.deleteChannel('org_abc123', 'ch_xyz');
   * ```
   */
  async deleteChannel(orgId: string, channelId: string): Promise<{ message: string }> {
    return this.requestWithRetry<{ message: string }>('DELETE', `/alerts/channels/${channelId}`, undefined, orgId);
  }

  // ==================== Alert Rules ====================

  /**
   * List all alert rules in an organization.
   *
   * @param orgId - Organization UUID
   * @returns Array of alert rules
   *
   * @example
   * ```typescript
   * const rules = await client.listAlertRules('org_abc123');
   * ```
   */
  async listAlertRules(orgId: string): Promise<AlertRule[]> {
    const res = await this.requestWithRetry<{ rules: AlertRule[] }>('GET', '/alerts/rules', undefined, orgId);
    return res.rules;
  }

  /**
   * Get an alert rule by ID.
   *
   * @param orgId - Organization UUID
   * @param ruleId - Rule UUID
   * @returns The alert rule
   *
   * @example
   * ```typescript
   * const rule = await client.getAlertRule('org_abc123', 'rule_xyz');
   * ```
   */
  async getAlertRule(orgId: string, ruleId: string): Promise<AlertRule> {
    return this.requestWithRetry<AlertRule>('GET', `/alerts/rules/${ruleId}`, undefined, orgId);
  }

  /**
   * Create a new alert rule.
   *
   * @param orgId - Organization UUID
   * @param data - Rule configuration
   * @param data.name - Rule name
   * @param data.trigger - Trigger event type
   * @param data.conditions - Optional trigger conditions
   * @param data.channelIds - Notification channels to fire on
   * @param data.projectIds - Optional project scope
   * @param data.enabled - Whether the rule is active (default: true)
   * @returns The created alert rule
   *
   * @example
   * ```typescript
   * const rule = await client.createAlertRule('org_abc123', {
   *   name: 'Notify on expiry',
   *   trigger: 'blob_expiring',
   *   channelIds: ['ch_xyz'],
   * });
   * ```
   */
  async createAlertRule(orgId: string, data: {
    name: string;
    trigger: string;
    conditions?: Record<string, unknown>;
    channelIds?: string[];
    projectIds?: string[];
    enabled?: boolean;
  }): Promise<AlertRule> {
    return this.requestWithRetry<AlertRule>('POST', '/alerts/rules', data, orgId);
  }

  /**
   * Update an alert rule.
   *
   * @param orgId - Organization UUID
   * @param ruleId - Rule UUID
   * @param data - Partial rule fields to update
   * @returns The updated alert rule
   *
   * @example
   * ```typescript
   * await client.updateAlertRule('org_abc123', 'rule_xyz', { enabled: false });
   * ```
   */
  async updateAlertRule(orgId: string, ruleId: string, data: Partial<AlertRule>): Promise<AlertRule> {
    return this.requestWithRetry<AlertRule>('PATCH', `/alerts/rules/${ruleId}`, data, orgId);
  }

  /**
   * Delete an alert rule.
   *
   * @param orgId - Organization UUID
   * @param ruleId - Rule UUID
   * @returns A confirmation message
   *
   * @example
   * ```typescript
   * await client.deleteAlertRule('org_abc123', 'rule_xyz');
   * ```
   */
  async deleteAlertRule(orgId: string, ruleId: string): Promise<{ message: string }> {
    return this.requestWithRetry<{ message: string }>('DELETE', `/alerts/rules/${ruleId}`, undefined, orgId);
  }

  // ==================== Analytics ====================

  /**
   * Get an analytics overview for the organization.
   *
   * @param orgId - Organization UUID
   * @returns Overview counts for blobs, projects, policies, and wallets
   *
   * @example
   * ```typescript
   * const overview = await client.getAnalyticsOverview('org_abc123');
   * ```
   */
  async getAnalyticsOverview(orgId: string): Promise<AnalyticsOverview> {
    return this.requestWithRetry<AnalyticsOverview>('GET', '/analytics/overview', undefined, orgId);
  }

  /**
   * Get storage analytics.
   *
   * @param orgId - Organization UUID
   * @returns Storage metrics including size distribution by status
   *
   * @example
   * ```typescript
   * const storage = await client.getAnalyticsStorage('org_abc123');
   * ```
   */
  async getAnalyticsStorage(orgId: string): Promise<AnalyticsStorage> {
    return this.requestWithRetry<AnalyticsStorage>('GET', '/analytics/storage', undefined, orgId);
  }

  /**
   * Get total renewal count.
   *
   * @param orgId - Organization UUID
   * @returns Total number of renewals processed
   *
   * @example
   * ```typescript
   * const { totalRenewals } = await client.getAnalyticsRenewals('org_abc123');
   * ```
   */
  async getAnalyticsRenewals(orgId: string): Promise<{ totalRenewals: number }> {
    return this.requestWithRetry<{ totalRenewals: number }>('GET', '/analytics/renewals', undefined, orgId);
  }

  /**
   * Get cost analytics.
   *
   * @param orgId - Organization UUID
   * @returns Cost breakdown by period
   *
   * @example
   * ```typescript
   * const costs = await client.getAnalyticsCosts('org_abc123');
   * ```
   */
  async getAnalyticsCosts(orgId: string): Promise<AnalyticsCostResponse> {
    return this.requestWithRetry<AnalyticsCostResponse>('GET', '/analytics/costs', undefined, orgId);
  }

  /**
   * Get cost forecast analytics.
   *
   * @param orgId - Organization UUID
   * @returns Projected costs by period
   *
   * @example
   * ```typescript
   * const forecast = await client.getAnalyticsForecasts('org_abc123');
   * ```
   */
  async getAnalyticsForecasts(orgId: string): Promise<AnalyticsForecastResponse> {
    return this.requestWithRetry<AnalyticsForecastResponse>('GET', '/analytics/forecasts', undefined, orgId);
  }

  // ==================== Audit Logs ====================

  /**
   * Get audit logs for an organization.
   *
   * @param orgId - Organization UUID
   * @returns Array of audit log entries
   *
   * @example
   * ```typescript
   * const logs = await client.getAuditLogs('org_abc123');
   * ```
   */
  async getAuditLogs(orgId: string): Promise<AuditLog[]> {
    const res = await this.requestWithRetry<{ auditLogs: AuditLog[] }>('GET', '/audit-logs', undefined, orgId);
    return res.auditLogs;
  }

  // ==================== Billing ====================

  /**
   * Get the current subscription plan for an organization.
   *
   * @param orgId - Organization UUID
   * @returns The current subscription
   *
   * @example
   * ```typescript
   * const sub = await client.getSubscription('org_abc123');
   * ```
   */
  async getSubscription(orgId: string): Promise<Subscription> {
    return this.requestWithRetry<Subscription>('GET', '/billing/subscription', undefined, orgId);
  }

  /**
   * Create or update the subscription plan for an organization.
   *
   * @param orgId - Organization UUID
   * @param plan - Plan identifier (e.g. "free", "pro", "enterprise")
   * @returns The created or updated subscription
   *
   * @example
   * ```typescript
   * const sub = await client.createOrUpdateSubscription('org_abc123', 'pro');
   * ```
   */
  async createOrUpdateSubscription(orgId: string, plan: string): Promise<Subscription> {
    return this.requestWithRetry<Subscription>('POST', '/billing/subscription', { plan }, orgId);
  }

  /**
   * List invoices for an organization.
   *
   * @param orgId - Organization UUID
   * @returns Array of invoices
   *
   * @example
   * ```typescript
   * const invoices = await client.listInvoices('org_abc123');
   * ```
   */
  async listInvoices(orgId: string): Promise<Invoice[]> {
    const res = await this.requestWithRetry<{ invoices: Invoice[] }>('GET', '/billing/invoices', undefined, orgId);
    return res.invoices;
  }

  /**
   * Get usage records for an organization.
   *
   * @param orgId - Organization UUID
   * @returns Array of usage records
   *
   * @example
   * ```typescript
   * const usage = await client.getUsage('org_abc123');
   * ```
   */
  async getUsage(orgId: string): Promise<UsageRecord[]> {
    const res = await this.requestWithRetry<{ usage: UsageRecord[] }>('GET', '/billing/usage', undefined, orgId);
    return res.usage;
  }

  // ==================== API Keys ====================

  /**
   * List all API keys for an organization.
   *
   * @param orgId - Organization UUID
   * @returns Array of API keys (rawKey will be masked)
   *
   * @example
   * ```typescript
   * const keys = await client.listApiKeys('org_abc123');
   * ```
   */
  async listApiKeys(orgId: string): Promise<ApiKey[]> {
    const res = await this.requestWithRetry<{ apiKeys: ApiKey[] }>('GET', '/api-keys', undefined, orgId);
    return res.apiKeys;
  }

  /**
   * Create a new API key.
   *
   * @param orgId - Organization UUID
   * @param data - API key configuration
   * @param data.name - Key name for identification
   * @param data.permissions - Optional list of permission strings
   * @param data.expiresAt - Optional ISO date string for expiry
   * @returns The created API key including the raw key (shown once only)
   *
   * @example
   * ```typescript
   * const { rawKey } = await client.createApiKey('org_abc123', { name: 'CI/CD' });
   * console.log('Save this key:', rawKey);
   * ```
   */
  async createApiKey(orgId: string, data: { name: string; permissions?: string[]; expiresAt?: string }): Promise<ApiKey & { rawKey: string }> {
    return this.requestWithRetry<ApiKey & { rawKey: string }>('POST', '/api-keys', data, orgId);
  }

  /**
   * Delete an API key.
   *
   * @param orgId - Organization UUID
   * @param keyId - API key UUID
   * @returns A confirmation message
   *
   * @example
   * ```typescript
   * await client.deleteApiKey('org_abc123', 'key_xyz');
   * ```
   */
  async deleteApiKey(orgId: string, keyId: string): Promise<{ message: string }> {
    return this.requestWithRetry<{ message: string }>('DELETE', `/api-keys/${keyId}`, undefined, orgId);
  }

  // ==================== Vaults ====================

  /**
   * Create a new vault with blob registration.
   *
   * @param data - Vault configuration
   * @param data.wallet_address - Sui wallet address
   * @param data.blob_id - On-chain blob identifier
   * @param data.initial_wal_amount - Initial WAL amount to deposit
   * @param data.renew_threshold_epochs - Epochs before expiry to trigger renewal
   * @param data.renew_by_epochs - Number of epochs to extend on each renewal
   * @param data.max_total_epochs - Optional maximum total epochs
   * @returns The created vault transaction
   * @throws {WalwatchValidationError} If parameters are invalid
   *
   * @example
   * ```typescript
   * const vault = await client.createVault({
   *   wallet_address: '0xabc...',
   *   blob_id: '0x123...',
   *   initial_wal_amount: '100',
   *   renew_threshold_epochs: 5,
   *   renew_by_epochs: 10,
   * });
   * ```
   */
  async createVault(data: CreateVaultParams): Promise<VaultTransaction> {
    return this.requestWithRetry<VaultTransaction>('POST', '/vaults', data);
  }

  /**
   * Get all vaults associated with a wallet address.
   *
   * @param walletAddress - Sui wallet address
   * @returns Object containing array of vaults
   *
   * @example
   * ```typescript
   * const { vaults } = await client.getVaults('0xabc...');
   * ```
   */
  async getVaults(walletAddress: string): Promise<{ vaults: Vault[] }> {
    return this.requestWithRetry<{ vaults: Vault[] }>('GET', `/vaults/${walletAddress}`);
  }

  /**
   * Deposit WAL tokens into a vault.
   *
   * @param vaultId - Vault UUID
   * @param data - Deposit details
   * @param data.wallet_address - Source wallet address
   * @param data.amount - Amount of WAL to deposit
   * @returns The vault transaction
   *
   * @example
   * ```typescript
   * const tx = await client.depositToVault('vault_xyz', {
   *   wallet_address: '0xabc...',
   *   amount: '50',
   * });
   * ```
   */
  async depositToVault(vaultId: string, data: { wallet_address: string; amount: string }): Promise<VaultTransaction> {
    return this.requestWithRetry<VaultTransaction>('POST', `/vaults/${vaultId}/deposit`, data);
  }

  /**
   * Update the renewal policy for a vault.
   *
   * @param vaultId - Vault UUID
   * @param data - Policy update data
   * @param data.wallet_address - Wallet address (must match vault owner)
   * @param data.renew_threshold_epochs - New renewal threshold
   * @param data.renew_by_epochs - New renewal extension
   * @param data.max_total_epochs - Optional new max total epochs
   * @param data.active - Whether the renewal policy is active
   * @returns The vault transaction
   *
   * @example
   * ```typescript
   * const tx = await client.updateVaultPolicy('vault_xyz', {
   *   wallet_address: '0xabc...',
   *   renew_threshold_epochs: 10,
   *   renew_by_epochs: 20,
   *   active: true,
   * });
   * ```
   */
  async updateVaultPolicy(vaultId: string, data: {
    wallet_address: string;
    renew_threshold_epochs: number;
    renew_by_epochs: number;
    max_total_epochs?: number;
    active: boolean;
  }): Promise<VaultTransaction> {
    return this.requestWithRetry<VaultTransaction>('POST', `/vaults/${vaultId}/policy`, data);
  }

  /**
   * Withdraw WAL tokens from a vault.
   *
   * @param vaultId - Vault UUID
   * @param data - Withdrawal details
   * @param data.wallet_address - Destination wallet address
   * @param data.amount - Amount of WAL to withdraw
   * @returns The vault transaction
   *
   * @example
   * ```typescript
   * const tx = await client.withdrawFromVault('vault_xyz', {
   *   wallet_address: '0xabc...',
   *   amount: '25',
   * });
   * ```
   */
  async withdrawFromVault(vaultId: string, data: { wallet_address: string; amount: string }): Promise<VaultTransaction> {
    return this.requestWithRetry<VaultTransaction>('POST', `/vaults/${vaultId}/withdraw`, data);
  }

  /**
   * Reclaim a vault and return remaining WAL to the owner.
   *
   * @param vaultId - Vault UUID
   * @param data - Reclaim details
   * @param data.wallet_address - Wallet address to receive remaining funds
   * @returns The vault transaction
   *
   * @example
   * ```typescript
   * const tx = await client.reclaimFromVault('vault_xyz', {
   *   wallet_address: '0xabc...',
   * });
   * ```
   */
  async reclaimFromVault(vaultId: string, data: { wallet_address: string }): Promise<VaultTransaction> {
    return this.requestWithRetry<VaultTransaction>('POST', `/vaults/${vaultId}/reclaim`, data);
  }

  /**
   * Get the transaction history for a vault.
   *
   * @param vaultId - Vault UUID
   * @param page - Optional page number (1-indexed)
   * @param limit - Optional items per page
   * @returns Paginated vault history entries
   *
   * @example
   * ```typescript
   * const { history } = await client.getVaultHistory('vault_xyz', 1, 20);
   * ```
   */
  async getVaultHistory(vaultId: string, page?: number, limit?: number): Promise<{ history: VaultHistoryEntry[]; page: number; limit: number }> {
    const query = new URLSearchParams();
    if (page) query.set('page', String(page));
    if (limit) query.set('limit', String(limit));
    const qs = query.toString();
    return this.requestWithRetry<{ history: VaultHistoryEntry[]; page: number; limit: number }>('GET', `/vaults/${vaultId}/history${qs ? `?${qs}` : ''}`);
  }

  // ==================== High-level conveniences ====================

  /**
   * Track a blob's current status by its on-chain blob ID.
   *
   * @param blobId - On-chain blob identifier
   * @returns The blob registration
   *
   * @example
   * ```typescript
   * const blob = await client.track('0x123...');
   * ```
   */
  async track(blobId: string): Promise<BlobRegistration> {
    return this.requestWithRetry<BlobRegistration>('GET', `/blobs/${blobId}`, undefined, null);
  }

  // ── Publisher methods ──────────────────────────────────────────────────

  async listPublishers(orgId: string): Promise<Publisher[]> {
    const res = await this.requestWithRetry<{ publishers: Publisher[] }>('GET', `/publishers`, undefined, orgId);
    return res.publishers;
  }

  async getPublisher(orgId: string, id: string): Promise<Publisher> {
    return this.requestWithRetry<Publisher>('GET', `/publishers/${id}`, undefined, orgId);
  }

  async createPublisher(orgId: string, data: { name: string; description?: string; endpoint?: string; walletAddress?: string; suiVaultId?: string }): Promise<Publisher> {
    return this.requestWithRetry<Publisher>('POST', `/publishers`, data, orgId);
  }

  async updatePublisher(orgId: string, id: string, data: Partial<Publisher>): Promise<Publisher> {
    return this.requestWithRetry<Publisher>('PATCH', `/publishers/${id}`, data, orgId);
  }

  async deletePublisher(orgId: string, id: string): Promise<{ message: string }> {
    return this.requestWithRetry<{ message: string }>('DELETE', `/publishers/${id}`, undefined, orgId);
  }

  async publisherHeartbeat(orgId: string, id: string): Promise<{ message: string }> {
    return this.requestWithRetry<{ message: string }>('POST', `/publishers/${id}/heartbeat`, undefined, orgId);
  }

  // ── Aggregator methods ────────────────────────────────────────────────

  async listAggregators(orgId: string): Promise<Aggregator[]> {
    const res = await this.requestWithRetry<{ aggregators: Aggregator[] }>('GET', `/aggregators`, undefined, orgId);
    return res.aggregators;
  }

  async getAggregator(orgId: string, id: string): Promise<Aggregator> {
    return this.requestWithRetry<Aggregator>('GET', `/aggregators/${id}`, undefined, orgId);
  }

  async createAggregator(orgId: string, data: { name: string; publisherId?: string; endpoint?: string }): Promise<Aggregator> {
    return this.requestWithRetry<Aggregator>('POST', `/aggregators`, data, orgId);
  }

  async updateAggregator(orgId: string, id: string, data: Partial<Aggregator>): Promise<Aggregator> {
    return this.requestWithRetry<Aggregator>('PATCH', `/aggregators/${id}`, data, orgId);
  }

  async deleteAggregator(orgId: string, id: string): Promise<{ message: string }> {
    return this.requestWithRetry<{ message: string }>('DELETE', `/aggregators/${id}`, undefined, orgId);
  }

  async aggregatorHeartbeat(orgId: string, id: string): Promise<{ message: string }> {
    return this.requestWithRetry<{ message: string }>('POST', `/aggregators/${id}/heartbeat`, undefined, orgId);
  }

  // ── Budget methods ────────────────────────────────────────────────────

  async listBudgets(orgId: string): Promise<Budget[]> {
    const res = await this.requestWithRetry<{ budgets: Budget[] }>('GET', `/budgets`, undefined, orgId);
    return res.budgets;
  }

  async getBudget(orgId: string, id: string): Promise<Budget> {
    return this.requestWithRetry<Budget>('GET', `/budgets/${id}`, undefined, orgId);
  }

  async createBudget(orgId: string, data: { name: string; amount: number; projectId?: string; period?: string; currency?: string; alertThreshold?: number }): Promise<Budget> {
    return this.requestWithRetry<Budget>('POST', `/budgets`, data, orgId);
  }

  async updateBudget(orgId: string, id: string, data: Partial<Budget>): Promise<Budget> {
    return this.requestWithRetry<Budget>('PATCH', `/budgets/${id}`, data, orgId);
  }

  async deleteBudget(orgId: string, id: string): Promise<{ message: string }> {
    return this.requestWithRetry<{ message: string }>('DELETE', `/budgets/${id}`, undefined, orgId);
  }

  async pauseBudget(orgId: string, id: string): Promise<{ message: string }> {
    return this.requestWithRetry<{ message: string }>('POST', `/budgets/${id}/pause`, undefined, orgId);
  }

  async activateBudget(orgId: string, id: string): Promise<{ message: string }> {
    return this.requestWithRetry<{ message: string }>('POST', `/budgets/${id}/activate`, undefined, orgId);
  }

  async archiveBudget(orgId: string, id: string): Promise<{ message: string }> {
    return this.requestWithRetry<{ message: string }>('POST', `/budgets/${id}/archive`, undefined, orgId);
  }

  // ── Spending Limit methods ────────────────────────────────────────────

  async listSpendingLimits(orgId: string): Promise<SpendingLimit[]> {
    const res = await this.requestWithRetry<{ spendingLimits: SpendingLimit[] }>('GET', `/spending-limits`, undefined, orgId);
    return res.spendingLimits;
  }

  async getSpendingLimit(orgId: string, id: string): Promise<SpendingLimit> {
    return this.requestWithRetry<SpendingLimit>('GET', `/spending-limits/${id}`, undefined, orgId);
  }

  async createSpendingLimit(orgId: string, data: { walletId: string; amount: number; name?: string; period?: string }): Promise<SpendingLimit> {
    return this.requestWithRetry<SpendingLimit>('POST', `/spending-limits`, data, orgId);
  }

  async updateSpendingLimit(orgId: string, id: string, data: Partial<SpendingLimit>): Promise<SpendingLimit> {
    return this.requestWithRetry<SpendingLimit>('PATCH', `/spending-limits/${id}`, data, orgId);
  }

  async deleteSpendingLimit(orgId: string, id: string): Promise<{ message: string }> {
    return this.requestWithRetry<{ message: string }>('DELETE', `/spending-limits/${id}`, undefined, orgId);
  }

  async pauseSpendingLimit(orgId: string, id: string): Promise<SpendingLimit> {
    return this.requestWithRetry<SpendingLimit>('POST', `/spending-limits/${id}/pause`, undefined, orgId);
  }

  async activateSpendingLimit(orgId: string, id: string): Promise<SpendingLimit> {
    return this.requestWithRetry<SpendingLimit>('POST', `/spending-limits/${id}/activate`, undefined, orgId);
  }

  async archiveSpendingLimit(orgId: string, id: string): Promise<{ message: string }> {
    return this.requestWithRetry<{ message: string }>('POST', `/spending-limits/${id}/archive`, undefined, orgId);
  }

  // ── Team methods ──────────────────────────────────────────────────────

  async listTeams(orgId: string): Promise<Team[]> {
    const res = await this.requestWithRetry<{ teams: Team[] }>('GET', `/teams`, undefined, orgId);
    return res.teams;
  }

  async getTeam(orgId: string, id: string): Promise<Team & { members: TeamMember[] }> {
    return this.requestWithRetry<Team & { members: TeamMember[] }>('GET', `/teams/${id}`, undefined, orgId);
  }

  async createTeam(orgId: string, data: { name: string; description?: string }): Promise<Team> {
    return this.requestWithRetry<Team>('POST', `/teams`, data, orgId);
  }

  async updateTeam(orgId: string, id: string, data: Partial<Team>): Promise<Team> {
    return this.requestWithRetry<Team>('PATCH', `/teams/${id}`, data, orgId);
  }

  async deleteTeam(orgId: string, id: string): Promise<{ message: string }> {
    return this.requestWithRetry<{ message: string }>('DELETE', `/teams/${id}`, undefined, orgId);
  }

  async addTeamMember(orgId: string, teamId: string, userId: string, role?: string): Promise<TeamMember> {
    return this.requestWithRetry<TeamMember>('POST', `/teams/${teamId}/members`, { userId, role }, orgId);
  }

  async removeTeamMember(orgId: string, teamId: string, userId: string): Promise<{ message: string }> {
    return this.requestWithRetry<{ message: string }>('DELETE', `/teams/${teamId}/members/${userId}`, undefined, orgId);
  }

  // ── Invitation methods ────────────────────────────────────────────────

  async listInvitations(orgId: string): Promise<Invitation[]> {
    const res = await this.requestWithRetry<{ invitations: Invitation[] }>('GET', `/invitations`, undefined, orgId);
    return res.invitations;
  }

  async createInvitation(orgId: string, data: { email: string; role?: string }): Promise<Invitation> {
    return this.requestWithRetry<Invitation>('POST', `/invitations`, data, orgId);
  }

  async cancelInvitation(orgId: string, id: string): Promise<{ message: string }> {
    return this.requestWithRetry<{ message: string }>('DELETE', `/invitations/${id}`, undefined, orgId);
  }

  async acceptInvitation(token: string): Promise<{ message: string; orgId: string; role: string }> {
    return this.requestWithRetry<{ message: string; orgId: string; role: string }>('POST', `/invitations/accept`, { token });
  }

  // ── Renewal Job methods ───────────────────────────────────────────────

  async listRenewalJobs(orgId: string, params?: { status?: string }): Promise<RenewalJob[]> {
    const query = params?.status ? `?status=${params.status}` : '';
    const res = await this.requestWithRetry<{ renewalJobs: RenewalJob[] }>('GET', `/renewal-jobs${query}`, undefined, orgId);
    return res.renewalJobs;
  }

  async getRenewalJob(orgId: string, id: string): Promise<RenewalJob> {
    return this.requestWithRetry<RenewalJob>('GET', `/renewal-jobs/${id}`, undefined, orgId);
  }

  async retryRenewalJob(orgId: string, id: string): Promise<{ message: string }> {
    return this.requestWithRetry<{ message: string }>('POST', `/renewal-jobs/${id}/retry`, undefined, orgId);
  }

  async cancelRenewalJob(orgId: string, id: string): Promise<{ message: string }> {
    return this.requestWithRetry<{ message: string }>('POST', `/renewal-jobs/${id}/cancel`, undefined, orgId);
  }

  async createRenewalJob(orgId: string, data: {
    blobRegistrationId: string;
    walletId?: string;
    projectId?: string;
    policyId?: string;
    extensionEpochs?: number;
    maxAttempts?: number;
  }): Promise<RenewalJob> {
    return this.requestWithRetry<RenewalJob>('POST', `/renewal-jobs`, data, orgId);
  }

  // ── Policy lifecycle methods ──────────────────────────────────────────

  async pausePolicy(orgId: string, policyId: string): Promise<{ message: string }> {
    return this.requestWithRetry<{ message: string }>('POST', `/policies/${policyId}/pause`, undefined, orgId);
  }

  async activatePolicy(orgId: string, policyId: string): Promise<{ message: string }> {
    return this.requestWithRetry<{ message: string }>('POST', `/policies/${policyId}/activate`, undefined, orgId);
  }

  async archivePolicy(orgId: string, policyId: string): Promise<{ message: string }> {
    return this.requestWithRetry<{ message: string }>('POST', `/policies/${policyId}/archive`, undefined, orgId);
  }

  // ── Wallet lifecycle methods ──────────────────────────────────────────

  async suspendWallet(orgId: string, walletId: string): Promise<{ message: string }> {
    return this.requestWithRetry<{ message: string }>('POST', `/wallets/${walletId}/suspend`, undefined, orgId);
  }

  async unsuspendWallet(orgId: string, walletId: string): Promise<{ message: string }> {
    return this.requestWithRetry<{ message: string }>('POST', `/wallets/${walletId}/unsuspend`, undefined, orgId);
  }

  async restoreWallet(orgId: string, walletId: string): Promise<{ message: string }> {
    return this.requestWithRetry<{ message: string }>('POST', `/wallets/${walletId}/restore`, undefined, orgId);
  }

  async revokeWalletDelegation(orgId: string, walletId: string): Promise<{ message: string }> {
    return this.requestWithRetry<{ message: string }>('POST', `/wallets/${walletId}/revoke-delegation`, undefined, orgId);
  }

  async reconnectWallet(orgId: string, walletId: string): Promise<{ message: string }> {
    return this.requestWithRetry<{ message: string }>('POST', `/wallets/${walletId}/reconnect`, undefined, orgId);
  }

  /**
   * Manage a vault with a high-level action.
   *
   * Thin wrapper that delegates to the underlying API endpoint for each action.
   * Authoritative decisions (pause rules, resumption defaults) come from the API,
   * not from the SDK — this method does not embed business logic.
   *
   * @param orgId - Organization UUID
   * @param vaultId - Vault UUID
   * @param action - Action to perform: "pause", "resume", "withdraw", or "reclaim"
   * @param options - Optional parameters depending on action
   * @param options.amount - Amount for withdraw
   * @param options.wallet_address - Wallet address for on-chain operations
   * @returns The result of the action
   * @throws {Error} If an unknown action is provided
   *
   * @example
   * ```typescript
   * // Pause auto-renewal
   * await client.manage('org_abc123', 'vault_xyz', 'pause');
   *
   * // Resume with custom threshold
   * await client.manage('org_abc123', 'vault_xyz', 'resume', { wallet_address: '0xabc...' });
   *
   * // Withdraw
   * await client.manage('org_abc123', 'vault_xyz', 'withdraw', { amount: 50, wallet_address: '0xabc...' });
   *
   * // Reclaim
   * await client.manage('org_abc123', 'vault_xyz', 'reclaim', { wallet_address: '0xabc...' });
   * ```
   */
  async manage(orgId: string, vaultId: string, action: 'pause' | 'resume' | 'withdraw' | 'reclaim', options?: { amount?: number; wallet_address?: string }): Promise<any> {
    if (action === 'withdraw') {
      return this.withdrawFromVault(vaultId, {
        wallet_address: options?.wallet_address || '',
        amount: options?.amount ? String(options.amount) : '0',
      });
    }
    if (action === 'reclaim') {
      return this.reclaimFromVault(vaultId, {
        wallet_address: options?.wallet_address || '',
      });
    }
    if (action === 'pause') {
      // Delegate to the vault policy update endpoint; pause semantics are server-enforced.
      return this.updateVaultPolicy(vaultId, {
        wallet_address: options?.wallet_address || '',
        renew_threshold_epochs: 0,
        renew_by_epochs: 0,
        active: false,
      });
    }
    if (action === 'resume') {
      // Delegate to updateVaultPolicy; the server decides re-activation defaults.
      // Caller can use updateVaultPolicy() directly for full control.
      return this.updateVaultPolicy(vaultId, {
        wallet_address: options?.wallet_address || '',
        renew_threshold_epochs: options?.amount || 5,
        renew_by_epochs: 10,
        active: true,
      });
    }
    throw new Error(`Unknown action: ${action}`);
  }

  // ── Schedules ──────────────────────────────────────────────
  async listSchedules(orgId: string, params?: { type?: string }): Promise<Schedule[]> {
    const query = params?.type ? `?type=${params.type}` : '';
    return this.requestWithRetry<Schedule[]>('GET', `/schedules${query}`, undefined, orgId);
  }

  async createSchedule(orgId: string, data: Partial<Schedule>): Promise<Schedule> {
    return this.requestWithRetry<Schedule>('POST', '/schedules', data, orgId);
  }

  async updateSchedule(id: string, data: Partial<Schedule>): Promise<Schedule> {
    return this.requestWithRetry('PATCH', `/schedules/${id}`, data);
  }

  async deleteSchedule(id: string): Promise<{ message: string }> {
    return this.requestWithRetry('DELETE', `/schedules/${id}`);
  }

  // ── Dashboard ──────────────────────────────────────────────
  async getDashboardSummary(orgId: string, projectId?: string): Promise<DashboardSummary> {
    const query = projectId ? `?projectId=${projectId}` : '';
    return this.requestWithRetry('GET', `/dashboard/summary${query}`, undefined, orgId);
  }

  // ── Webhooks ───────────────────────────────────────────────
  async listWebhooks(orgId: string): Promise<Webhook[]> {
    return this.requestWithRetry<Webhook[]>('GET', '/webhooks', undefined, orgId);
  }

  async createWebhook(orgId: string, data: Partial<Webhook>): Promise<Webhook> {
    return this.requestWithRetry<Webhook>('POST', '/webhooks', data, orgId);
  }

  async updateWebhook(id: string, data: Partial<Webhook>): Promise<Webhook> {
    return this.requestWithRetry<Webhook>('PATCH', `/webhooks/${id}`, data);
  }

  async deleteWebhook(id: string): Promise<{ message: string }> {
    return this.requestWithRetry('DELETE', `/webhooks/${id}`);
  }

  async testWebhook(id: string): Promise<{ status: string; message: string }> {
    return this.requestWithRetry('POST', `/webhooks/${id}/test`);
  }

  // ── Alert Events ──────────────────────────────────────────
  async listAlertEvents(orgId: string, params?: { status?: string }): Promise<AlertEvent[]> {
    const query = params?.status ? `?status=${params.status}` : '';
    return this.requestWithRetry<AlertEvent[]>('GET', `/alert-events${query}`, undefined, orgId);
  }

  async acknowledgeAlertEvent(id: string): Promise<AlertEvent> {
    return this.requestWithRetry<AlertEvent>('POST', `/alert-events/${id}/acknowledge`);
  }

  // ── Admin ──────────────────────────────────────────────────
  async adminGetHealth(): Promise<AdminHealth> {
    return this.requestWithRetry('GET', '/admin/health');
  }

  async adminGetQueues(): Promise<QueueStatus[]> {
    return this.requestWithRetry('GET', '/admin/queues');
  }

  async adminTriggerScan(justification: string): Promise<{ status: string; message: string }> {
    return this.requestWithRetry('POST', '/admin/trigger-scan', { justification });
  }

  // ── Feature Flags ──────────────────────────────────────────
  async adminListFlags(): Promise<FeatureFlag[]> {
    return this.requestWithRetry<FeatureFlag[]>('GET', '/admin/flags');
  }

  async adminCreateFlag(data: Partial<FeatureFlag>): Promise<FeatureFlag> {
    return this.requestWithRetry<FeatureFlag>('POST', '/admin/flags', data);
  }

  async adminUpdateFlag(id: string, data: Partial<FeatureFlag>): Promise<FeatureFlag> {
    return this.requestWithRetry<FeatureFlag>('PATCH', `/admin/flags/${id}`, data);
  }

  async adminDeleteFlag(id: string): Promise<{ message: string }> {
    return this.requestWithRetry<{ message: string }>('DELETE', `/admin/flags/${id}`);
  }

  async adminCheckFlag(id: string, orgId?: string): Promise<{ enabled: boolean }> {
    const query = orgId ? `?orgId=${orgId}` : '';
    return this.requestWithRetry<{ enabled: boolean }>('GET', `/admin/flags/${id}/check${query}`);
  }

  async adminGetMetrics(): Promise<AdminMetrics> {
    return this.requestWithRetry<AdminMetrics>('GET', '/admin/metrics');
  }

  async adminGetTenant(orgId: string): Promise<AdminTenantResponse> {
    return this.requestWithRetry<AdminTenantResponse>('GET', `/admin/tenants/${orgId}`);
  }

  /**
   * Get tenant details for a specific organization.
   * This is an alias for adminGetTenant — the name is kept for backward compatibility
   * but actually operates on a single org, not a list.
   *
   * @param orgId - Organization UUID
   * @returns Tenant details with org info and stats
   */
  async adminListTenants(orgId: string): Promise<AdminTenantResponse> {
    return this.adminGetTenant(orgId);
  }

  async adminRetryJob(jobId: string, data: { justification: string }): Promise<AdminRetryJobResponse> {
    return this.requestWithRetry<AdminRetryJobResponse>('POST', `/admin/retry-job/${jobId}`, data);
  }

  async adminRetryRenewalJob(jobId: string, justification: string): Promise<AdminRetryJobResponse> {
    return this.adminRetryJob(jobId, { justification });
  }

  // ── Activity Feed ──────────────────────────────────────────

  async getActivityFeed(orgId: string, params?: { action?: string; resourceType?: string; actorType?: string; cursor?: string; limit?: number }): Promise<ActivityFeedResponse> {
    const query = new URLSearchParams();
    if (params?.action) query.set('action', params.action);
    if (params?.resourceType) query.set('resource_type', params.resourceType);
    if (params?.actorType) query.set('actor_type', params.actorType);
    if (params?.cursor) query.set('cursor', params.cursor);
    if (params?.limit) query.set('limit', String(params.limit));
    const qs = query.toString();
    return this.requestWithRetry<ActivityFeedResponse>('GET', `/activity-feed${qs ? `?${qs}` : ''}`, undefined, orgId);
  }

  async listActivityFeed(orgId: string, params?: { action?: string; resourceType?: string; actorType?: string; cursor?: string; limit?: number }): Promise<ActivityFeedResponse> {
    return this.getActivityFeed(orgId, params);
  }

  // ── Experiments ────────────────────────────────────────────

  async adminListExperiments(): Promise<string[]> {
    const res = await this.requestWithRetry<{ experiments: string[] }>('GET', '/experiments');
    return res.experiments;
  }

  async adminGetExperiment(name: string): Promise<ExperimentAssignment[]> {
    const res = await this.requestWithRetry<{ experimentName: string; assignments: ExperimentAssignment[] }>('GET', `/experiments/${name}`);
    return res.assignments;
  }

  async adminCreateExperiment(name: string): Promise<{ status: string }> {
    return this.requestWithRetry<{ status: string }>('POST', '/experiments', { name });
  }

  async adminDeleteExperiment(name: string): Promise<{ message: string }> {
    return this.requestWithRetry<{ message: string }>('DELETE', `/experiments/${name}`);
  }

  async adminAssignExperiment(name: string, orgId: string, variant: string): Promise<ExperimentAssignment> {
    return this.requestWithRetry<ExperimentAssignment>('POST', `/experiments/${name}/assign`, { orgId, variant });
  }

  async adminGetVariant(name: string): Promise<{ experimentName: string; variant: string | null; assigned: boolean }> {
    return this.requestWithRetry<{ experimentName: string; variant: string | null; assigned: boolean }>('GET', `/experiments/${name}/variant`);
  }

  async listExperiments(): Promise<string[]> {
    return this.adminListExperiments();
  }

  async getExperiment(name: string): Promise<ExperimentAssignment[]> {
    return this.adminGetExperiment(name);
  }

  async assignExperiment(name: string, orgId: string, variant: string): Promise<ExperimentAssignment> {
    return this.adminAssignExperiment(name, orgId, variant);
  }

  async getExperimentVariant(name: string): Promise<{ experimentName: string; variant: string | null; assigned: boolean }> {
    return this.adminGetVariant(name);
  }

  // ── Async Operation Wrappers (spec 28) ──────────────────────

  /**
   * Fire an async operation and poll for its completion.
   *
   * Useful for async endpoints like renewal-job retries where the
   * operation completes asynchronously. Uses exponential backoff
   * polling with configurable interval and timeout.
   *
   * @typeParam T — The type of the result returned when the operation completes
   * @param fire — A function that initiates the operation and returns a reference ID
   * @param check — A function that checks if the operation is complete, returning the result or null
   * @param options.pollIntervalMs — Delay between polls (default: 2000, exponential backoff cap: 30000)
   * @param options.timeoutMs — Maximum time to wait in ms (default: 120000, 0 = no timeout)
   * @param options.signal — Optional AbortSignal to cancel polling
   * @returns The completed operation result
   * @throws {WalwatchNetworkError} If polling times out
   *
   * @example
   * ```typescript
   * const result = await client.fireAndPoll(
   *   () => client.retryRenewalJob(orgId, jobId),
   *   async () => {
   *     const job = await client.getRenewalJob(orgId, jobId);
   *     return job.status === 'succeeded' ? job : null;
   *   },
   *   { timeoutMs: 60000 },
   * );
   * ```
   */
  async fireAndPoll<T>(
    fire: () => Promise<unknown>,
    check: () => Promise<T | null>,
    options?: { pollIntervalMs?: number; timeoutMs?: number; signal?: AbortSignal },
  ): Promise<T> {
    const pollInterval = options?.pollIntervalMs ?? 2000;
    const timeoutMs = options?.timeoutMs ?? 120_000;
    const signal = options?.signal;

    // Fire the operation
    await fire();

    // Poll for completion
    const startTime = Date.now();
    let attempt = 0;
    for (;;) {
      if (signal?.aborted) {
        throw new WalwatchNetworkError('Polling aborted', 0);
      }

      if (timeoutMs > 0 && Date.now() - startTime > timeoutMs) {
        throw new WalwatchNetworkError(
          `Polling timed out after ${timeoutMs}ms`,
          0,
          'TIMEOUT',
          { timeoutMs, elapsedMs: Date.now() - startTime },
        );
      }

      const result = await check();
      if (result !== null) return result;

      // Exponential backoff with cap
      const delay = Math.min(pollInterval * Math.pow(1.5, attempt), 30000);
      await new Promise(resolve => setTimeout(resolve, delay));
      attempt++;
    }
  }

  /**
   * Fire an async operation and await its completion.
   *
   * A convenience wrapper around `fireAndPoll` for the common case
   * where the operation status is checked via a known polling endpoint.
   * Same guarantees as fireAndPoll — authoritative status from the API.
   *
   * @param fire — Function to initiate the operation
   * @param pollFn — Function that polls for completion (return truthy when done)
   * @param options — Optional polling configuration
   * @returns The final poll result
   *
   * @example
   * ```typescript
   * await client.fireAndAwait(
   *   () => client.retryRenewalJob(orgId, jobId),
   *   async () => {
   *     const job = await client.getRenewalJob(orgId, jobId);
   *     return job.status === 'succeeded' || job.status === 'failed_final' ? job : null;
   *   },
   * );
   * ```
   */
  async fireAndAwait<T>(
    fire: () => Promise<unknown>,
    pollFn: () => Promise<T | null>,
    options?: { pollIntervalMs?: number; timeoutMs?: number; signal?: AbortSignal },
  ): Promise<T> {
    return this.fireAndPoll(fire, pollFn, options);
  }
}
