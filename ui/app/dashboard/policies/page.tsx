'use client'

import { motion } from 'framer-motion'
import {
  FileText,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Breadcrumbs } from '@/components/ui/breadcrumbs'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { SkeletonCard } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { api, type Policy } from '@/lib/api-client'
import { useAuth } from '@/lib/auth-provider'
import { useToast } from '@/lib/toast-context'
import { cn } from '@/lib/utils'

export default function PoliciesPage() {
  const { org } = useAuth()
  const { addToast } = useToast()

  const [policies, setPolicies] = useState<Policy[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [editPolicy, setEditPolicy] = useState<Policy | null>(null)
  const [deletePolicy, setDeletePolicy] = useState<Policy | null>(null)
  const [saving, setSaving] = useState(false)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [renewThreshold, setRenewThreshold] = useState('15')
  const [renewExtension, setRenewExtension] = useState('60')
  const [maxTotalEpochs, setMaxTotalEpochs] = useState('')

  const fetchPolicies = useCallback(async () => {
    if (!org?.id) return
    try {
      const data = await api.listPolicies(org.id)
      setPolicies(data)
    } catch {
      addToast({ type: 'error', title: 'Failed to load policies' })
    } finally {
      setLoading(false)
    }
  }, [org?.id, addToast])

  useEffect(() => { fetchPolicies() }, [fetchPolicies])

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

  const handleCreate = async () => {
    if (!org?.id || !name.trim()) return
    setSaving(true)
    try {
      const policy = await api.createPolicy(org.id, {
        name: name.trim(),
        description: description.trim() || undefined,
        renewThreshold: parseInt(renewThreshold) || 15,
        renewExtension: parseInt(renewExtension) || 60,
        maxTotalEpochs: maxTotalEpochs ? parseInt(maxTotalEpochs) : undefined,
      })
      setPolicies((prev) => [...prev, policy])
      setCreateOpen(false)
      resetForm()
      addToast({ type: 'success', title: 'Policy created' })
    } catch {
      addToast({ type: 'error', title: 'Failed to create policy' })
    } finally {
      setSaving(false)
    }
  }

  const handleEdit = async () => {
    if (!org?.id || !editPolicy || !name.trim()) return
    setSaving(true)
    try {
      const updated = await api.updatePolicy(org.id, editPolicy.id, {
        name: name.trim(),
        description: description.trim() || undefined,
        renewThreshold: parseInt(renewThreshold) || 15,
        renewExtension: parseInt(renewExtension) || 60,
      })
      setPolicies((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
      setEditPolicy(null)
      resetForm()
      addToast({ type: 'success', title: 'Policy updated' })
    } catch {
      addToast({ type: 'error', title: 'Failed to update policy' })
    } finally {
      setSaving(false)
    }
  }

  const handleToggleActive = async (policy: Policy) => {
    if (!org?.id) return
    try {
      const updated = await api.updatePolicy(org.id, policy.id, { active: !policy.active })
      setPolicies((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
      addToast({ type: 'success', title: `Policy ${updated.active ? 'activated' : 'deactivated'}` })
    } catch {
      addToast({ type: 'error', title: 'Failed to update policy' })
    }
  }

  const handleDelete = async () => {
    if (!org?.id || !deletePolicy) return
    try {
      await api.deletePolicy(org.id, deletePolicy.id)
      setPolicies((prev) => prev.filter((p) => p.id !== deletePolicy.id))
      setDeletePolicy(null)
      addToast({ type: 'success', title: 'Policy deleted' })
    } catch {
      addToast({ type: 'error', title: 'Failed to delete policy' })
    }
  }

  const openEdit = (p: Policy) => {
    setName(p.name)
    setDescription('')
    const rules = p.rules
    setRenewThreshold(String(rules?.renewThreshold ?? 15))
    setRenewExtension(String(rules?.renewExtension ?? 60))
    setMaxTotalEpochs(rules?.maxTotalEpochs ? String(rules.maxTotalEpochs) : '')
    setEditPolicy(p)
  }

  const openCreate = () => {
    resetForm()
    setCreateOpen(true)
  }

  const getRulesDisplay = (policy: Policy) => {
    const rules = policy.rules
    if (!rules) return []
    return [
      `Renew at ${rules.renewThreshold ?? '?'} epochs remaining`,
      `Extend by ${rules.renewExtension ?? '?'} epochs`,
      rules.maxTotalEpochs ? `Max ${rules.maxTotalEpochs} total epochs` : null,
    ].filter(Boolean) as string[]
  }

  return (
      <>
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
            <Plus size={16} aria-hidden="true" />
            Create policy
          </Button>
        </div>

        <label className="flex max-w-xs items-center gap-2 rounded-xl border border-input bg-card px-3 transition-colors focus-within:border-ring">
          <Search size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="sr-only">Search policies</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search policies…"
            className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
            aria-label="Search policies"
          />
        </label>

        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={query ? 'No policies found' : 'No policies yet'}
            description={query ? 'No policies match your search.' : 'Create a policy to automate blob renewals.'}
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((p) => (
              <motion.div
                key={p.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="group relative rounded-2xl border border-border bg-card p-5 transition-all hover:border-primary/40 hover:shadow-sm hover:shadow-primary/5 sm:p-6"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <FileText size={16} className="text-primary" aria-hidden="true" />
                    <h2 className="text-base font-semibold">{p.name}</h2>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleToggleActive(p)}
                      role="switch"
                      aria-checked={p.active}
                      aria-label={`${p.name}: ${p.active ? 'active' : 'inactive'}`}
                      className={cn(
                        'relative h-5 w-9 shrink-0 rounded-full transition-colors',
                        p.active ? 'bg-primary' : 'bg-muted',
                      )}
                    >
                      <span
                        className={cn(
                          'absolute top-0.5 size-4 rounded-full bg-background shadow-sm transition-all',
                          p.active ? 'left-[18px]' : 'left-0.5',
                        )}
                      />
                    </button>
                  </div>
                </div>

                <div className="mt-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button variant="ghost" size="icon-xs" onClick={() => openEdit(p)}>
                    <Pencil size={13} />
                  </Button>
                  <Button variant="ghost" size="icon-xs" onClick={() => setDeletePolicy(p)}>
                    <Trash2 size={13} />
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

                <div className="mt-5 flex items-center justify-between border-t border-border pt-4 text-xs text-muted-foreground">
                  <Badge variant={p.active ? 'default' : 'secondary'}>
                    {p.active ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
              </motion.div>
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
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </>
  )
}