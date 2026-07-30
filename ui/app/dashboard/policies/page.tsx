'use client'

import { FileText, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Breadcrumbs } from '@/components/ui/breadcrumbs'
import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/ui/error-state'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { SkeletonCard } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { type Policy } from '@/lib/api-client'
import { useAuth } from '@/lib/auth-provider'
import { useToast } from '@/lib/toast-context'
import { cn } from '@/lib/utils'
import { PageTransition } from '@/components/dashboard/page-transition'
import { usePolicies, useCreatePolicy, useUpdatePolicy, useDeletePolicy } from '@/hooks/use-policies'

export default function PoliciesPage() {
  const { org } = useAuth()
  const { addToast } = useToast()

  const { data: policies = [], isLoading, error, refetch } = usePolicies(org?.id ?? '')
  const createPolicy = useCreatePolicy(org?.id ?? '')
  const updatePolicy = useUpdatePolicy(org?.id ?? '')
  const deletePolicyMutation = useDeletePolicy(org?.id ?? '')

  const [query, setQuery] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [editPolicy, setEditPolicy] = useState<Policy | null>(null)
  const [deletePolicy, setDeletePolicy] = useState<Policy | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [renewThreshold, setRenewThreshold] = useState('15')
  const [renewExtension, setRenewExtension] = useState('60')
  const [maxTotalEpochs, setMaxTotalEpochs] = useState('')

  const filtered = policies.filter((p) =>
    p.name.toLowerCase().includes(query.toLowerCase()),
  )

  const resetForm = () => {
    setName('')
    setDescription('')
    setRenewThreshold('15')
    setRenewExtension('60')
    setMaxTotalEpochs('')
  }

  const handleCreate = () => {
    if (!name.trim()) return
    createPolicy.mutate(
      {
        name: name.trim(),
        description: description.trim() || undefined,
        renewThreshold: parseInt(renewThreshold) || 15,
        renewExtension: parseInt(renewExtension) || 60,
        maxTotalEpochs: maxTotalEpochs ? parseInt(maxTotalEpochs) : undefined,
      },
      {
        onSuccess: () => {
          setCreateOpen(false)
          resetForm()
          addToast({ type: 'success', title: 'Policy created' })
        },
        onError: () => addToast({ type: 'error', title: 'Failed to create policy' }),
      },
    )
  }

  const handleEdit = () => {
    if (!editPolicy || !name.trim()) return
    updatePolicy.mutate(
      {
        id: editPolicy.id,
        name: name.trim(),
        description: description.trim() || undefined,
        renewThreshold: parseInt(renewThreshold) || 15,
        renewExtension: parseInt(renewExtension) || 60,
      },
      {
        onSuccess: () => {
          setEditPolicy(null)
          resetForm()
          addToast({ type: 'success', title: 'Policy updated' })
        },
        onError: () => addToast({ type: 'error', title: 'Failed to update policy' }),
      },
    )
  }

  const handleToggleActive = (policy: Policy) => {
    updatePolicy.mutate(
      { id: policy.id, active: !policy.active },
      {
        onSuccess: () => addToast({ type: 'success', title: `Policy ${!policy.active ? 'activated' : 'deactivated'}` }),
        onError: () => addToast({ type: 'error', title: 'Failed to update policy' }),
      },
    )
  }

  const handleDelete = () => {
    if (!deletePolicy) return
    deletePolicyMutation.mutate(deletePolicy.id, {
      onSuccess: () => {
        setDeletePolicy(null)
        addToast({ type: 'success', title: 'Policy deleted' })
      },
      onError: () => addToast({ type: 'error', title: 'Failed to delete policy' }),
    })
  }

  const openEdit = (p: Policy) => {
    setName(p.name)
    setDescription(p.description ?? '')
    setRenewThreshold(String(p.renewThreshold ?? 15))
    setRenewExtension(String(p.renewExtension ?? 60))
    setMaxTotalEpochs(p.maxTotalEpochs ? String(p.maxTotalEpochs) : '')
    setEditPolicy(p)
  }

  const openCreate = () => {
    resetForm()
    setCreateOpen(true)
  }

  const getRulesDisplay = (policy: Policy) => {
    return [
      `Renew at ${policy.renewThreshold ?? '?'} epochs remaining`,
      `Extend by ${policy.renewExtension ?? '?'} epochs`,
      policy.maxTotalEpochs ? `Max ${policy.maxTotalEpochs} total epochs` : null,
    ].filter(Boolean) as string[]
  }

  const saving = createPolicy.isPending || updatePolicy.isPending || deletePolicyMutation.isPending

  return (
    <PageTransition>
      <div className="flex flex-col gap-6">
      <Breadcrumbs items={[{ label: 'Policies' }]} />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-primary">Policy engine</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Policies</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Define renewal rules that keepers follow for your blobs.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus data-icon="inline-start" />
          Create policy
        </Button>
      </div>

      <div className="relative flex max-w-xs items-center">
        <Search size={16} className="absolute left-3 text-muted-foreground" aria-hidden="true" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search policies…"
          className="pl-9"
          aria-label="Search policies"
        />
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : error ? (
        <ErrorState message={error?.message ?? 'Something went wrong'} onRetry={refetch} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={query ? 'No policies found' : 'No policies yet'}
          description={query ? 'No policies match your search.' : 'Create a policy to automate blob renewals.'}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => (
            <div
              key={p.id}
              className="group relative rounded-2xl border border-border bg-card p-5 transition-all hover:border-primary/40 hover:shadow-sm hover:shadow-primary/5 sm:p-6"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2.5">
                  <FileText size={16} className="text-primary" aria-hidden="true" />
                  <h2 className="text-base font-semibold">{p.name}</h2>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={p.active}
                    onCheckedChange={() => handleToggleActive(p)}
                    aria-label={`${p.name}: ${p.active ? 'active' : 'inactive'}`}
                  />
                </div>
              </div>

              <div className="mt-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button variant="ghost" size="icon-xs" onClick={() => openEdit(p)} aria-label="Edit policy">
                  <Pencil data-icon="inline-start" />
                </Button>
                <Button variant="ghost" size="icon-xs" onClick={() => setDeletePolicy(p)} aria-label="Delete policy">
                  <Trash2 data-icon="inline-start" />
                </Button>
              </div>

              <div className="mt-4 space-y-2">
                {getRulesDisplay(p).map((rule, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-primary/40" aria-hidden="true" />
                    {rule}
                  </div>
                ))}
              </div>

              <div className="mt-5 flex items-center justify-between pt-4 text-xs text-muted-foreground">
                <Separator className="absolute inset-x-5 top-auto -translate-y-4" />
                <Badge variant={p.active ? 'default' : 'secondary'}>
                  {p.active ? 'Active' : 'Inactive'}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>

    {/* Create / Edit Dialog */}
    <Dialog open={createOpen || !!editPolicy} onOpenChange={(open) => {
      if (!open) {
        setCreateOpen(false)
        setEditPolicy(null)
        resetForm()
      }
    }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editPolicy ? 'Edit policy' : 'New policy'}</DialogTitle>
          <DialogDescription>
            {editPolicy ? 'Update renewal policy settings.' : 'Create a policy to automate blob renewals.'}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <FormField label="Policy name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Standard renewal"
            />
          </FormField>
          <FormField label="Description">
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
              rows={2}
            />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Renew threshold (epochs)">
              <Input
                type="number"
                value={renewThreshold}
                onChange={(e) => setRenewThreshold(e.target.value)}
                min={1}
              />
            </FormField>
            <FormField label="Renew extension (epochs)">
              <Input
                type="number"
                value={renewExtension}
                onChange={(e) => setRenewExtension(e.target.value)}
                min={1}
              />
            </FormField>
          </div>
          <FormField label="Max total epochs (optional)">
            <Input
              type="number"
              value={maxTotalEpochs}
              onChange={(e) => setMaxTotalEpochs(e.target.value)}
              placeholder="Unlimited"
              min={1}
            />
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setCreateOpen(false); setEditPolicy(null); resetForm() }}>
            Cancel
          </Button>
          <Button onClick={editPolicy ? handleEdit : handleCreate} disabled={saving || !name.trim()}>
            {saving ? 'Saving…' : editPolicy ? 'Save changes' : 'Create policy'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Delete Confirmation */}
    <AlertDialog open={!!deletePolicy} onOpenChange={(open) => { if (!open) setDeletePolicy(null) }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete policy</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete &ldquo;{deletePolicy?.name}&rdquo;. This action cannot be undone.
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
