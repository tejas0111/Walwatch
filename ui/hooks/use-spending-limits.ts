import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'

export function useSpendingLimits(orgId: string) {
  return useQuery({
    queryKey: ['spending-limits', orgId],
    queryFn: () => api.listSpendingLimits(),
    enabled: !!orgId,
  })
}

export function useCreateSpendingLimit(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.createSpendingLimit(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['spending-limits', orgId] }),
  })
}

export function useUpdateSpendingLimit(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Record<string, unknown>) =>
      api.updateSpendingLimit(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['spending-limits', orgId] }),
  })
}

export function useDeleteSpendingLimit(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteSpendingLimit(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['spending-limits', orgId] }),
  })
}

export function useActivateSpendingLimit(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.activateSpendingLimit(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['spending-limits', orgId] }),
  })
}

export function usePauseSpendingLimit(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.pauseSpendingLimit(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['spending-limits', orgId] }),
  })
}
