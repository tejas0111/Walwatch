import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'

export function useWalletDelegations(walletId: string) {
  return useQuery({
    queryKey: ['wallet-delegations', walletId],
    queryFn: () => api.listWalletDelegations(walletId),
    enabled: !!walletId,
  })
}

export function useCreateDelegation(walletId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.createDelegation(walletId, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['wallet-delegations', walletId] }),
  })
}

export function useRevokeDelegation(walletId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (delegationId: string) => api.revokeDelegation(walletId, delegationId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['wallet-delegations', walletId] }),
  })
}
