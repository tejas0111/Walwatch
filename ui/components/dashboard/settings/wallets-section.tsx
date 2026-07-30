'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Pencil, Plus, Wallet } from 'lucide-react'
import { api, type Wallet as WalletType } from '@/lib/api-client'
import { useToast } from '@/lib/toast-context'
import { cn, formatAddress } from '@/lib/utils'
import { SectionCard } from '@/components/ui/section-card'
import { InlineSkeleton } from '@/components/ui/inline-skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CopyButton } from '@/components/ui/copy-button'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'

export function WalletsSection() {
  const { addToast } = useToast()
  const [wallets, setWallets] = useState<(WalletType & { type?: string })[]>([])
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [form, setForm] = useState({ address: '', label: '', type: 'owned' })
  const [creating, setCreating] = useState(false)
  const [editWallet, setEditWallet] = useState<(WalletType & { type?: string }) | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [editSpendingLimit, setEditSpendingLimit] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  const fetchWallets = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.listWallets()
      setWallets(data)
    } catch {
      addToast({ type: 'error', title: 'Failed to load wallets' })
    } finally {
      setLoading(false)
    }
  }, [addToast])

  useEffect(() => {
    fetchWallets()
  }, [fetchWallets])

  async function handleCreate() {
    if (!form.address || !form.label) return
    setCreating(true)
    try {
      await api.createWallet(form)
      addToast({ type: 'success', title: 'Wallet added' })
      setAddOpen(false)
      setForm({ address: '', label: '', type: 'owned' })
      await fetchWallets()
    } catch {
      addToast({ type: 'error', title: 'Failed to add wallet' })
    } finally {
      setCreating(false)
    }
  }

  async function handleEditWallet() {
    if (!editWallet || !editLabel.trim()) return
    setSavingEdit(true)
    try {
      const data: Record<string, unknown> = { label: editLabel.trim() }
      if (editSpendingLimit) {
        data.spendingLimit = Number(editSpendingLimit)
      }
      await api.updateWallet(editWallet.id, data)
      addToast({ type: 'success', title: 'Wallet updated' })
      setEditWallet(null)
      setEditLabel('')
      setEditSpendingLimit('')
      await fetchWallets()
    } catch {
      addToast({ type: 'error', title: 'Failed to update wallet' })
    } finally {
      setSavingEdit(false)
    }
  }

  return (
    <SectionCard
      title="Wallets"
      description="Manage wallets used for blob storage payments."
      action={
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger render={<Button size="sm" />}>
            <Plus size={16} /> Add wallet
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Add wallet</DialogTitle>
              <DialogDescription>Register a new wallet for blob storage payments.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="wallet-address">Address</Label>
                <Input
                  id="wallet-address"
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  placeholder="0x..."
                  className="font-mono"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="wallet-label">Label</Label>
                <Input
                  id="wallet-label"
                  value={form.label}
                  onChange={(e) => setForm({ ...form, label: e.target.value })}
                  placeholder="My wallet"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Type</Label>
                <Select defaultValue="owned" value={form.type} onValueChange={(v) => v && setForm({ ...form, type: v })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="owned">Owned</SelectItem>
                    <SelectItem value="watch-only">Watch-only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
              <Button onClick={handleCreate} disabled={creating || !form.address || !form.label}>
                {creating && <Loader2 size={16} className="animate-spin" />}
                {creating ? 'Adding...' : 'Add wallet'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      }
    >
      {loading ? (
        <InlineSkeleton lines={3} />
      ) : wallets.length === 0 ? (
        <EmptyState icon={Wallet} title="No wallets" description="Add a wallet to start paying for blob storage." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {wallets.map((w) => (
            <div
              key={w.id}
              className="rounded-xl border border-border p-4 space-y-3 transition-colors hover:border-primary/30"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <Wallet size={16} className="text-muted-foreground" />
                  <span className="text-sm font-medium">{w.label}</span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                    onClick={() => { setEditWallet(w); setEditLabel(w.label); setEditSpendingLimit(w.spendingLimit !== undefined ? String(w.spendingLimit) : '') }}
                    aria-label={`Edit wallet ${w.label || ''}`}
                  >
                    <Pencil size={14} />
                  </button>
                  <Badge variant={w.type === 'owned' ? 'default' : 'outline'} className="text-[10px]">
                    {w.type}
                  </Badge>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">
                  {formatAddress(w.address)}
                </code>
                <CopyButton text={w.address} />
              </div>
              {w.balance !== undefined && (
                <div>
                  <p className="text-xs text-muted-foreground">Balance</p>
                  <p className="text-sm font-medium">{w.balance.toLocaleString()} lamports</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Edit Wallet Dialog */}
      <Dialog open={!!editWallet} onOpenChange={(open) => { if (!open) { setEditWallet(null); setEditLabel(''); setEditSpendingLimit('') } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit wallet</DialogTitle>
            <DialogDescription>Update the wallet label and spending limit.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-wallet-label">Label</Label>
              <Input
                id="edit-wallet-label"
                value={editLabel}
                onChange={(e) => setEditLabel(e.target.value)}
                placeholder="My wallet"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-wallet-limit">Spending limit (lamports)</Label>
              <Input
                id="edit-wallet-limit"
                type="number"
                min="0"
                value={editSpendingLimit}
                onChange={(e) => setEditSpendingLimit(e.target.value)}
                placeholder="No limit"
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button onClick={handleEditWallet} disabled={savingEdit || !editLabel.trim()}>
              {savingEdit && <Loader2 size={16} className="animate-spin" />}
              {savingEdit ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionCard>
  )
}


