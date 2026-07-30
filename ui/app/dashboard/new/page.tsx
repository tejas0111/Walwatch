'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Clock,
  Coins,
  Plus,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api-client'
import type { BlobRegistration, Wallet } from '@/lib/api-client'
import { useToast } from '@/lib/toast-context'
import { Row } from '@/components/ui/row'
import { TextField } from '@/components/ui/text-field'
import { PageTransition } from '@/components/dashboard/page-transition'

interface Fields {
  walletAddress: string
  blobId: string
  amount: string
  threshold: string
  extension: string
  maxEpochs: string
  active: boolean
}

export default function NewVaultPage() {
  const router = useRouter()
  const { addToast } = useToast()
  const [f, setF] = useState<Fields>({
    walletAddress: '',
    blobId: '',
    amount: '',
    threshold: '15',
    extension: '60',
    maxEpochs: '600',
    active: true,
  })
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const [touched, setTouched] = useState(false)
  const [wallets, setWallets] = useState<Wallet[]>([])
  const [blobs, setBlobs] = useState<BlobRegistration[]>([])
  const [selectedWalletId, setSelectedWalletId] = useState('')
  const [selectedBlobId, setSelectedBlobId] = useState('')
  const [costPerEpoch, setCostPerEpoch] = useState(0.02)
  const [estimateError, setEstimateError] = useState<string | null>(null)
  const [walletError, setWalletError] = useState('')
  const [blobError, setBlobError] = useState('')

  useEffect(() => {
    api.listWallets().then(setWallets).catch((e) => setWalletError(e instanceof Error ? e.message : 'Failed to fetch wallets'))
    api.listBlobs({ status: 'discovered' }).then(setBlobs).catch((e) => setBlobError(e instanceof Error ? e.message : 'Failed to fetch blobs'))
  }, [])

  useEffect(() => {
    if (!selectedBlobId || !f.extension) return
    const ext = Number(f.extension)
    if (isNaN(ext) || ext <= 0) return
    setEstimateError(null)
    api.simulateCost({ blobIds: [selectedBlobId], extensionEpochs: ext })
      .then((res) => {
        const est = res.estimate?.[0]
        if (est && typeof est.estimatedCost === 'number') {
          setCostPerEpoch(est.estimatedCost / ext)
        }
      })
      .catch((e) => setEstimateError(e instanceof Error ? e.message : 'Failed to fetch cost estimate'))
  }, [selectedBlobId, f.extension])

  const errors = useMemo(() => {
    const e: Partial<Record<keyof Fields, string>> = {}
    if (!f.walletAddress.trim()) e.walletAddress = 'Wallet address is required.'
    if (!f.blobId.trim()) e.blobId = 'Blob ID is required.'
    const amt = Number(f.amount)
    if (!f.amount || isNaN(amt) || amt <= 0) e.amount = 'Enter a positive WAL amount.'
    if (Number(f.threshold) <= 0) e.threshold = 'Must be greater than 0.'
    if (Number(f.extension) <= 0) e.extension = 'Must be greater than 0.'
    if (Number(f.maxEpochs) < Number(f.extension)) e.maxEpochs = 'Must be at least the extension.'
    return e
  }, [f])

  const valid = Object.keys(errors).length === 0
  const runway = f.amount && !isNaN(Number(f.amount)) && f.threshold && !isNaN(Number(f.threshold))
    ? Math.floor(Number(f.amount) / (Number(f.threshold) * costPerEpoch))
    : 0

  const set = (k: keyof Fields) => (v: string | boolean) => setF((p) => ({ ...p, [k]: v }))

  function handleWalletSelect(e: React.ChangeEvent<HTMLSelectElement>) {
    const id = e.target.value
    setSelectedWalletId(id)
    if (id) {
      const wallet = wallets.find((w) => w.id === id)
      if (wallet) setF((p) => ({ ...p, walletAddress: wallet.address }))
    } else {
      setF((p) => ({ ...p, walletAddress: '' }))
    }
  }

  function handleWalletAddressChange(v: string) {
    setSelectedWalletId('')
    set('walletAddress')(v)
  }

  function handleBlobSelect(e: React.ChangeEvent<HTMLSelectElement>) {
    const id = e.target.value
    setSelectedBlobId(id)
    if (id) {
      const blob = blobs.find((b) => b.id === id)
      if (blob) setF((p) => ({ ...p, blobId: blob.blobId }))
    } else {
      setF((p) => ({ ...p, blobId: '' }))
    }
  }

  function handleBlobIdChange(v: string) {
    setSelectedBlobId('')
    set('blobId')(v)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setTouched(true)
    if (!valid) return
    setError('')
    setLoading(true)
    try {
      await api.createVault({
        wallet_address: f.walletAddress,
        blob_id: f.blobId,
        initial_wal_amount: Number(f.amount),
        renew_threshold_epochs: Number(f.threshold),
        renew_by_epochs: Number(f.extension),
        max_total_epochs: Number(f.maxEpochs),
        active: f.active,
      })
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transaction could not be prepared.')
      setLoading(false)
    }
  }

  if (done) {
    return (
      <PageTransition>
      <div className="mx-auto max-w-md rounded-3xl border border-border bg-card p-8 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-accent/15 text-accent">
          <Check />
        </span>
        <h1 className="mt-5 text-xl font-semibold">Vault created</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your renewal policy is live. Keepers will renew this blob before it
          drops below your threshold.
        </p>
        <Link
          href="/dashboard"
          className="mt-6 inline-block rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground"
        >
          Back to dashboard
        </Link>
      </div>
      </PageTransition>
    )
  }

  return (
    <PageTransition>
      <Button variant="ghost" size="sm" onClick={() => router.back()} className="mb-6">
        <ArrowLeft data-icon="inline-start" />
        Back
      </Button>
      <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
        <form
          onSubmit={submit}
          noValidate
          className="rounded-3xl border border-border bg-card p-6 lg:p-8"
        >
          <h1 className="text-2xl font-semibold tracking-tight">
            Create a renewal vault
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Fund a vault and encode the policy keepers must follow.
          </p>
          {error && (
            <Alert variant="destructive" className="mt-6">
              <AlertCircle size={16} />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="mt-8 flex flex-col gap-5">
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium">Wallet address</span>
              <select
                value={selectedWalletId}
                onChange={handleWalletSelect}
                className="h-11 rounded-xl border border-input bg-background px-3.5 text-sm outline-none focus:ring-2 focus:ring-ring/40"
              >
                <option value="">Select a wallet...</option>
                {wallets.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.label} ({w.address.slice(0, 6)}...{w.address.slice(-4)})
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={f.walletAddress}
                onChange={(e) => handleWalletAddressChange(e.target.value)}
                placeholder="0x..."
                className="h-11 rounded-xl border bg-background px-3.5 text-sm font-mono outline-none focus:ring-2 focus:ring-ring/40 aria-invalid:border-destructive"
                aria-invalid={touched && !!errors.walletAddress}
              />
              {touched && errors.walletAddress && (
                <span className="text-xs text-destructive">{errors.walletAddress}</span>
              )}
            </label>
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium">Walrus blob ID</span>
              <select
                value={selectedBlobId}
                onChange={handleBlobSelect}
                className="h-11 rounded-xl border border-input bg-background px-3.5 text-sm outline-none focus:ring-2 focus:ring-ring/40"
              >
                <option value="">Select a blob...</option>
                {blobs.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.blobId.slice(0, 8)}...{b.name ? ` (${b.name})` : ''}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={f.blobId}
                onChange={(e) => handleBlobIdChange(e.target.value)}
                placeholder="e.g. KJo1...w92"
                className="h-11 rounded-xl border bg-background px-3.5 text-sm font-mono outline-none focus:ring-2 focus:ring-ring/40 aria-invalid:border-destructive"
                aria-invalid={touched && !!errors.blobId}
              />
              {touched && errors.blobId && (
                <span className="text-xs text-destructive">{errors.blobId}</span>
              )}
            </label>
            <TextField
              label="Initial WAL deposit"
              value={f.amount}
              onChange={set('amount')}
              error={touched ? errors.amount : ''}
              placeholder="0.0"
              type="number"
            />
            <div className="grid gap-5 sm:grid-cols-2">
              <TextField
                label="Renew threshold (epochs)"
                value={f.threshold}
                onChange={set('threshold')}
                error={touched ? errors.threshold : ''}
                type="number"
              />
              <TextField
                label="Extension (epochs)"
                value={f.extension}
                onChange={set('extension')}
                error={touched ? errors.extension : ''}
                type="number"
              />
            </div>
            <TextField
              label="Max total epochs"
              value={f.maxEpochs}
              onChange={set('maxEpochs')}
              error={touched ? errors.maxEpochs : ''}
              type="number"
            />
            <label className="flex items-center justify-between rounded-xl border border-border px-4 py-3">
              <span className="text-sm">Activate immediately</span>
              <Switch
                checked={f.active}
                onCheckedChange={set('active')}
              />
            </label>
          </div>
          <Button
            type="submit"
            disabled={loading}
            className="mt-8 w-full h-12"
          >
            {loading ? 'Creating...' : (
              <>
                <Plus data-icon="inline-start" />
                Create vault
              </>
            )}
          </Button>
        </form>
        <aside className="rounded-3xl border border-border bg-card p-6 lg:p-8">
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <Coins size={18} />
            Summary
          </h2>
          <dl className="mt-5 flex flex-col gap-3 text-sm">
            <Row label="Est. cost per renewal" value={`${f.threshold && !isNaN(Number(f.threshold)) ? (Number(f.threshold) * costPerEpoch).toFixed(2) : '0.00'} WAL`} />
            <Row label="Deposit" value={f.amount || '\u2014'} />
            <Row label="Runway" value={`${runway} renewals`} />
            <Row label="Threshold" value={`${f.threshold || '\u2014'} epochs`} />
            <Row label="Extension" value={`${f.extension || '\u2014'} epochs`} />
            <Row label="Max epochs" value={f.maxEpochs || '\u2014'} />
          </dl>
          <Alert className="mt-6">
            <Clock size={14} className="mt-0.5 shrink-0" />
            <AlertTitle>Estimated coverage</AlertTitle>
            <AlertDescription>
              At current gas estimates, this vault covers approximately{' '}
              <strong className="text-foreground">
                {runway} renewals
              </strong>
              . Top up before funds run out to maintain coverage.
            </AlertDescription>
          </Alert>
        </aside>
      </div>
    </PageTransition>
  )
}
