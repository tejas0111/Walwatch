'use client'

import { motion } from 'framer-motion'
import { AlertCircle, Check, Copy, Plus, Wallet } from 'lucide-react'
import { useEffect, useState, useCallback } from 'react'

import { Breadcrumbs } from '@/components/ui/breadcrumbs'
import { EmptyState } from '@/components/ui/empty-state'
import { SkeletonCard } from '@/components/ui/skeleton'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select'
import { useAuth } from '@/lib/auth-provider'
import { useToast } from '@/lib/toast-context'
import { api, type Wallet as BaseWallet } from '@/lib/api-client'

type WalletType = BaseWallet & {
  type?: string
  isDefault?: boolean
  spendingLimit?: number
  lastCheckedAt?: string
}
import { cn } from '@/lib/utils'

function truncateAddress(addr: string): string {
  if (addr.length <= 16) return addr
  return addr.slice(0, 6) + '…' + addr.slice(-4)
}

export default function WalletsPage() {
  const { org } = useAuth()
  const { addToast } = useToast()

  const [wallets, setWallets] = useState<WalletType[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const [addOpen, setAddOpen] = useState(false)
  const [addForm, setAddForm] = useState({
    address: '',
    label: '',
    type: 'owned',
    spendingLimit: '',
    isDefault: false,
  })
  const [addLoading, setAddLoading] = useState(false)

  const fetchWallets = useCallback(async () => {
    if (!org?.id) return
    setLoading(true)
    setError(null)
    try {
      const res = await api.listWallets(org.id)
      setWallets(Array.isArray(res) ? res : [])
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load wallets'
      setError(msg)
      addToast({ type: 'error', title: 'Failed to load wallets', description: msg })
    } finally {
      setLoading(false)
    }
  }, [org?.id, addToast])

  useEffect(() => { fetchWallets() }, [fetchWallets])

  const copyAddress = async (addr: string, id: string) => {
    try {
      await navigator.clipboard.writeText(addr)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch {
      addToast({ type: 'error', title: 'Failed to copy address' })
    }
  }

  const handleAdd = async () => {
    if (!org?.id || !addForm.address.trim()) return
    setAddLoading(true)
    try {
      const data: Record<string, unknown> = { address: addForm.address.trim() }
      if (addForm.label.trim()) data.label = addForm.label.trim()
      data.type = addForm.type
      if (addForm.spendingLimit) data.spendingLimit = parseFloat(addForm.spendingLimit)
      data.isDefault = addForm.isDefault
      await api.createWallet(org.id, data)
      addToast({ type: 'success', title: 'Wallet added' })
      setAddOpen(false)
      setAddForm({ address: '', label: '', type: 'owned', spendingLimit: '', isDefault: false })
      fetchWallets()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to add wallet'
      addToast({ type: 'error', title: 'Failed to add wallet', description: msg })
    } finally {
      setAddLoading(false)
    }
  }

  return (
      <>
        <div className="flex flex-col gap-6">
        <Breadcrumbs items={[{ label: 'Wallets' }]} />

        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm text-primary">Wallet management</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Wallets</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Manage WAL balances and fund your renewal vaults.
            </p>
          </div>
          <Button onClick={() => setAddOpen(true)}>
            <Plus size={16} />
            Add Wallet
          </Button>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive" role="alert">
            <AlertCircle size={16} />
            <span>{error}</span>
            <Button variant="ghost" size="sm" className="ml-auto" onClick={fetchWallets}>
              Retry
            </Button>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        )}

        {/* Empty */}
        {!loading && !error && wallets.length === 0 && (
          <EmptyState
            icon={Wallet}
            title="No wallets connected"
            description="Add a wallet to start funding your renewal vaults."
            action={{ label: 'Add wallet', onClick: () => setAddOpen(true) }}
          />
        )}

        {/* Wallet cards */}
        {!loading && !error && wallets.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {wallets.map((w, i) => {
              const balance = w.balance ?? 0
              const pct = Math.min(100, (balance / 100) * 100)
              const isEmpty = balance <= 0
              const isLow = balance > 0 && balance < 5

              return (
                <motion.div
                  key={w.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                >
                  <Card className="group transition-all hover:border-primary/40 hover:shadow-sm hover:shadow-primary/5">
                    <CardContent className="flex flex-col gap-4">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2.5">
                          <span className={cn(
                            'size-2 shrink-0 rounded-full',
                            isEmpty ? 'bg-destructive' : isLow ? 'bg-amber-500' : 'bg-primary',
                          )} />
                          <h2 className="text-base font-semibold">{w.label || 'Unnamed wallet'}</h2>
                        </div>
                        {w.type && (
                          <Badge variant="outline" className="capitalize text-[10px]">
                            {w.type}
                          </Badge>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {truncateAddress(w.address)}
                        </span>
                        <button
                          onClick={() => copyAddress(w.address, w.id)}
                          className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                          title="Copy address"
                        >
                          {copiedId === w.id ? <Check size={12} className="text-primary" /> : <Copy size={12} />}
                        </button>
                      </div>

                      <div>
                        <p className="text-[11px] text-muted-foreground">Balance</p>
                        <p className="mt-0.5 text-2xl font-semibold tracking-tight">
                          {balance.toFixed(2)}{' '}
                          <span className="text-sm font-normal text-muted-foreground">WAL</span>
                        </p>
                      </div>

                      <div
                        className="h-1.5 overflow-hidden rounded-full bg-muted"
                        role="progressbar"
                        aria-valuenow={pct}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      >
                        <div
                          style={{ width: `${pct}%` }}
                          className={cn(
                            'h-full rounded-full transition-all',
                            isEmpty ? 'bg-destructive' : isLow ? 'bg-amber-500' : 'bg-primary',
                          )}
                        />
                      </div>

                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        {w.spendingLimit != null && (
                          <span>Limit: {w.spendingLimit} WAL</span>
                        )}
                        {w.type && <span className="capitalize">{w.type}</span>}
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              )
            })}
          </div>
        )}
      </div>

      {/* Add Wallet Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Wallet</DialogTitle>
            <DialogDescription>Connect a wallet to track its balance and fund renewals.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Address <span className="text-destructive">*</span></label>
              <Input
                value={addForm.address}
                onChange={(e) => setAddForm((f) => ({ ...f, address: e.target.value }))}
                placeholder="0x..."
                className="font-mono text-xs"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Label</label>
              <Input
                value={addForm.label}
                onChange={(e) => setAddForm((f) => ({ ...f, label: e.target.value }))}
                placeholder="e.g. Primary vault"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Type</label>
              <Select value={addForm.type} onValueChange={(val: string | null) => setAddForm((f) => ({ ...f, type: val ?? 'owned' }))}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="owned">Owned</SelectItem>
                  <SelectItem value="watch-only">Watch-only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Spending Limit (WAL)</label>
              <Input
                type="number"
                value={addForm.spendingLimit}
                onChange={(e) => setAddForm((f) => ({ ...f, spendingLimit: e.target.value }))}
                placeholder="Optional"
                min="0"
                step="0.01"
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={addForm.isDefault}
                onChange={(e) => setAddForm((f) => ({ ...f, isDefault: e.target.checked }))}
                className="size-4 rounded border-border accent-primary"
              />
              Set as default wallet
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={handleAdd} disabled={addLoading || !addForm.address.trim()}>
              {addLoading ? 'Adding…' : 'Add Wallet'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </>
  )
}