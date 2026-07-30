'use client'

import { Coins, Pencil, Plus, Search, Trash2 } from 'lucide-react'
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
import { type Budget } from '@/lib/api-client'
import { useAuth } from '@/lib/auth-provider'
import { useToast } from '@/lib/toast-context'
import { PageTransition } from '@/components/dashboard/page-transition'
import { useBudgets, useCreateBudget, useUpdateBudget, useArchiveBudget } from '@/hooks/use-budgets'

export default function BudgetsPage() {
  const { org } = useAuth()
  const { addToast } = useToast()

  const { data: budgets = [], isLoading, error, refetch } = useBudgets(org?.id ?? '')
  const createBudget = useCreateBudget(org?.id ?? '')
  const updateBudget = useUpdateBudget(org?.id ?? '')
  const archiveBudget = useArchiveBudget(org?.id ?? '')
  const [query, setQuery] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [editBudget, setEditBudget] = useState<Budget | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<Budget | null>(null)
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [period, setPeriod] = useState('monthly')
  const [projectId, setProjectId] = useState('')
  const [alertThreshold, setAlertThreshold] = useState('80')
  const [currency, setCurrency] = useState('usd')

  const filtered = budgets.filter((b) =>
    b.name.toLowerCase().includes(query.toLowerCase()),
  )

  const resetForm = () => {
    setName('')
    setAmount('')
    setPeriod('monthly')
    setProjectId('')
    setAlertThreshold('80')
    setCurrency('usd')
  }

  const handleCreate = () => {
    if (!name.trim() || !amount) return
    createBudget.mutate(
      {
        name: name.trim(),
        amount: parseInt(amount),
        period,
        projectId: projectId || undefined,
        alertThreshold: parseInt(alertThreshold) || 80,
        currency,
      },
      {
        onSuccess: () => {
          setCreateOpen(false)
          resetForm()
          addToast({ type: 'success', title: 'Budget created' })
        },
        onError: () => addToast({ type: 'error', title: 'Failed to create budget' }),
      },
    )
  }

  const handleEdit = () => {
    if (!editBudget || !name.trim() || !amount) return
    updateBudget.mutate(
      {
        id: editBudget.id,
        name: name.trim(),
        amount: parseInt(amount),
        period,
        alertThreshold: parseInt(alertThreshold) || 80,
      },
      {
        onSuccess: () => {
          setEditBudget(null)
          resetForm()
          addToast({ type: 'success', title: 'Budget updated' })
        },
        onError: () => addToast({ type: 'error', title: 'Failed to update budget' }),
      },
    )
  }

  const handleArchive = () => {
    if (!archiveTarget) return
    archiveBudget.mutate(archiveTarget.id, {
      onSuccess: () => {
        setArchiveTarget(null)
        addToast({ type: 'success', title: 'Budget archived' })
      },
      onError: () => addToast({ type: 'error', title: 'Failed to archive budget' }),
    })
  }

  const openEdit = (b: Budget) => {
    setName(b.name)
    setAmount(String(b.amount))
    setPeriod(b.period)
    setProjectId(b.projectId ?? '')
    setAlertThreshold(String(b.alertThreshold ?? 80))
    setCurrency(b.currency)
    setEditBudget(b)
  }

  const openCreate = () => {
    resetForm()
    setCreateOpen(true)
  }

  const saving = createBudget.isPending || updateBudget.isPending || archiveBudget.isPending

  const showArchived = (status: string) => status === 'archived'

  return (
    <PageTransition>
      <div className="flex flex-col gap-6">
      <Breadcrumbs items={[{ label: 'Budgets' }]} />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-primary">Cost management</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Budgets</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Set spending budgets to control renewal costs.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus data-icon="inline-start" />
          Create budget
        </Button>
      </div>

      <div className="relative flex max-w-xs items-center">
        <Search size={16} className="absolute left-3 text-muted-foreground" aria-hidden="true" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search budgets…"
          className="pl-9"
          aria-label="Search budgets"
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
          icon={Coins}
          title={query ? 'No budgets found' : 'No budgets yet'}
          description={query ? 'No budgets match your search.' : 'Create a budget to control renewal spending.'}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((b) => (
            <div
              key={b.id}
              className="group relative rounded-2xl border border-border bg-card p-5 transition-all hover:border-primary/40 hover:shadow-sm hover:shadow-primary/5 sm:p-6"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2.5">
                  <Coins size={16} className="text-primary" aria-hidden="true" />
                  <h2 className="text-base font-semibold">{b.name}</h2>
                </div>
                {!showArchived(b.status) && (
                  <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="ghost" size="icon-xs" onClick={() => openEdit(b)} aria-label="Edit budget">
                      <Pencil data-icon="inline-start" />
                    </Button>
                    <Button variant="ghost" size="icon-xs" onClick={() => setArchiveTarget(b)} aria-label="Archive budget">
                      <Trash2 data-icon="inline-start" />
                    </Button>
                  </div>
                )}
              </div>

              <div className="mt-4 space-y-2">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-semibold">${b.amount.toLocaleString()}</span>
                  <span className="text-xs text-muted-foreground">{b.period}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>Spent: ${b.spent.toLocaleString()}</span>
                  {b.alertThreshold && (
                    <>
                      <span className="text-muted-foreground/40">|</span>
                      <span>Alert at {b.alertThreshold}%</span>
                    </>
                  )}
                </div>
              </div>

              <div className="mt-5 flex items-center justify-between pt-4 text-xs text-muted-foreground">
                <Separator className="absolute inset-x-5 top-auto -translate-y-4" />
                <Badge variant={b.status === 'active' ? 'default' : b.status === 'archived' ? 'secondary' : 'outline'}>
                  {b.status.replace('_', ' ')}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>

    {/* Create / Edit Dialog */}
    <Dialog open={createOpen || !!editBudget} onOpenChange={(open) => {
      if (!open) {
        setCreateOpen(false)
        setEditBudget(null)
        resetForm()
      }
    }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editBudget ? 'Edit budget' : 'New budget'}</DialogTitle>
          <DialogDescription>
            {editBudget ? 'Update budget settings.' : 'Create a budget to control renewal spending.'}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <FormField label="Budget name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Monthly renewal budget"
            />
          </FormField>
          <FormField label="Amount">
            <Input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              min={0}
              placeholder="e.g. 1000"
            />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Period">
              <FormSelect value={period} onValueChange={(v) => setPeriod(v ?? 'monthly')}>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="quarterly">Quarterly</SelectItem>
                <SelectItem value="yearly">Yearly</SelectItem>
              </FormSelect>
            </FormField>
            <FormField label="Alert threshold (%)">
              <Input
                type="number"
                value={alertThreshold}
                onChange={(e) => setAlertThreshold(e.target.value)}
                min={1}
                max={100}
              />
            </FormField>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setCreateOpen(false); setEditBudget(null); resetForm() }}>
            Cancel
          </Button>
          <Button onClick={editBudget ? handleEdit : handleCreate} disabled={saving || !name.trim() || !amount}>
            {saving ? 'Saving…' : editBudget ? 'Save changes' : 'Create budget'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Archive Confirmation */}
    <AlertDialog open={!!archiveTarget} onOpenChange={(open) => { if (!open) setArchiveTarget(null) }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Archive budget</AlertDialogTitle>
          <AlertDialogDescription>
            This will archive &ldquo;{archiveTarget?.name}&rdquo;. Archived budgets are hidden from the default view.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleArchive} variant="destructive">
            Archive
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </PageTransition>
  )
}
