import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'

export function useBlobs(orgId: string, params?: Record<string, string>) {
  return useQuery({
    queryKey: ['blobs', orgId, params],
    queryFn: () => api.listBlobs(params ?? {}),
    enabled: !!orgId,
  })
}

export function useCreateBlob(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.createBlob(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['blobs', orgId] }),
  })
}

export function useUpdateBlob(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Record<string, unknown>) =>
      api.updateBlob(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['blobs', orgId] }),
  })
}

export function useDeleteBlob(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteBlob(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['blobs', orgId] }),
  })
}