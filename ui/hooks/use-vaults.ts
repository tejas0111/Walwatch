import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api-client'

export function useVault(orgId: string, vaultId: string) {
  return useQuery({
    queryKey: ['vault', orgId, vaultId],
    queryFn: () => api.getVault(vaultId),
    enabled: !!orgId && !!vaultId,
  })
}

export function useVaults(orgId: string) {
  return useQuery({
    queryKey: ['vaults', orgId],
    queryFn: () => api.listVaults(),
    enabled: !!orgId,
  })
}