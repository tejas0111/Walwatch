import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api-client'

export function useAnalytics(orgId: string) {
  return useQuery({
    queryKey: ['analytics', orgId],
    queryFn: () => api.getAnalytics(),
    enabled: !!orgId,
  })
}
