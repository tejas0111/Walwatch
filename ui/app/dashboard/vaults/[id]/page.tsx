'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  Check,
  Clock3,
  Coins,
  Copy,
  RefreshCw,
} from 'lucide-react'

import { Breadcrumbs } from '@/components/ui/breadcrumbs'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { ErrorState } from '@/components/ui/error-state'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { api } from '@/lib/api-client'
import { useToast } from '@/lib/toast-context'
import { PageTransition } from '@/components/dashboard/page-transition'

interface VaultDetail {
  id: string
  beneficiary: string
  blobId: string
  balance: number
  threshold: number
  extension: number
  active: boolean
  renewals: number
  createdAtEpoch: number
}

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      <Skeleton className="h-4 w-24" />
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-3">
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-4 w-48" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-10 w-24 rounded-lg" />
          <Skeleton className="h-10 w-28 rounded-lg" />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
        <Skeleton className="h-64 rounded-3xl" />
        <div className="flex flex-col gap-3">
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
        </div>
      </div>
    </div>
  )
}

function NotFoundState() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20">
      <AlertTriangle size={40} className="text-muted-foreground" />
      <p className="text-lg font-medium">Vault not found</p>
      <p className="text-sm text-muted-foreground">
        The vault you&apos;re looking for doesn&apos;t exist or has been removed.
      </p>
      <Button variant="outline" render={<Link href="/dashboard" />}>
        Back to vaults
      </Button>
    </div>
  )
}

export default function VaultDetailPage() {
  const params = useParams()
  const id = params.id as string
  const { addToast } = useToast()

  const [vault, setVault] = useState<VaultDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)

  const [depositOpen, setDepositOpen] = useState(false)
  const [depositAmount, setDepositAmount] = useState('')
  const [depositing, setDepositing] = useState(false)

  const [policyOpen, setPolicyOpen] = useState(false)
  const [policyThreshold, setPolicyThreshold] = useState('')
  const [policyExtension, setPolicyExtension] = useState('')
  const [policyMaxEpochs, setPolicyMaxEpochs] = useState('')
  const [policyActive, setPolicyActive] = useState(true)
  const [savingPolicy, setSavingPolicy] = useState(false)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    setLoading(true)
    setError(null)
    api.getVault(id)
      .then((data) => {
        if (!cancelled) {
          setVault({
            id: data.id,
            beneficiary: data.beneficiary,
            blobId: data.blobId,
            balance: Number(data.walBalance),
            threshold: data.policy.renewThresholdEpochs,
            extension: data.policy.renewByEpochs,
            active: data.policy.active,
            renewals: data.totalRenewals,
            createdAtEpoch: data.createdAtEpoch,
          })
          setPolicyThreshold(String(data.policy.renewThresholdEpochs))
          setPolicyExtension(String(data.policy.renewByEpochs))
          setPolicyMaxEpochs(data.policy.maxTotalEpochs ? String(data.policy.maxTotalEpochs) : '')
          setPolicyActive(data.policy.active)
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load vault')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [id, retryCount])

  async function handleDeposit() {
    const amount = Number(depositAmount)
    if (isNaN(amount) || amount <= 0) return
    setDepositing(true)
    try {
      await api.depositVault(id, { amount })
      addToast({ type: 'success', title: 'Deposit submitted' })
      setDepositOpen(false)
      setDepositAmount('')
      setRetryCount((c) => c + 1)
    } catch (err) {
      addToast({ type: 'error', title: 'Deposit failed', description: err instanceof Error ? err.message : 'Unknown error' })
    } finally {
      setDepositing(false)
    }
  }

  async function handleUpdatePolicy() {
    const threshold = Number(policyThreshold)
    const extension = Number(policyExtension)
    if (isNaN(threshold) || threshold <= 0 || isNaN(extension) || extension <= 0) return
    setSavingPolicy(true)
    try {
      await api.updateVaultPolicy(id, {
        renew_threshold_epochs: threshold,
        renew_by_epochs: extension,
        max_total_epochs: policyMaxEpochs ? Number(policyMaxEpochs) : undefined,
        active: policyActive,
      })
      addToast({ type: 'success', title: 'Policy updated' })
      setPolicyOpen(false)
      setRetryCount((c) => c + 1)
    } catch (err) {
      addToast({ type: 'error', title: 'Failed to update policy', description: err instanceof Error ? err.message : 'Unknown error' })
    } finally {
      setSavingPolicy(false)
    }
  }

  return (
    <PageTransition>
      <div className="flex flex-col gap-6">
        <Breadcrumbs items={[
          { label: 'Vaults', href: '/dashboard' },
          { label: vault ? `Vault ${vault.id.substring(0, 8)}` : 'Vault' },
        ]} />

        {loading && <LoadingSkeleton />}

        {!loading && error && <ErrorState message={error} onRetry={() => setRetryCount((c) => c + 1)} />}

        {!loading && !error && !vault && <NotFoundState />}

        {!loading && !error && vault && (
          <>
          <Link
            href="/dashboard/vaults"
            className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft size={16} />
            All vaults
          </Link>

          <div className="flex flex-col gap-8">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-2 text-xs text-accent">
                  <span className="size-2 rounded-full bg-accent" />
                  {vault.active ? 'Active' : 'Inactive'}
                </div>
                <h1 className="mt-3 text-3xl font-semibold tracking-tight">Vault {vault.id.substring(0, 8)}</h1>
                <p className="mt-2 flex items-center gap-2 font-mono text-xs text-muted-foreground">
                  {vault.id}
                  <Copy size={13} />
                </p>
              </div>
              <div className="flex gap-2">
                <Dialog open={policyOpen} onOpenChange={setPolicyOpen}>
                  <DialogTrigger render={<Button variant="outline" />}>Edit policy</DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Edit policy</DialogTitle>
                      <DialogDescription>
                        Update the renewal policy for this vault.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="flex flex-col gap-4 py-4">
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="threshold">Renew threshold (epochs)</Label>
                        <Input
                          id="threshold"
                          type="number"
                          value={policyThreshold}
                          onChange={(e) => setPolicyThreshold(e.target.value)}
                        />
                      </div>
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="extension">Extension (epochs)</Label>
                        <Input
                          id="extension"
                          type="number"
                          value={policyExtension}
                          onChange={(e) => setPolicyExtension(e.target.value)}
                        />
                      </div>
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="maxEpochs">Max total epochs</Label>
                        <Input
                          id="maxEpochs"
                          type="number"
                          value={policyMaxEpochs}
                          onChange={(e) => setPolicyMaxEpochs(e.target.value)}
                          placeholder="Unlimited"
                        />
                      </div>
                      <label className="flex items-center justify-between rounded-xl border border-border px-4 py-3">
                        <span className="text-sm">Active</span>
                        <Switch
                          checked={policyActive}
                          onCheckedChange={setPolicyActive}
                        />
                      </label>
                    </div>
                    <DialogFooter>
                      <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
                      <Button onClick={handleUpdatePolicy} disabled={savingPolicy}>
                        {savingPolicy ? 'Saving...' : 'Save'}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

                <Dialog open={depositOpen} onOpenChange={setDepositOpen}>
                  <DialogTrigger render={<Button variant="outline" />}>Deposit WAL</DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Deposit WAL</DialogTitle>
                      <DialogDescription>
                        Add WAL tokens to this vault to fund future renewals.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="flex flex-col gap-2 py-4">
                      <Label htmlFor="amount">Amount (WAL)</Label>
                      <Input
                        id="amount"
                        type="number"
                        min="0"
                        step="0.01"
                        value={depositAmount}
                        onChange={(e) => setDepositAmount(e.target.value)}
                        placeholder="0.0"
                      />
                    </div>
                    <DialogFooter>
                      <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
                      <Button onClick={handleDeposit} disabled={depositing || !depositAmount || Number(depositAmount) <= 0}>
                        {depositing ? 'Depositing...' : 'Deposit'}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </div>

            <section className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
              <div>
                <div className="rounded-3xl border border-primary/35 bg-primary/10 p-6 lg:p-8">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm text-primary">WAL Balance</p>
                      <div className="mt-3 flex items-baseline gap-2">
                        <span className="text-5xl font-semibold">{vault.balance}</span>
                        <span className="text-muted-foreground">WAL</span>
                      </div>
                    </div>
                    <Coins className="text-primary" />
                  </div>

                  <div className="mt-4 flex items-start gap-3 text-xs leading-relaxed text-muted-foreground">
                    {vault.balance < 20 ? (
                      <AlertTriangle size={16} className="shrink-0 text-destructive" />
                    ) : (
                      <Check size={16} className="shrink-0 text-accent" />
                    )}
                    <p>
                      Based on {vault.threshold} epochs threshold. The next threshold check is triggered at{' '}
                      {vault.balance < 20 ? (
                        <span className="text-destructive">10% of current balance</span>
                      ) : (
                        <span>20% of current balance</span>
                      )}
                      .
                    </p>
                  </div>
                </div>

                <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
                  <RefreshCw size={13} />
                  Renewal triggered at {vault.threshold} epochs before expiry
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <Info
                  icon={Clock3}
                  label="Created"
                  value={`Epoch ${vault.createdAtEpoch}`}
                />
                <Info
                  icon={ArrowUpRight}
                  label="Renewals"
                  value={vault.renewals}
                />
                <Info
                  icon={Coins}
                  label="Extension"
                  value={`${vault.extension} epochs`}
                />
              </div>
            </section>
          </div>
          </>
        )}
      </div>
    </PageTransition>
  )
}

function Info({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Clock3
  label: string
  value: string | number
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon size={15} />
        {label}
      </div>
      <p className="mt-3 text-xl font-semibold">{value}</p>
    </div>
  )
}
