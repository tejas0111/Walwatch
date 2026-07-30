'use client'

import { Ban, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Breadcrumbs } from '@/components/ui/breadcrumbs'
import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/ui/error-state'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { FormField, FormSelect } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { SkeletonCard } from '@/components/ui/skeleton'
import { SelectItem } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { type SpendingLimit } from '@/lib/api-client'
import { useAuth } from '@/lib/auth-provider'
import { useToast } from '@/lib/toast-context'
import { PageTransition } from '@/components/dashboard/page-transition'
import { useSpendingLimits, useCreateSpendingLimit, useUpdateSpendingLimit, useDeleteSpendingLimit, useActivateSpendingLimit, usePauseSpendingLimit } from '@/hooks/use-spending-limits'

export default function SpendingLimitsPage() {
  const { org } = useAuth()
  const { addToast } = useToast()

  const { data: limits = [], isLoading, error, refetch } = useSpendingLimits(org?.id ?? '')
  const createLimit = useCreateSpendingLimit(org?.id ?? '')
  const updateLimit = useUpdateSpendingLimit(org?.id ?? '')
  const deleteLimit = useDeleteSpendingLimit(org?.id ?? '')
  const activateLimit = useActivateSpendingLimit(org?.id ?? '')
  const pauseLimit = usePauseSpendingLimit(org?.id ?? '')

  const [query, setQuery] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [editLimit, setEditLimit] = useState<SpendingLimit | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<SpendingLimit | null>(null)
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [scope, setScope] = useState('organization')
  const [scopeTargetId, setScopeTargetId] = useState('')
  const [period, setPeriod] = useState('daily')

  const filtered = limits.filter((l) =>
    (l.name ?? l.scope).toLowerCase().includes(query.toLowerCase()),
  )

  const resetForm = () => {
    setName('')
    setAmount('')
    setScope('organization')
    setScopeTargetId('')
    setPeriod('daily')
  }

  const handleCreate = () => {
    if (!amount) return
    createLimit.mutate(
      {
        name: name.trim() || undefined,
        amount: parseInt(amount),
        scope,
        scopeTargetId: scope === 'organization' ? org?.id : scopeTargetId,
        period,
      },
      {
        onSuccess: () => {
          setCreateOpen(false)
          resetForm()
          addToast({ type: 'success', title: 'Spending limit created' })
        },
        onError: () => addToast({ type: 'error', title: 'Failed to create spending limit' }),
      },
    )
  }

  const handleEdit = () => {
    if (!editLimit || !amount) return
    updateLimit.mutate(
      {
        id: editLimit.id,
        name: name.trim() || undefined,
        amount: parseInt(amount),
        period,
      },
      {
        onSuccess: () => {
          setEditLimit(null)
          resetForm()
          addToast({ type: 'success', title: 'Spending limit updated' })
        },
        onError: () => addToast({ type: 'error', title: 'Failed to update spending limit' }),
      },
    )
  }

  const handleToggleActive = (limit: SpendingLimit) => {
    if (limit.status === 'active') {
      pauseLimit.mutate(limit.id, {
        onSuccess: () => addToast({ type: 'success', title: 'Spending limit paused' }),
        onError: () => addToast({ type: 'error', title: 'Failed to pause spending limit' }),
      })
    } else if (limit.status === 'paused' || limit.status === 'defined') {
      activateLimit.mutate(limit.id, {
        onSuccess: () => addToast({ type: 'success', title: 'Spending limit activated' }),
        onError: () => addToast({ type: 'error', title: 'Failed to activate spending limit' }),
      })
    }
  }

  const handleDelete = () => {
    if (!deleteTarget) return
    deleteLimit.mutate(deleteTarget.id, {
      onSuccess: () => {
        setDeleteTarget(null)
        addToast({ type: 'success', title: 'Spending limit archived' })
      },
      onError: () => addToast({ type: 'error', title: 'Failed to archive spending limit' }),
    })
  }

  const openEdit = (l: SpendingLimit) => {
    setName(l.name ?? '')
    setAmount(String(l.amount))
    setScope(l.scope)
    setScopeTargetId(l.scopeTargetId)
    setPeriod(l.period)
    setEditLimit(l)
  }

  const openCreate = () => {
    resetForm()
    setCreateOpen(true)
  }

  const saving = createLimit.isPending || updateLimit.isPending || deleteLimit.isPending

  const statusToVariant = (status: string) => {
    switch (status) {
      case 'active': return 'default'
      case 'paused': return 'secondary'
      case 'archived': return 'outline'
      default: return 'outline'
    }
  }

  return (
    <PageTransition>
      <div className="flex flex-col gap-6">
      <Breadcrumbs items={[{ label: 'Spending Limits' }]} />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-primary">Cost management</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Spending Limits</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Enforce spending caps on wallets, projects, or policies.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus data-icon="inline-start" />
          Create limit
        </Button>
      </div>

      <div className="relative flex max-w-xs items-center">
        <Search size={16} className="absolute left-3 text-muted-foreground" aria-hidden="true" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search limits…"
          className="pl-9"
          aria-label="Search limits"
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
          icon={Ban}
          title={query ? 'No spending limits found' : 'No spending limits yet'}
          description={query ? 'No limits match your search.' : 'Create a spending limit to control costs.'}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((l) => (
            <div
              key={l.id}
              className="group relative rounded-2xl border border-border bg-card p-5 transition-all hover:border-primary/40 hover:shadow-sm hover:shadow-primary/5 sm:p-6"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2.5">
                  <Ban size={16} className="text-primary" aria-hidden="true" />
                  <h2 className="text-base font-semibold">{l.name ?? l.scope}</h2>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={l.status === 'active'}
                    onCheckedChange={() => handleToggleActive(l)}
                    aria-label={`${l.name ?? l.scope}: ${l.status}`}
                  />
                </div>
              </div>

              <div className="mt-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button variant="ghost" size="icon-xs" onClick={() => openEdit(l)} aria-label="Edit spending limit">
                  <Pencil data-icon="inline-start" />
                </Button>
                <Button variant="ghost" size="icon-xs" onClick={() => setDeleteTarget(l)} aria-label="Archive spending limit">
                  <Trash2 data-icon="inline-start" />
                </Button>
              </div>

              <div className="mt-4 space-y-2">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-semibold">${l.amount.toLocaleString()}</span>
                  <span className="text-xs text-muted-foreground">{l.period}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>Scope: {l.scope}</span>
                  <span className="text-muted-foreground/40">|</span>
                  <span>Spent: ${l.spent.toLocaleString()}</span>
                </div>
              </div>

              <div className="mt-5 flex items-center justify-between pt-4 text-xs text-muted-foreground">
                <Separator className="absolute inset-x-5 top-auto -translate-y-4" />
                <Badge variant={statusToVariant(l.status)}>
                  {l.status}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>

    {/* Create / Edit Dialog */}
    <Dialog open={createOpen || !!editLimit} onOpenChange={(open) => {
      if (!open) {
        setCreateOpen(false)
        setEditLimit(null)
        resetForm()
      }
    }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editLimit ? 'Edit spending limit' : 'New spending limit'}</DialogTitle>
          <DialogDescription>
            {editLimit ? 'Update spending limit settings.' : 'Create a limit to enforce spending caps.'}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <FormField label="Name (optional)">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Monthly wallet cap"
            />
          </FormField>
          <FormField label="Amount">
            <Input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              min={0}
              placeholder="e.g. 500"
            />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Scope">
              <FormSelect value={scope} onValueChange={(v) => setScope(v ?? 'organization')}>
                <SelectItem value="organization">Organization</SelectItem>
                <SelectItem value="project">Project</SelectItem>
                <SelectItem value="wallet">Wallet</SelectItem>
                <SelectItem value="policy">Policy</SelectItem>
              </FormSelect>
            </FormField>
            <FormField label="Period">
              <FormSelect value={period} onValueChange={(v) => setPeriod(v ?? 'daily')}>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </FormSelect>
            </FormField>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setCreateOpen(false); setEditLimit(null); resetForm() }}>
            Cancel
          </Button>
          <Button onClick={editLimit ? handleEdit : handleCreate} disabled={saving || !amount}>
            {saving ? 'Saving…' : editLimit ? 'Save changes' : 'Create limit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Delete Confirmation */}
    <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Archive spending limit</AlertDialogTitle>
          <AlertDialogDescription>
            This will archive &ldquo;{deleteTarget?.name ?? deleteTarget?.scope}&rdquo;. This action can be reversed by reactivating.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleDelete} variant="destructive">
            Archive
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </PageTransition>
  )
}
