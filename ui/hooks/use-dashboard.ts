import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api-client'

// Note: These hooks use orgId in query keys for cache isolation, but do not
// pass it to API methods. The API client reads the org from its internal state
// (set via api.setOrgId()) and sends it as the X-Org-Id header. Ensure
// api.setOrgId() is called before using these hooks.

export function useDashboardSummary(orgId: string) {
  return useQuery({
    queryKey: ['dashboard', 'summary', orgId],
    queryFn: () => api.getDashboardSummary(),
    enabled: !!orgId,
  })
}

export function useRecentBlobs(orgId: string, limit = 5) {
  return useQuery({
    queryKey: ['blobs', 'recent', orgId, limit],
    queryFn: () => api.listBlobs({ limit: String(limit) }),
    enabled: !!orgId,
  })
}