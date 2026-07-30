import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'

export function useChannels(orgId: string) {
  return useQuery({
    queryKey: ['channels', orgId],
    queryFn: () => api.listChannels(),
    enabled: !!orgId,
  })
}

export function useAlertRules(orgId: string) {
  return useQuery({
    queryKey: ['alertRules', orgId],
    queryFn: () => api.listAlertRules(),
    enabled: !!orgId,
  })
}

export function useCreateChannel(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.createChannel(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['channels', orgId] }),
  })
}

export function useUpdateChannel(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => api.updateChannel(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['channels', orgId] }),
  })
}

export function useDeleteChannel(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteChannel(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['channels', orgId] }),
  })
}

export function useCreateAlertRule(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.createAlertRule(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['alertRules', orgId] }),
  })
}

export function useUpdateAlertRule(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => api.updateAlertRule(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['alertRules', orgId] }),
  })
}

export function useDeleteAlertRule(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteAlertRule(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['alertRules', orgId] }),
  })
}
