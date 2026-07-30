import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'

export function useBudgets(orgId: string) {
  return useQuery({
    queryKey: ['budgets', orgId],
    queryFn: () => api.listBudgets(),
    enabled: !!orgId,
  })
}

export function useCreateBudget(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.createBudget(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['budgets', orgId] }),
  })
}

export function useUpdateBudget(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Record<string, unknown>) =>
      api.updateBudget(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['budgets', orgId] }),
  })
}

export function useArchiveBudget(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.archiveBudget(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['budgets', orgId] }),
  })
}

export function useActivateBudget(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.activateBudget(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['budgets', orgId] }),
  })
}
