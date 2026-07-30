'use client'

import { useEffect, useState } from 'react'
import { Check, CreditCard } from 'lucide-react'
import { api, type Invoice, type Subscription } from '@/lib/api-client'
import { useToast } from '@/lib/toast-context'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import { SectionCard } from '@/components/ui/section-card'
import { InlineSkeleton } from '@/components/ui/inline-skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'

const PLAN_FEATURES: Record<string, string[]> = {
  free: ['5 registered blobs', '100 renewals/month', 'Community support', 'Basic analytics'],
  pro: ['50 registered blobs', '1,000 renewals/month', 'Email support', 'Advanced analytics', 'Custom alert rules'],
  team: ['500 registered blobs', '10,000 renewals/month', 'Priority support', 'Team collaboration', 'API access', 'Audit logs'],
  enterprise: ['Unlimited blobs', 'Unlimited renewals', 'Dedicated support', 'Custom integrations', 'SLA guarantee', 'SSO/SAML'],
}

export function BillingSection() {
  const { addToast } = useToast()
  const [subscription, setSubscription] = useState<Subscription | null>(null)
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      api.getSubscription().catch(() => null),
      api.listInvoices().catch(() => []),
    ]).then(([sub, inv]) => {
      if (!cancelled) {
        setSubscription(sub)
        setInvoices(inv)
        setLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return (
      <div className="space-y-6">
        <SectionCard title="Current plan">
          <InlineSkeleton lines={2} />
        </SectionCard>
      </div>
    )
  }

  const plan = subscription?.plan || 'free'
  const features = PLAN_FEATURES[plan] || PLAN_FEATURES.free

  return (
    <div className="space-y-6">
      <SectionCard title="Current plan" description="Your current subscription and available plans.">
        <div className="space-y-6">
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Current plan</p>
                <p className="mt-1 text-2xl font-semibold capitalize">{plan}</p>
              </div>
              <Badge className="text-sm px-3" variant="secondary">{subscription?.status || 'active'}</Badge>
            </div>
            <ul className="mt-4 space-y-2">
              {features.map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Check size={14} className="shrink-0 text-green-500" />
                  {f}
                </li>
              ))}
            </ul>
          </div>

          {plan === 'free' && (
            <div>
              <p className="text-sm font-medium mb-3">Upgrade options</p>
              <div className="grid gap-3 sm:grid-cols-3">
                {(['pro', 'team', 'enterprise'] as const).map((p) => (
                  <div key={p} className="rounded-xl border border-border p-4 space-y-3 transition-colors hover:border-primary/30">
                    <p className="text-sm font-semibold capitalize">{p}</p>
                    <ul className="space-y-1.5">
                      {(PLAN_FEATURES[p] || []).slice(0, 4).map((f) => (
                        <li key={f} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Check size={10} className="shrink-0 text-green-500" />
                          {f}
                        </li>
                      ))}
                    </ul>
                    <Button variant="outline" size="sm" className="w-full">
                      Contact sales
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </SectionCard>

      <SectionCard title="Invoices" description="Your billing history.">
        {invoices.length === 0 ? (
          <EmptyState icon={CreditCard} title="No invoices" description="No invoices have been generated yet." />
        ) : (
          <div className="-mx-[--card-spacing] px-[--card-spacing]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="text-xs text-muted-foreground">{formatDate(inv.createdAt)}</TableCell>
                    <TableCell>{inv.description}</TableCell>
                    <TableCell className="font-medium">{formatCurrency(inv.amount)}</TableCell>
                    <TableCell>
              <Badge
                variant={inv.status === 'active' || inv.status === 'succeeded' ? 'default' : inv.status === 'past_due' || inv.status === 'failed' ? 'destructive' : 'outline'}
                className={cn(
                  inv.status === 'active' && 'bg-green-500/15 text-green-500 border-green-500/20',
                  inv.status === 'succeeded' && 'bg-green-500/15 text-green-500 border-green-500/20',
                )}
              >
                {inv.status}
              </Badge>
            </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>
    </div>
  )
}


