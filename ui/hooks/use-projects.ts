import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'

export function useProjects(orgId: string) {
  return useQuery({
    queryKey: ['projects', orgId],
    queryFn: () => api.listProjects(),
    enabled: !!orgId,
  })
}

export function useCreateProject(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.createProject(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects', orgId] }),
  })
}

export function useUpdateProject(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Record<string, unknown>) =>
      api.updateProject(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects', orgId] }),
  })
}

export function useDeleteProject(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteProject(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects', orgId] }),
  })
}
