'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { AlertCircle, Database, Plus, Search, Trash2, Archive, RotateCcw, LayoutGrid, TableIcon, X } from 'lucide-react'
import { useEffect, useState, useMemo } from 'react'

import { Breadcrumbs } from '@/components/ui/breadcrumbs'
import { EmptyState } from '@/components/ui/empty-state'
import { SkeletonTable } from '@/components/ui/skeleton'
import { Pagination } from '@/components/ui/pagination'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription,
  AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { PageTransition } from '@/components/dashboard/page-transition'
import { useAuth } from '@/lib/auth-provider'
import { useToast } from '@/lib/toast-context'
import { useBlobs, useCreateBlob, useDeleteBlob, useUpdateBlob } from '@/hooks/use-blobs'
import type { BlobRegistration } from '@/lib/api-client'
import { cn, formatBytes } from '@/lib/utils'

type BlobStatus = 'active' | 'expiring' | 'expired'

const PAGE_SIZE = 10

const statusColors: Record<string, string> = {
  active: 'bg-primary/10 text-primary',
  expiring: 'bg-amber-500/10 text-amber-500',
  expired: 'bg-destructive/10 text-destructive',
}

export default function BlobsPage() {
  const { org } = useAuth()
  const { addToast } = useToast()

  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<BlobStatus | 'all'>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [page, setPage] = useState(1)
  const [viewMode, setViewMode] = useState<'table' | 'card'>('table')

  const [addOpen, setAddOpen] = useState(false)
  const [addForm, setAddForm] = useState({ blob_id: '', name: '', project_id: '' })

  const [deleteTarget, setDeleteTarget] = useState<BlobRegistration | null>(null)
  const [bulkAction, setBulkAction] = useState<'archive' | 'activate' | 'delete' | null>(null)

  const params = useMemo(() => {
    const p: Record<string, string> = { limit: '100' }
    if (query) p.search = query
    if (statusFilter !== 'all') p.status = statusFilter
    return p
  }, [query, statusFilter])

  const { data: blobs = [], isLoading, error, refetch } = useBlobs(org?.id ?? '', params)
  const createBlob = useCreateBlob(org?.id ?? '')
  const deleteBlob = useDeleteBlob(org?.id ?? '')
  const updateBlob = useUpdateBlob(org?.id ?? '')

  useEffect(() => { setPage(1) }, [query, statusFilter])

  const totalPages = Math.max(1, Math.ceil(blobs.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const paged = blobs.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (selected.size === paged.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(paged.map((b) => b.id)))
    }
  }

  const handleAdd = async () => {
    if (!addForm.blob_id.trim()) return
    try {
      const data: Record<string, unknown> = { blobId: addForm.blob_id.trim() }
      if (addForm.name.trim()) data.name = addForm.name.trim()
      if (addForm.project_id.trim()) data.projectId = addForm.project_id.trim()
      await createBlob.mutateAsync(data)
      addToast({ type: 'success', title: 'Blob registered' })
      setAddOpen(false)
      setAddForm({ blob_id: '', name: '', project_id: '' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to register blob'
      addToast({ type: 'error', title: 'Failed to register blob', description: msg })
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await deleteBlob.mutateAsync(deleteTarget.id)
      addToast({ type: 'success', title: 'Blob deleted' })
      setDeleteTarget(null)
      setSelected((prev) => { const next = new Set(prev); next.delete(deleteTarget.id); return next })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to delete blob'
      addToast({ type: 'error', title: 'Failed to delete blob', description: msg })
    }
  }

  const handleBulkAction = async () => {
    if (!bulkAction || selected.size === 0) return
    try {
      const ids = Array.from(selected)
      if (bulkAction === 'delete') {
        await Promise.all(ids.map((id) => deleteBlob.mutateAsync(id)))
      } else if (bulkAction === 'archive') {
        await Promise.all(ids.map((id) => updateBlob.mutateAsync({ id, status: 'archived' })))
      } else if (bulkAction === 'activate') {
        await Promise.all(ids.map((id) => updateBlob.mutateAsync({ id, status: 'active' })))
      }
      addToast({ type: 'success', title: `${bulkAction === 'delete' ? 'Deleted' : bulkAction === 'archive' ? 'Archived' : 'Activated'} ${ids.length} blob(s)` })
      setSelected(new Set())
      setBulkAction(null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Bulk action failed'
      addToast({ type: 'error', title: 'Bulk action failed', description: msg })
    }
  }

  return (
    <PageTransition>
      <div className="flex flex-col gap-6">
      <Breadcrumbs items={[{ label: 'Blobs' }]} />

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-primary">Blob registry</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Blobs</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Browse and manage all registered blob storage items.
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <Plus data-icon="inline-start" />
          Add Blob
        </Button>
      </div>

      {/* Search + filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex max-w-xs flex-1 items-center">
          <Search size={16} className="absolute left-3 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search blobs by name…"
            className="pl-9"
          />
          {query && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setQuery('')}
              className="absolute right-3"
              aria-label="Clear search"
            >
              <X data-icon="inline-start" />
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <ToggleGroup value={[statusFilter]} onValueChange={(v) => v.length > 0 && setStatusFilter(v[0] as BlobStatus | 'all')}>
            <ToggleGroupItem value="all">All</ToggleGroupItem>
            <ToggleGroupItem value="active">Active</ToggleGroupItem>
            <ToggleGroupItem value="expiring">Expiring</ToggleGroupItem>
            <ToggleGroupItem value="expired">Expired</ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup value={[viewMode]} onValueChange={(v) => v.length > 0 && setViewMode(v[0] as 'table' | 'card')}>
            <ToggleGroupItem value="table" aria-label="Table view">
              <TableIcon size={14} />
            </ToggleGroupItem>
            <ToggleGroupItem value="card" aria-label="Card view">
              <LayoutGrid size={14} />
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      {/* Bulk actions */}
      <AnimatePresence>
        {selected.size > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5 text-sm">
              <span className="text-muted-foreground">{selected.size} selected</span>
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
                  Actions
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onClick={() => setBulkAction('archive')}>
                    <Archive size={14} /> Archive
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setBulkAction('activate')}>
                    <RotateCcw size={14} /> Activate
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={() => setBulkAction('delete')}>
                    <Trash2 size={14} /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setSelected(new Set())}>
                Clear selection
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Loading */}
      {isLoading && <SkeletonTable rows={5} />}

      {/* Error */}
      {!isLoading && error && (
        <div className="rounded-3xl border border-dashed border-destructive/30 bg-destructive/5 px-6 py-20 text-center" role="alert">
          <AlertCircle className="mx-auto text-destructive" size={32} />
          <h2 className="mt-5 font-semibold text-destructive">Failed to load blobs</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">{error instanceof Error ? error.message : 'Failed to load blobs'}</p>
          <Button variant="outline" className="mt-6" onClick={() => refetch()}>Retry</Button>
        </div>
      )}

      {/* Empty */}
      {!isLoading && !error && blobs.length === 0 && (
        <EmptyState
          icon={Database}
          title="No blobs registered"
          description="Register your first blob to start tracking renewals."
          action={{ label: 'Add Blob', onClick: () => setAddOpen(true) }}
        />
      )}

      {/* Table view */}
      {!isLoading && !error && blobs.length > 0 && viewMode === 'table' && (
        <>
          <div className="hidden overflow-hidden rounded-2xl border border-border bg-card sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="w-10 px-5 py-3">
                    <input
                      type="checkbox"
                      checked={selected.size === paged.length && paged.length > 0}
                      onChange={toggleAll}
                      className="size-4 rounded border-border accent-primary"
                    />
                  </th>
                  <th className="px-5 py-3 font-medium">Name</th>
                  <th className="px-5 py-3 font-medium">Blob ID</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Size</th>
                  <th className="px-5 py-3 font-medium">Created</th>
                  <th className="w-10 px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {paged.map((b) => (
                  <tr
                    key={b.id}
                    className={cn(
                      'border-b border-border text-sm transition-colors last:border-0 hover:bg-muted/30',
                      selected.has(b.id) && 'bg-primary/5',
                    )}
                  >
                    <td className="px-5 py-3.5">
                      <input
                        type="checkbox"
                        checked={selected.has(b.id)}
                        onChange={() => toggleSelect(b.id)}
                        className="size-4 rounded border-border accent-primary"
                      />
                    </td>
                    <td className="px-5 py-3.5 font-medium">{b.name || '—'}</td>
                    <td className="px-5 py-3.5 font-mono text-xs text-muted-foreground">
                      {b.blobId.length > 16 ? b.blobId.slice(0, 8) + '…' + b.blobId.slice(-6) : b.blobId}
                    </td>
                    <td className="px-5 py-3.5">
                      <Badge variant="outline" className={cn('capitalize', statusColors[b.status] ?? 'bg-muted text-muted-foreground')}>
                        {b.status}
                      </Badge>
                    </td>
                    <td className="px-5 py-3.5 text-muted-foreground">
                      {b.sizeBytes != null ? formatBytes(b.sizeBytes) : '—'}
                    </td>
                    <td className="px-5 py-3.5 text-muted-foreground">
                      {b.createdAt ? new Date(b.createdAt).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-5 py-3.5">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setDeleteTarget(b)}
                        aria-label={`Delete ${b.name || 'blob'}`}
                      >
                        <Trash2 data-icon="inline-start" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-3 sm:hidden">
            {paged.map((b) => (
              <div
                key={b.id}
                className={cn(
                  'rounded-2xl border border-border bg-card p-4 transition-colors',
                  selected.has(b.id) && 'border-primary/40 bg-primary/5',
                )}
              >
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={selected.has(b.id)}
                    onChange={() => toggleSelect(b.id)}
                    className="size-4 rounded border-border accent-primary"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{b.name || 'Unnamed blob'}</p>
                    <p className="font-mono text-[11px] text-muted-foreground">
                      {b.blobId.length > 16 ? b.blobId.slice(0, 8) + '…' + b.blobId.slice(-6) : b.blobId}
                    </p>
                  </div>
                  <Badge variant="outline" className={cn('shrink-0 capitalize', statusColors[b.status] ?? 'bg-muted text-muted-foreground')}>
                    {b.status}
                  </Badge>
                </div>
                <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                  <span>{b.sizeBytes != null ? formatBytes(b.sizeBytes) : '—'}</span>
                  <span>{b.createdAt ? new Date(b.createdAt).toLocaleDateString() : '—'}</span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setDeleteTarget(b)}
                    aria-label={`Delete ${b.name || 'blob'}`}
                  >
                    <Trash2 data-icon="inline-start" />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <Pagination
              page={safePage}
              totalPages={totalPages}
              totalItems={blobs.length}
              onPageChange={setPage}
            />
          )}
        </>
      )}

      {/* Card view */}
      {!isLoading && !error && blobs.length > 0 && viewMode === 'card' && (
        <>
          <div className="flex flex-col gap-3">
            {paged.map((b) => (
              <div
                key={b.id}
                className={cn(
                  'rounded-2xl border border-border bg-card p-4 transition-colors',
                  selected.has(b.id) && 'border-primary/40 bg-primary/5',
                )}
              >
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={selected.has(b.id)}
                    onChange={() => toggleSelect(b.id)}
                    className="size-4 rounded border-border accent-primary"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{b.name || 'Unnamed blob'}</p>
                    <p className="font-mono text-[11px] text-muted-foreground">
                      {b.blobId.length > 16 ? b.blobId.slice(0, 8) + '…' + b.blobId.slice(-6) : b.blobId}
                    </p>
                  </div>
                  <Badge variant="outline" className={cn('shrink-0 capitalize', statusColors[b.status] ?? 'bg-muted text-muted-foreground')}>
                    {b.status}
                  </Badge>
                </div>
                <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                  <span>{b.sizeBytes != null ? formatBytes(b.sizeBytes) : '—'}</span>
                  <span>{b.createdAt ? new Date(b.createdAt).toLocaleDateString() : '—'}</span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setDeleteTarget(b)}
                    aria-label={`Delete ${b.name || 'blob'}`}
                  >
                    <Trash2 data-icon="inline-start" />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <Pagination
              page={safePage}
              totalPages={totalPages}
              totalItems={blobs.length}
              onPageChange={setPage}
            />
          )}
        </>
      )}
    </div>

    {/* Add Blob Dialog */}
    <Dialog open={addOpen} onOpenChange={setAddOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Register Blob</DialogTitle>
          <DialogDescription>Add a new blob to track in your organization.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="add-blob-id" className="text-sm font-medium">Blob ID <span className="text-destructive">*</span></label>
            <Input
              id="add-blob-id"
              value={addForm.blob_id}
              onChange={(e) => setAddForm((f) => ({ ...f, blob_id: e.target.value }))}
              placeholder="e.g. 0x7a2f...91c3"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="add-blob-name" className="text-sm font-medium">Name</label>
            <Input
              id="add-blob-name"
              value={addForm.name}
              onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Optional friendly name"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="add-blob-project" className="text-sm font-medium">Project ID</label>
            <Input
              id="add-blob-project"
              value={addForm.project_id}
              onChange={(e) => setAddForm((f) => ({ ...f, project_id: e.target.value }))}
              placeholder="Optional project"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button onClick={handleAdd} disabled={createBlob.isPending || !addForm.blob_id.trim()}>
            {createBlob.isPending ? 'Registering…' : 'Register Blob'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Delete Confirmation */}
    <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete blob</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete &ldquo;{deleteTarget?.name || deleteTarget?.blobId}&rdquo;? This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={handleDelete} disabled={deleteBlob.isPending}>
            {deleteBlob.isPending ? 'Deleting…' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    {/* Bulk Delete Confirmation */}
    <AlertDialog open={bulkAction === 'delete'} onOpenChange={(open) => { if (!open) setBulkAction(null) }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {selected.size} blob(s)</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete {selected.size} selected blob(s)? This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={handleBulkAction} disabled={deleteBlob.isPending || updateBlob.isPending}>
            {deleteBlob.isPending || updateBlob.isPending ? 'Deleting…' : 'Delete all'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </PageTransition>
  )
}

