'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { AlertCircle, Check, ChevronRight, CreditCard, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api-client'
import { useAuth } from '@/lib/auth-provider'
import { useToast } from '@/lib/toast-context'

import { Breadcrumbs } from '@/components/ui/breadcrumbs'
import { EmptyState } from '@/components/ui/empty-state'
import { SkeletonCard } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

type Plan = 'free' | 'pro' | 'team' | 'enterprise'

type Subscription = {
  id: string
  plan: string
  status: string
  currentPeriodStart?: string
  currentPeriodEnd?: string
}

type Invoice = {
  id: string
  amount: number
  currency?: string
  status: string
  description?: string
  created_at: string
  due_date?: string
  paid_at?: string
}

const planDetails: Record<Plan, { name: string; price: string; period: string; features: string[] }> = {
  free: { name: 'Free', price: '$0', period: '/mo', features: ['Up to 5 blobs', '500 MB storage', '10 renewals/month', 'Basic policies', 'Email alerts'] },
  pro: { name: 'Pro', price: '$29', period: '/mo', features: ['Up to 100 blobs', '10 GB storage', '500 renewals/month', 'Advanced policies', 'Slack & Discord alerts', 'API access', 'Team members (5)'] },
  team: { name: 'Team', price: '$79', period: '/mo', features: ['Up to 500 blobs', '50 GB storage', '5,000 renewals/month', 'Custom policies', 'All alert channels', 'Full API access', 'Unlimited team members'] },
  enterprise: { name: 'Enterprise', price: '$199', period: '/mo', features: ['Unlimited blobs', '100 GB storage', '10,000 renewals/month', 'Custom policies', 'All alert channels', 'Full API access', 'Unlimited team members', 'SSO & audit logs', 'Priority support'] },
}

const statusStyles: Record<string, string> = {
  paid: 'bg-accent/10 text-accent',
  active: 'bg-accent/10 text-accent',
  pending: 'bg-amber-500/10 text-amber-500',
  failed: 'bg-destructive/10 text-destructive',
  canceled: 'bg-muted text-muted-foreground',
}

export default function BillingPage() {
  const { org } = useAuth()
  const { addToast } = useToast()
  const [loading, setLoading] = useState(true)
  const [subscription, setSubscription] = useState<Subscription | null>(null)
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [showUpgradeModal, setShowUpgradeModal] = useState(false)
  const [upgrading, setUpgrading] = useState(false)

  const currentPlan = (subscription?.plan || 'free') as Plan
  const current = planDetails[currentPlan] || planDetails.free

  useEffect(() => {
    if (!org) return
    let cancelled = false

    async function load() {
      try {
        const [sub, inv] = await Promise.all([
          api.getSubscription(org!.id),
          api.listInvoices(org!.id),
        ])
        if (cancelled) return
        setSubscription(sub as unknown as Subscription)
        setInvoices(Array.isArray(inv) ? inv : ((inv as unknown as Record<string, unknown>)?.invoices as Invoice[]) || [])
      } catch {
        if (!cancelled) addToast({ type: 'error', title: 'Failed to load billing data' })
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [org, addToast])

  async function handleUpgrade(plan: Plan) {
    if (!org) return
    setUpgrading(true)
    try {
      const updated = await api.updateSubscription(org.id, plan)
      setSubscription(updated)
      setShowUpgradeModal(false)
      addToast({ type: 'success', title: `Switched to ${planDetails[plan].name} plan` })
    } catch {
      addToast({ type: 'error', title: 'Failed to update subscription' })
    } finally {
      setUpgrading(false)
    }
  }

  if (loading) {
    return (
        <>
          <Breadcrumbs items={[{ label: 'Billing' }]} />
          <div className="flex flex-col gap-6">
            {[1, 2, 3].map((i) => <SkeletonCard key={i} />)}
          </div>
        </>
    )
  }

  return (
      <div className="flex flex-col gap-6">
        <Breadcrumbs items={[{ label: 'Billing' }]} />

        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm text-primary">Subscription</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Billing</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Manage your plan, invoices, and payment methods.
            </p>
          </div>
        </div>

        <section aria-labelledby="current-plan-heading">
          <h2 id="current-plan-heading" className="mb-4 text-sm font-semibold">Current plan</h2>
          <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
            <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-4">
                <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-primary/10">
                  <CreditCard size={24} className="text-primary" aria-hidden="true" />
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-xl font-semibold">{current.name}</h3>
                    <span className={cn(
                      'rounded-md px-2 py-0.5 text-[11px] font-medium',
                      statusStyles[subscription?.status || 'active'] || 'bg-accent/10 text-accent',
                    )}>
                      {subscription?.status || 'active'}
                    </span>
                  </div>
                  <p className="mt-1 text-2xl font-semibold tracking-tight">
                    {current.price}
                    <span className="text-sm font-normal text-muted-foreground">{current.period}</span>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowUpgradeModal(true)}
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
              >
                <RefreshCw size={16} aria-hidden="true" />
                {currentPlan === 'enterprise' ? 'Contact sales' : 'Upgrade'}
              </button>
            </div>
            {subscription?.currentPeriodEnd && (
              <div className="mt-4 border-t border-border pt-4 text-xs text-muted-foreground">
                Current period ends {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
              </div>
            )}
          </div>
        </section>

        <section aria-labelledby="compare-plans-heading">
          <h2 id="compare-plans-heading" className="mb-4 text-sm font-semibold">Compare plans</h2>
          <div className="grid gap-4 lg:grid-cols-4">
            {(Object.keys(planDetails) as Plan[]).map((planId) => {
              const plan = planDetails[planId]
              const isCurrent = planId === currentPlan
              return (
                <div
                  key={planId}
                  className={cn(
                    'relative rounded-2xl border bg-card p-5 transition-all sm:p-6',
                    isCurrent ? 'border-primary/50 shadow-sm shadow-primary/10' : 'border-border hover:border-primary/30',
                  )}
                >
                  {isCurrent && (
                    <span className="absolute -top-2.5 left-5 rounded-md bg-primary px-3 py-0.5 text-[11px] font-medium text-primary-foreground">
                      Current plan
                    </span>
                  )}
                  <h3 className="text-lg font-semibold">{plan.name}</h3>
                  <p className="mt-2 text-3xl font-semibold tracking-tight">
                    {plan.price}
                    <span className="text-sm font-normal text-muted-foreground">{plan.period}</span>
                  </p>
                  <ul className="mt-5 space-y-2.5">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-sm text-muted-foreground">
                        <Check size={14} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-6">
                    {isCurrent ? (
                      <div className="flex items-center justify-center gap-2 rounded-xl border border-border px-5 py-2.5 text-sm font-medium text-muted-foreground">
                        <Check size={15} className="text-accent" aria-hidden="true" />
                        Current plan
                      </div>
                    ) : planId === 'enterprise' ? (
                      <button className="flex w-full items-center justify-center gap-2 rounded-xl border border-border px-5 py-2.5 text-sm font-medium transition-colors hover:bg-muted">
                        Contact sales
                        <ChevronRight size={15} aria-hidden="true" />
                      </button>
                    ) : (
                      <button
                        onClick={() => handleUpgrade(planId)}
                        disabled={upgrading}
                        className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Upgrade
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        <section aria-labelledby="invoices-heading">
          <h2 id="invoices-heading" className="mb-4 text-sm font-semibold">Invoices</h2>
          {invoices.length === 0 ? (
            <EmptyState icon={CreditCard} title="No invoices" description="Your billing history will appear here." />
          ) : (
            <>
              <div className="hidden overflow-hidden rounded-2xl border border-border bg-card sm:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th className="px-5 py-3 font-medium">Date</th>
                      <th className="px-5 py-3 font-medium">Amount</th>
                      <th className="px-5 py-3 font-medium">Currency</th>
                      <th className="px-5 py-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((inv) => (
                      <tr key={inv.id} className="border-b border-border transition-colors last:border-0 hover:bg-muted/30">
                        <td className="px-5 py-3.5 text-muted-foreground">
                          {new Date(inv.created_at).toLocaleDateString()}
                        </td>
                        <td className="px-5 py-3.5 tabular-nums">
                          ${(inv.amount / 100).toFixed(2)}
                        </td>
                        <td className="px-5 py-3.5 uppercase text-muted-foreground">{inv.currency}</td>
                        <td className="px-5 py-3.5">
                          <span className={cn('rounded-md px-2 py-0.5 text-[11px] font-medium', statusStyles[inv.status] || 'bg-muted text-muted-foreground')}>
                            {inv.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col gap-3 sm:hidden">
                {invoices.map((inv) => (
                  <div key={inv.id} className="rounded-2xl border border-border bg-card p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium">${(inv.amount / 100).toFixed(2)} {(inv.currency ?? 'USD').toUpperCase()}</p>
                      <span className={cn('rounded-md px-2 py-0.5 text-[11px] font-medium', statusStyles[inv.status] || 'bg-muted text-muted-foreground')}>
                        {inv.status}
                      </span>
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      {new Date(inv.created_at).toLocaleDateString()}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        <AnimatePresence>
          {showUpgradeModal && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
              onClick={() => setShowUpgradeModal(false)}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-xl"
                role="dialog"
                aria-modal="true"
                aria-label="Change plan"
              >
                <h3 className="text-lg font-semibold">Change plan</h3>
                <p className="mt-1 text-sm text-muted-foreground">Select a new plan for your organization.</p>
                <div className="mt-5 space-y-3">
                  {(Object.keys(planDetails) as Plan[]).filter((p) => p !== currentPlan).map((planId) => {
                    const plan = planDetails[planId]
                    return (
                      <button
                        key={planId}
                        onClick={() => handleUpgrade(planId)}
                        disabled={upgrading}
                        className="flex w-full items-center justify-between rounded-2xl border border-border p-4 text-left transition-colors hover:border-primary/40 disabled:opacity-50"
                      >
                        <div>
                          <p className="font-semibold">{plan.name}</p>
                          <p className="text-sm text-muted-foreground">{plan.features[0]}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold">{plan.price}</p>
                          <p className="text-xs text-muted-foreground">{plan.period}</p>
                        </div>
                      </button>
                    )
                  })}
                </div>
                <button
                  onClick={() => setShowUpgradeModal(false)}
                  className="mt-4 flex w-full items-center justify-center rounded-xl border border-border py-3 text-sm font-medium transition-colors hover:bg-muted"
                >
                  Cancel
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
  )
}
