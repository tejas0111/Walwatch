'use client'

import Link from 'next/link'
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Clock,
  Coins,
  Loader2,
  PenLine,
} from 'lucide-react'
import { useMemo, useState } from 'react'

import { Row } from '@/components/ui/row'
import { TextField } from '@/components/ui/text-field'

const EST_COST = 3.2

type Step = 'form' | 'signing' | 'done'

interface Fields {
  blobId: string
  amount: string
  threshold: string
  extension: string
  maxEpochs: string
  active: boolean
}

export default function NewVaultPage() {
  const [f, setF] = useState<Fields>({
    blobId: '',
    amount: '',
    threshold: '15',
    extension: '60',
    maxEpochs: '600',
    active: true,
  })
  const [step, setStep] = useState<Step>('form')
  const [error, setError] = useState('')
  const [touched, setTouched] = useState(false)

  const errors = useMemo(() => {
    const e: Partial<Record<keyof Fields, string>> = {}
    if (!f.blobId.trim()) e.blobId = 'Blob ID is required.'
    const amt = Number(f.amount)
    if (!f.amount || isNaN(amt) || amt <= 0) e.amount = 'Enter a positive WAL amount.'
    if (Number(f.threshold) <= 0) e.threshold = 'Must be greater than 0.'
    if (Number(f.extension) <= 0) e.extension = 'Must be greater than 0.'
    if (Number(f.maxEpochs) < Number(f.extension)) e.maxEpochs = 'Must be at least the extension.'
    return e
  }, [f])

  const valid = Object.keys(errors).length === 0
  const runway = f.amount && !isNaN(Number(f.amount)) ? Math.floor(Number(f.amount) / EST_COST) : 0

  const set = (k: keyof Fields) => (v: string | boolean) => setF((p) => ({ ...p, [k]: v }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setTouched(true)
    if (!valid) return
    setError('')
    setStep('signing')
    try {
      await new Promise((r) => setTimeout(r, 1400))
      await new Promise((r) => setTimeout(r, 1000))
      setStep('done')
    } catch {
      setError('Transaction could not be prepared. Please try again.')
      setStep('form')
    }
  }

  if (step === 'done') {
    return (
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
    )
  }

  return (
    <>
      <Link
        href="/dashboard"
        className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft size={16} />
        Back
      </Link>
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
            <div className="mt-6 flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
              <AlertCircle size={16} />
              {error}
            </div>
          )}
          <div className="mt-8 flex flex-col gap-5">
            <TextField
              label="Walrus blob ID"
              value={f.blobId}
              onChange={set('blobId')}
              error={touched ? errors.blobId : ''}
              placeholder="e.g. KJo1...w92"
              mono
            />
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
              <button
                type="button"
                role="switch"
                aria-checked={f.active}
                onClick={() => set('active')(!f.active)}
                className={`relative h-6 w-11 rounded-full transition-colors ${f.active ? 'bg-primary' : 'bg-muted'}`}
              >
                <span
                  className={`absolute top-0.5 size-5 rounded-full bg-background transition-all ${f.active ? 'left-[22px]' : 'left-0.5'}`}
                />
              </button>
            </label>
          </div>
          <button
            type="submit"
            disabled={step === 'signing'}
            className="mt-8 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {step === 'signing' ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Signing
              </>
            ) : (
              <>
                <PenLine size={16} />
                Sign &amp; create vault
              </>
            )}
          </button>
        </form>
        <aside className="rounded-3xl border border-border bg-card p-6 lg:p-8">
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <Coins size={18} />
            Summary
          </h2>
          <dl className="mt-5 flex flex-col gap-3 text-sm">
            <Row label="Est. cost per renewal" value={`${EST_COST} WAL`} />
            <Row label="Deposit" value={f.amount || '\u2014'} />
            <Row label="Runway" value={`${runway} renewals`} />
            <Row label="Threshold" value={`${f.threshold || '\u2014'} epochs`} />
            <Row label="Extension" value={`${f.extension || '\u2014'} epochs`} />
            <Row label="Max epochs" value={f.maxEpochs || '\u2014'} />
          </dl>
          <div className="mt-6 flex items-start gap-2 rounded-lg border border-border/60 bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground">
            <Clock size={14} className="mt-0.5 shrink-0" />
            <span>
              At current gas estimates, this vault covers approximately{' '}
              <strong className="text-foreground">
                {runway} renewals
              </strong>
              . Top up before funds run out to maintain coverage.
            </span>
          </div>
        </aside>
      </div>
    </>
  )
}
