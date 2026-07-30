'use client'

import { Building2, Database, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { useState } from 'react'

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Breadcrumbs } from '@/components/ui/breadcrumbs'
import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/ui/error-state'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { SkeletonCard } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { type Project } from '@/lib/api-client'
import { useAuth } from '@/lib/auth-provider'
import { useToast } from '@/lib/toast-context'
import { cn } from '@/lib/utils'
import { PageTransition } from '@/components/dashboard/page-transition'
import { useProjects, useCreateProject, useUpdateProject, useDeleteProject } from '@/hooks/use-projects'

const envColors: Record<string, string> = {
  production: 'bg-accent/10 text-accent',
  staging: 'bg-chart-3/10 text-chart-3',
  development: 'bg-muted text-muted-foreground',
}

export default function ProjectsPage() {
  const { org } = useAuth()
  const { addToast } = useToast()

  const { data: projects = [], isLoading, error, refetch } = useProjects(org?.id ?? '')
  const createProject = useCreateProject(org?.id ?? '')
  const updateProject = useUpdateProject(org?.id ?? '')
  const deleteProjectMutation = useDeleteProject(org?.id ?? '')

  const [query, setQuery] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [editProject, setEditProject] = useState<Project | null>(null)
  const [deleteProject, setDeleteProject] = useState<Project | null>(null)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [description, setDescription] = useState('')
  const [environment, setEnvironment] = useState('development')

  const filtered = projects.filter(
    (p) =>
      p.name.toLowerCase().includes(query.toLowerCase()) ||
      p.slug.toLowerCase().includes(query.toLowerCase()),
  )

  const resetForm = () => {
    setName('')
    setSlug('')
    setDescription('')
    setEnvironment('development')
  }

  const handleCreate = () => {
    if (!name.trim()) return
    createProject.mutate(
      {
        name: name.trim(),
        slug: slug.trim() || name.trim().toLowerCase().replace(/\s+/g, '-'),
        description: description.trim() || undefined,
        environment,
      },
      {
        onSuccess: () => {
          setCreateOpen(false)
          resetForm()
          addToast({ type: 'success', title: 'Project created' })
        },
        onError: () => addToast({ type: 'error', title: 'Failed to create project' }),
      },
    )
  }

  const handleEdit = () => {
    if (!editProject || !name.trim()) return
    updateProject.mutate(
      {
        id: editProject.id,
        name: name.trim(),
        slug: slug.trim() || name.trim().toLowerCase().replace(/\s+/g, '-'),
        description: description.trim() || undefined,
        environment,
      },
      {
        onSuccess: () => {
          setEditProject(null)
          resetForm()
          addToast({ type: 'success', title: 'Project updated' })
        },
        onError: () => addToast({ type: 'error', title: 'Failed to update project' }),
      },
    )
  }

  const handleDelete = () => {
    if (!deleteProject) return
    deleteProjectMutation.mutate(deleteProject.id, {
      onSuccess: () => {
        setDeleteProject(null)
        addToast({ type: 'success', title: 'Project deleted' })
      },
      onError: () => addToast({ type: 'error', title: 'Failed to delete project' }),
    })
  }

  const openEdit = (p: Project) => {
    setName(p.name)
    setSlug(p.slug)
    setDescription('')
    setEnvironment(p.environment || 'development')
    setEditProject(p)
  }

  const openCreate = () => {
    resetForm()
    setCreateOpen(true)
  }

  const saving = createProject.isPending || updateProject.isPending || deleteProjectMutation.isPending

  return (
    <PageTransition>
      <div className="flex flex-col gap-6">
      <Breadcrumbs items={[{ label: 'Projects' }]} />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-primary">Project management</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Projects</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Organise your blobs into projects with environment labels.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus data-icon="inline-start" />
          New project
        </Button>
      </div>

      <div className="relative flex max-w-xs items-center">
        <Search size={16} className="absolute left-3 text-muted-foreground" aria-hidden="true" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search projects by name or slug…"
          className="pl-9"
          aria-label="Search projects"
        />
        {query && (
          <Button variant="ghost" size="icon-xs" onClick={() => setQuery('')} aria-label="Clear search">
            <X />
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : error ? (
        <ErrorState message={error?.message ?? 'Something went wrong'} onRetry={refetch} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Building2}
          title={query ? 'No projects found' : 'No projects yet'}
          description={query ? 'No projects match your search.' : 'Create your first project to organise blobs.'}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => (
            <div
              key={p.id}
              className="group rounded-2xl border border-border bg-card p-5 transition-all hover:border-primary/40 hover:shadow-sm hover:shadow-primary/5 sm:p-6"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2.5">
                  <Building2 size={16} className="text-primary" aria-hidden="true" />
                  <h2 className="text-base font-semibold">{p.name}</h2>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button variant="ghost" size="icon-xs" onClick={() => openEdit(p)} aria-label="Edit project">
                    <Pencil data-icon="inline-start" />
                  </Button>
                  <Button variant="ghost" size="icon-xs" onClick={() => setDeleteProject(p)} aria-label="Delete project">
                    <Trash2 data-icon="inline-start" />
                  </Button>
                </div>
              </div>
              <p className="mt-1 font-mono text-[11px] text-muted-foreground">{p.slug}</p>

              <div className="mt-4 flex flex-wrap gap-1.5">
                <span
                  className={cn(
                    'rounded-md px-2 py-0.5 text-[11px] font-medium',
                    envColors[p.environment ?? ''] ?? 'bg-muted text-muted-foreground',
                  )}
                >
                  {p.environment || 'development'}
                </span>
              </div>

              <div className="mt-5 flex items-center justify-between pt-4 text-xs text-muted-foreground">
                <Separator className="absolute inset-x-5 top-auto -translate-y-4" />
                <span className="flex items-center gap-1.5">
                  <Database size={12} aria-hidden="true" />
                  {p.blobCount ?? 0} blobs
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>

    {/* Create / Edit Dialog */}
    <Dialog open={createOpen || !!editProject} onOpenChange={(open) => {
      if (!open) {
        setCreateOpen(false)
        setEditProject(null)
        resetForm()
      }
    }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editProject ? 'Edit project' : 'New project'}</DialogTitle>
          <DialogDescription>
            {editProject ? 'Update your project details.' : 'Create a project to organise your blobs.'}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <FormField label="Project name">
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                if (!editProject) setSlug(e.target.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''))
              }}
              placeholder="e.g. Main Website"
            />
          </FormField>
          <FormField label="Slug">
            <Input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="e.g. main-website"
            />
          </FormField>
          <FormField label="Description">
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
              rows={3}
            />
          </FormField>
          <FormField label="Environment">
            <Select value={environment} onValueChange={(v) => v && setEnvironment(v)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="development">Development</SelectItem>
                  <SelectItem value="staging">Staging</SelectItem>
                  <SelectItem value="production">Production</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setCreateOpen(false); setEditProject(null); resetForm() }}>
            Cancel
          </Button>
          <Button onClick={editProject ? handleEdit : handleCreate} disabled={saving || !name.trim()}>
            {saving ? 'Saving…' : editProject ? 'Save changes' : 'Create project'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Delete Confirmation */}
    <AlertDialog open={!!deleteProject} onOpenChange={(open) => { if (!open) setDeleteProject(null) }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete project</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete &ldquo;{deleteProject?.name}&rdquo;. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleDelete} variant="destructive">
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </PageTransition>
  )
}
