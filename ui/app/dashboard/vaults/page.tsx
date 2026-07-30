'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ExternalLink, Landmark, Plus, Search, Wallet, Settings, X } from 'lucide-react'
import { useEffect, useState, useCallback } from 'react'

import { Breadcrumbs } from '@/components/ui/breadcrumbs'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { SkeletonTable } from '@/components/ui/skeleton'
import { Pagination } from '@/components/ui/pagination'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { PageTransition } from '@/components/dashboard/page-transition'
import { useToast } from '@/lib/toast-context'
import { api, type VaultInfo } from '@/lib/api-client'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 10

export default function VaultsPage() {
  const { addToast } = useToast()
  const router = useRouter()

  const [vaults, setVaults] = useState<VaultInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)

  const [depositTarget, setDepositTarget] = useState<VaultInfo | null>(null)
  const [depositAmount, setDepositAmount] = useState('')
  const [depositLoading, setDepositLoading] = useState(false)

  const [policyTarget, setPolicyTarget] = useState<VaultInfo | null>(null)
  const [policyThreshold, setPolicyThreshold] = useState('')
  const [policyExtension, setPolicyExtension] = useState('')
  const [policyLoading, setPolicyLoading] = useState(false)

  const fetchVaults = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.listVaults()
      setVaults(res)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load vaults'
      setError(msg)
      addToast({ type: 'error', title: 'Failed to load vaults', description: msg })
    } finally {
      setLoading(false)
    }
  }, [addToast])

  useEffect(() => { fetchVaults() }, [fetchVaults])
  useEffect(() => { setPage(1) }, [query])

  const filtered = vaults.filter((v) =>
    v.blobId.toLowerCase().includes(query.toLowerCase()),
  )
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const paged = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const handleDeposit = async () => {
    if (!depositTarget || !depositAmount.trim()) return
    setDepositLoading(true)
    try {
      await api.depositVault(depositTarget.id, { amount: Number(depositAmount.trim()) })
      addToast({ type: 'success', title: 'Deposit submitted' })
      setDepositTarget(null)
      setDepositAmount('')
      fetchVaults()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Deposit failed'
      addToast({ type: 'error', title: 'Deposit failed', description: msg })
    } finally {
      setDepositLoading(false)
    }
  }

  const handleUpdatePolicy = async () => {
    if (!policyTarget) return
    setPolicyLoading(true)
    try {
      await api.updateVaultPolicy(policyTarget.id, {
        renew_threshold_epochs: Number(policyThreshold),
        renew_by_epochs: Number(policyExtension),
      })
      addToast({ type: 'success', title: 'Policy updated' })
      setPolicyTarget(null)
      setPolicyThreshold('')
      setPolicyExtension('')
      fetchVaults()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update policy'
      addToast({ type: 'error', title: 'Failed to update policy', description: msg })
    } finally {
      setPolicyLoading(false)
    }
  }

  const truncate = (s: string) =>
    s.length > 16 ? s.slice(0, 8) + '…' + s.slice(-6) : s

  return (
    <PageTransition>
      <div className="flex flex-col gap-6">
      <Breadcrumbs items={[{ label: 'Vaults' }]} />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-primary">Vault management</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Vaults</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Auto-renewal vaults storing WAL balances for blob storage.
          </p>
        </div>
        <Button render={<Link href="/dashboard/new" />}>
          <Plus data-icon="inline-start" />
          Create vault
        </Button>
      </div>

      <div className="relative flex max-w-xs items-center">
        <Search size={16} className="absolute left-3 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search vaults by blob ID…"
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

      {loading && <SkeletonTable rows={5} />}

      {!loading && error && (
        <ErrorState message={error} onRetry={fetchVaults} />
      )}

      {!loading && !error && filtered.length === 0 && (
        <EmptyState
          icon={Landmark}
          title="No vaults found"
          description={query ? 'No vaults match your search.' : 'Create your first vault to start managing auto-renewals.'}
          action={query ? undefined : { label: 'Create vault', href: '/dashboard/new' }}
        />
      )}

      {!loading && !error && filtered.length > 0 && (
        <>
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Beneficiary</th>
                  <th className="px-5 py-3 font-medium">Blob ID</th>
                  <th className="px-5 py-3 font-medium">Balance</th>
                  <th className="px-5 py-3 font-medium">Threshold</th>
                  <th className="px-5 py-3 font-medium">Renewals</th>
                  <th className="px-5 py-3 font-medium">Created</th>
                  <th className="w-10 px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {paged.map((v) => (
                  <tr
                    key={v.id}
                    className="border-b border-border text-sm transition-colors last:border-0 hover:bg-muted/30"
                  >
                    <td className="px-5 py-3.5">
                      <Badge
                        variant="outline"
                        className={cn(
                          'capitalize',
                          v.policy.active
                            ? 'bg-primary/10 text-primary'
                            : 'bg-muted text-muted-foreground',
                        )}
                      >
                        {v.policy.active ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td className="px-5 py-3.5 font-mono text-xs text-muted-foreground">
                      {truncate(v.beneficiary)}
                    </td>
                    <td className="px-5 py-3.5 font-mono text-xs text-muted-foreground">
                      {truncate(v.blobId)}
                    </td>
                    <td className="px-5 py-3.5">{v.walBalance} WAL</td>
                    <td className="px-5 py-3.5 text-muted-foreground">
                      {v.policy.renewThresholdEpochs} epochs
                    </td>
                    <td className="px-5 py-3.5 text-muted-foreground">
                      {v.totalRenewals}
                    </td>
                    <td className="px-5 py-3.5 text-muted-foreground">
                      Epoch {v.createdAtEpoch}
                    </td>
                    <td className="px-5 py-3.5">
                      <DropdownMenu>
                        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />}>
                          <ExternalLink data-icon="inline-start" size={15} />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => router.push(`/dashboard/vaults/${v.id}`)}>
                            <ExternalLink size={14} /> View
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => { setDepositTarget(v); setDepositAmount('') }}>
                            <Wallet size={14} /> Deposit
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => {
                            setPolicyTarget(v)
                            setPolicyThreshold(String(v.policy.renewThresholdEpochs))
                            setPolicyExtension(String(v.policy.renewByEpochs))
                          }}>
                            <Settings size={14} /> Edit Policy
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <Pagination
              page={safePage}
              totalPages={totalPages}
              totalItems={filtered.length}
              onPageChange={setPage}
            />
          )}
        </>
      )}

      {/* Deposit Dialog */}
      <Dialog open={!!depositTarget} onOpenChange={(open) => { if (!open) setDepositTarget(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deposit WAL</DialogTitle>
            <DialogDescription>
              Add WAL balance to vault {depositTarget?.id.substring(0, 8)}.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="deposit-amount" className="text-sm font-medium">
                Amount <span className="text-destructive">*</span>
              </label>
              <Input
                id="deposit-amount"
                type="number"
                min="0"
                step="0.01"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                placeholder="e.g. 100"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDepositTarget(null)}>Cancel</Button>
            <Button onClick={handleDeposit} disabled={depositLoading || !depositAmount.trim()}>
              {depositLoading ? 'Depositing…' : 'Deposit'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Policy Dialog */}
      <Dialog open={!!policyTarget} onOpenChange={(open) => { if (!open) setPolicyTarget(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Policy</DialogTitle>
            <DialogDescription>
              Update renewal policy for vault {policyTarget?.id.substring(0, 8)}.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="policy-threshold" className="text-sm font-medium">
                Renew Threshold (epochs) <span className="text-destructive">*</span>
              </label>
              <Input
                id="policy-threshold"
                type="number"
                min="0"
                value={policyThreshold}
                onChange={(e) => setPolicyThreshold(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="policy-extension" className="text-sm font-medium">
                Renew By (epochs) <span className="text-destructive">*</span>
              </label>
              <Input
                id="policy-extension"
                type="number"
                min="0"
                value={policyExtension}
                onChange={(e) => setPolicyExtension(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPolicyTarget(null)}>Cancel</Button>
            <Button onClick={handleUpdatePolicy} disabled={policyLoading}>
              {policyLoading ? 'Updating…' : 'Update Policy'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </PageTransition>
  )
}
