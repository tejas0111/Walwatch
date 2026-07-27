'use client'

import { motion } from 'framer-motion'
import {
  Building2,
  Calendar,
  Database,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Breadcrumbs } from '@/components/ui/breadcrumbs'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { FormField, FormInput } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SkeletonCard } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { api, type Project } from '@/lib/api-client'
import { useAuth } from '@/lib/auth-provider'
import { useToast } from '@/lib/toast-context'
import { cn } from '@/lib/utils'

const envColors: Record<string, string> = {
  production: 'bg-accent/10 text-accent',
  staging: 'bg-chart-3/10 text-chart-3',
  development: 'bg-muted text-muted-foreground',
}

export default function ProjectsPage() {
  const { org } = useAuth()
  const { addToast } = useToast()

  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [editProject, setEditProject] = useState<Project | null>(null)
  const [deleteProject, setDeleteProject] = useState<Project | null>(null)
  const [saving, setSaving] = useState(false)

  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [description, setDescription] = useState('')
  const [environment, setEnvironment] = useState('development')

  const fetchProjects = useCallback(async () => {
    if (!org?.id) return
    try {
      const data = await api.listProjects(org.id)
      setProjects(data)
    } catch {
      addToast({ type: 'error', title: 'Failed to load projects' })
    } finally {
      setLoading(false)
    }
  }, [org?.id, addToast])

  useEffect(() => { fetchProjects() }, [fetchProjects])

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

  const handleCreate = async () => {
    if (!org?.id || !name.trim()) return
    setSaving(true)
    try {
      const project = await api.createProject(org.id, {
        name: name.trim(),
        slug: slug.trim() || name.trim().toLowerCase().replace(/\s+/g, '-'),
        description: description.trim() || undefined,
        environment,
      })
      setProjects((prev) => [...prev, project])
      setCreateOpen(false)
      resetForm()
      addToast({ type: 'success', title: 'Project created' })
    } catch {
      addToast({ type: 'error', title: 'Failed to create project' })
    } finally {
      setSaving(false)
    }
  }

  const handleEdit = async () => {
    if (!org?.id || !editProject || !name.trim()) return
    setSaving(true)
    try {
      const updated = await api.updateProject(org.id, editProject.id, {
        name: name.trim(),
        slug: slug.trim() || name.trim().toLowerCase().replace(/\s+/g, '-'),
        description: description.trim() || undefined,
        environment,
      })
      setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
      setEditProject(null)
      resetForm()
      addToast({ type: 'success', title: 'Project updated' })
    } catch {
      addToast({ type: 'error', title: 'Failed to update project' })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!org?.id || !deleteProject) return
    try {
      await api.deleteProject(org.id, deleteProject.id)
      setProjects((prev) => prev.filter((p) => p.id !== deleteProject.id))
      setDeleteProject(null)
      addToast({ type: 'success', title: 'Project deleted' })
    } catch {
      addToast({ type: 'error', title: 'Failed to delete project' })
    }
  }

  const openEdit = (p: Project) => {
    setName(p.name)
    setSlug(p.slug)
    setDescription('')
    setEnvironment(p.environment_labels?.[0] || 'development')
    setEditProject(p)
  }

  const openCreate = () => {
    resetForm()
    setCreateOpen(true)
  }

  return (
      <>
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
            <Plus size={16} aria-hidden="true" />
            New project
          </Button>
        </div>

        <label className="flex max-w-xs items-center gap-2 rounded-xl border border-input bg-card px-3 transition-colors focus-within:border-ring">
          <Search size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="sr-only">Search projects</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects by name or slug…"
            className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
            aria-label="Search projects"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          )}
        </label>

        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Building2}
            title={query ? 'No projects found' : 'No projects yet'}
            description={query ? 'No projects match your search.' : 'Create your first project to organise blobs.'}
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((p) => (
              <motion.div
                key={p.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="group rounded-2xl border border-border bg-card p-5 transition-all hover:border-primary/40 hover:shadow-sm hover:shadow-primary/5 sm:p-6"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <Building2 size={16} className="text-primary" aria-hidden="true" />
                    <h2 className="text-base font-semibold">{p.name}</h2>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="ghost" size="icon-xs" onClick={() => openEdit(p)}>
                      <Pencil size={13} />
                    </Button>
                    <Button variant="ghost" size="icon-xs" onClick={() => setDeleteProject(p)}>
                      <Trash2 size={13} />
                    </Button>
                  </div>
                </div>
                <p className="mt-1 font-mono text-[11px] text-muted-foreground">{p.slug}</p>

                <div className="mt-4 flex flex-wrap gap-1.5">
                  {(p.environment_labels?.length ? p.environment_labels : ['development']).map((env) => (
                    <span
                      key={env}
                      className={cn(
                        'rounded-md px-2 py-0.5 text-[11px] font-medium',
                        envColors[env] ?? 'bg-muted text-muted-foreground',
                      )}
                    >
                      {env}
                    </span>
                  ))}
                </div>

                <div className="mt-5 flex items-center justify-between border-t border-border pt-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <Database size={12} aria-hidden="true" />
                    {p.blob_count ?? 0} blobs
                  </span>
                </div>
              </motion.div>
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
                  <SelectItem value="development">Development</SelectItem>
                  <SelectItem value="staging">Staging</SelectItem>
                  <SelectItem value="production">Production</SelectItem>
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
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </>
  )
}