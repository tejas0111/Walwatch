import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'

export function usePolicies(orgId: string) {
  return useQuery({
    queryKey: ['policies', orgId],
    queryFn: () => api.listPolicies(),
    enabled: !!orgId,
  })
}

export function useCreatePolicy(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.createPolicy(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['policies', orgId] }),
  })
}

export function useUpdatePolicy(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Record<string, unknown>) =>
      api.updatePolicy(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['policies', orgId] }),
  })
}

export function useDeletePolicy(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deletePolicy(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['policies', orgId] }),
  })
}
