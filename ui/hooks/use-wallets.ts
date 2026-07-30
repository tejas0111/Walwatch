import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'

export function useWallets(orgId: string) {
  return useQuery({
    queryKey: ['wallets', orgId],
    queryFn: () => api.listWallets(),
    enabled: !!orgId,
  })
}

export function useCreateWallet(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.createWallet(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['wallets', orgId] }),
  })
}