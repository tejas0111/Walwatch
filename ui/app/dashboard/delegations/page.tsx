'use client'

import { Handshake, Plus, Search, XCircle } from 'lucide-react'
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
import { SelectItem } from '@/components/ui/select'
import { SkeletonCard } from '@/components/ui/skeleton'
import { type Delegation } from '@/lib/api-client'
import { useAuth } from '@/lib/auth-provider'
import { useToast } from '@/lib/toast-context'
import { PageTransition } from '@/components/dashboard/page-transition'
import { useWallets } from '@/hooks/use-wallets'
import { useWalletDelegations, useCreateDelegation, useRevokeDelegation } from '@/hooks/use-delegations'
import { cn } from '@/lib/utils'

export default function DelegationsPage() {
  const { org } = useAuth()
  const { addToast } = useToast()

  const { data: wallets, isLoading: walletsLoading, error: walletsError, refetch: refetchWallets } = useWallets(org?.id ?? '')

  const [selectedWalletId, setSelectedWalletId] = useState<string>('')

  const firstWalletId = wallets?.[0]?.id
  const effectiveWalletId = selectedWalletId || firstWalletId || ''

  const { data: delegations = [], isLoading: delegationsLoading, error: delegationsError, refetch: refetchDelegations } = useWalletDelegations(effectiveWalletId)

  const createDelegation = useCreateDelegation(effectiveWalletId)
  const revokeDelegation = useRevokeDelegation(effectiveWalletId)

  const [query, setQuery] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [revokeTarget, setRevokeTarget] = useState<Delegation | null>(null)
  const [delegateAddress, setDelegateAddress] = useState('')
  const [scope, setScope] = useState('all')
  const [scopeTargets, setScopeTargets] = useState('')
  const [spendCeiling, setSpendCeiling] = useState('')
  const [timeBoundEnd, setTimeBoundEnd] = useState('')

  const filtered = delegations.filter((d) =>
    d.delegateAddress.toLowerCase().includes(query.toLowerCase()),
  )

  const resetForm = () => {
    setDelegateAddress('')
    setScope('all')
    setScopeTargets('')
    setSpendCeiling('')
    setTimeBoundEnd('')
  }

  const handleCreate = () => {
    if (!delegateAddress.trim()) return
    const data: Record<string, unknown> = {
      delegateAddress: delegateAddress.trim(),
      scope,
    }
    if (scopeTargets.trim()) {
      data.scopeTargets = scopeTargets.split(',').map((s) => s.trim()).filter(Boolean)
    }
    if (spendCeiling.trim()) data.spendCeiling = spendCeiling.trim()
    if (timeBoundEnd.trim()) data.timeBoundEnd = new Date(timeBoundEnd).toISOString()

    createDelegation.mutate(data, {
      onSuccess: () => {
        setCreateOpen(false)
        resetForm()
        addToast({ type: 'success', title: 'Delegation created' })
      },
      onError: () => addToast({ type: 'error', title: 'Failed to create delegation' }),
    })
  }

  const handleRevoke = () => {
    if (!revokeTarget) return
    revokeDelegation.mutate(revokeTarget.id, {
      onSuccess: () => {
        setRevokeTarget(null)
        addToast({ type: 'success', title: 'Delegation revoked' })
      },
      onError: () => addToast({ type: 'error', title: 'Failed to revoke delegation' }),
    })
  }

  const saving = createDelegation.isPending || revokeDelegation.isPending

  const isLoading = walletsLoading || (effectiveWalletId ? delegationsLoading : false)
  const currentError = walletsError || delegationsError

  const selectedWallet = wallets?.find((w) => w.id === effectiveWalletId)

  const formatAddress = (addr: string) =>
    addr.length > 16 ? `${addr.slice(0, 8)}...${addr.slice(-6)}` : addr

  return (
    <PageTransition>
      <div className="flex flex-col gap-6">
      <Breadcrumbs items={[{ label: 'Delegations' }]} />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-primary">Wallet authority</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Delegations</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Grant delegated signing authority to other addresses.
          </p>
        </div>
        {effectiveWalletId && (
          <Button onClick={() => { resetForm(); setCreateOpen(true) }}>
            <Plus data-icon="inline-start" />
            Create delegation
          </Button>
        )}
      </div>

      {/* Wallet selector */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm font-medium text-muted-foreground">Wallet:</label>
        <div className="flex flex-wrap gap-2">
          {wallets?.map((w) => (
            <button
              key={w.id}
              onClick={() => setSelectedWalletId(w.id)}
              className={cn(
                'rounded-lg border px-3 py-1.5 text-sm transition-colors',
                effectiveWalletId === w.id
                  ? 'border-primary bg-primary/10 text-foreground font-medium'
                  : 'border-border text-muted-foreground hover:border-foreground/30',
              )}
            >
              {w.label}
            </button>
          ))}
        </div>
        <div className="relative ml-auto flex max-w-xs items-center">
          <Search size={16} className="absolute left-3 text-muted-foreground" aria-hidden="true" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by address…"
            className="pl-9"
            aria-label="Search delegations"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : currentError ? (
        <ErrorState message={currentError?.message ?? 'Something went wrong'} onRetry={() => { refetchWallets(); refetchDelegations() }} />
      ) : !wallets?.length ? (
        <EmptyState
          icon={Handshake}
          title="No wallets yet"
          description="Create a wallet first to manage delegations."
        />
      ) : !effectiveWalletId ? (
        <EmptyState
          icon={Handshake}
          title="Select a wallet"
          description="Choose a wallet above to view its delegations."
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Handshake}
          title={query ? 'No delegations found' : 'No delegations yet'}
          description={query ? 'No delegations match your search.' : 'Create a delegation to grant signing authority.'}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((d) => (
            <div
              key={d.id}
              className="group relative rounded-2xl border border-border bg-card p-5 transition-all hover:border-primary/40 hover:shadow-sm hover:shadow-primary/5 sm:p-6"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2.5">
                  <Handshake size={16} className="text-primary" aria-hidden="true" />
                  <h2 className="text-sm font-mono font-semibold">{formatAddress(d.delegateAddress)}</h2>
                </div>
                {!d.isRevoked && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => setRevokeTarget(d)}
                    aria-label="Revoke delegation"
                  >
                    <XCircle data-icon="inline-start" className="text-destructive" />
                  </Button>
                )}
              </div>

              <div className="mt-4 space-y-2 text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">Scope:</span>
                  <span>{d.scope}</span>
                </div>
                {d.scopeTargets && d.scopeTargets.length > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">Targets:</span>
                    <span>{d.scopeTargets.join(', ')}</span>
                  </div>
                )}
                {d.spendCeiling && d.spendCeiling !== '0' && (
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">Ceiling:</span>
                    <span>{d.spendCeiling}</span>
                  </div>
                )}
                {d.timeBoundEnd && (
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">Expires:</span>
                    <span>{new Date(d.timeBoundEnd).toLocaleDateString()}</span>
                  </div>
                )}
              </div>

              <div className="mt-5 flex items-center justify-between pt-4 text-xs text-muted-foreground">
                <Badge variant={d.isRevoked ? 'secondary' : 'default'}>
                  {d.isRevoked ? 'Revoked' : 'Active'}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>

    {/* Create Dialog */}
    <Dialog open={createOpen} onOpenChange={(open) => { if (!open) { setCreateOpen(false); resetForm() } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New delegation</DialogTitle>
          <DialogDescription>
            Grant signing authority for {selectedWallet?.label ?? 'wallet'}.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <FormField label="Delegate address">
            <Input
              value={delegateAddress}
              onChange={(e) => setDelegateAddress(e.target.value)}
              placeholder="0x..."
              className="font-mono text-xs"
            />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Scope">
              <FormSelect value={scope} onValueChange={(v) => setScope(v ?? 'all')}>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="blob_ids">Blob IDs</SelectItem>
                <SelectItem value="policy">Policy</SelectItem>
              </FormSelect>
            </FormField>
            <FormField label="Spend ceiling (optional)">
              <Input
                value={spendCeiling}
                onChange={(e) => setSpendCeiling(e.target.value)}
                placeholder="Unlimited"
              />
            </FormField>
          </div>
          <FormField label="Scope targets (optional, comma-separated)">
            <Input
              value={scopeTargets}
              onChange={(e) => setScopeTargets(e.target.value)}
              placeholder="e.g. blob-id-1, blob-id-2"
            />
          </FormField>
          <FormField label="Expiry (optional)">
            <Input
              type="date"
              value={timeBoundEnd}
              onChange={(e) => setTimeBoundEnd(e.target.value)}
            />
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setCreateOpen(false); resetForm() }}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={saving || !delegateAddress.trim()}>
            {saving ? 'Creating…' : 'Create delegation'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Revoke Confirmation */}
    <AlertDialog open={!!revokeTarget} onOpenChange={(open) => { if (!open) setRevokeTarget(null) }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke delegation</AlertDialogTitle>
          <AlertDialogDescription>
            This will revoke the delegation for {formatAddress(revokeTarget?.delegateAddress ?? '')}. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleRevoke} variant="destructive">
            Revoke
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </PageTransition>
  )
}
