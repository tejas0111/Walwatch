'use client'

import { useEffect, useState } from 'react'
import { BarChart3, Database, Coins, Folder, RefreshCw, Shield } from 'lucide-react'
import { api, type BlobRegistration } from '@/lib/api-client'
import { useAuth } from '@/lib/auth-provider'
import { useToast } from '@/lib/toast-context'

import { Breadcrumbs } from '@/components/ui/breadcrumbs'
import { EmptyState } from '@/components/ui/empty-state'
import { SkeletonCard } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

type Overview = {
  totalBlobs: number
  activeBlobs: number
  totalProjects: number
  totalPolicies: number
  totalWallets: number
}

const metricConfig = [
  { key: 'totalBlobs' as const, label: 'Total Blobs', icon: Database, color: 'text-primary', bg: 'bg-primary/10' },
  { key: 'activeBlobs' as const, label: 'Active Blobs', icon: RefreshCw, color: 'text-accent', bg: 'bg-accent/10' },
  { key: 'totalProjects' as const, label: 'Projects', icon: Folder, color: 'text-chart-3', bg: 'bg-chart-3/10' },
  { key: 'totalPolicies' as const, label: 'Policies', icon: Shield, color: 'text-amber-500', bg: 'bg-amber-500/10' },
  { key: 'totalWallets' as const, label: 'Wallets', icon: Coins, color: 'text-primary', bg: 'bg-primary/10' },
]

export default function AnalyticsPage() {
  const { org } = useAuth()
  const { addToast } = useToast()
  const [loading, setLoading] = useState(true)
  const [overview, setOverview] = useState<Overview | null>(null)
  const [recentBlobs, setRecentBlobs] = useState<BlobRegistration[]>([])

  useEffect(() => {
    if (!org) return
    let cancelled = false

    async function load() {
      try {
        const [analytics, blobs] = await Promise.all([
          api.getAnalytics(org!.id),
          api.listBlobs(org!.id, { limit: '10' }),
        ])
        if (cancelled) return
        setOverview(analytics.overview as unknown as Overview ?? null)
        setRecentBlobs(Array.isArray(blobs) ? blobs : [])
      } catch {
        if (!cancelled) addToast({ type: 'error', title: 'Failed to load analytics' })
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [org, addToast])

  return (
      <div className="flex flex-col gap-6">
        <Breadcrumbs items={[{ label: 'Analytics' }]} />

        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm text-primary">Analytics & usage</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Analytics</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Track storage usage, renewals, and costs over time.
            </p>
          </div>
        </div>

        {loading && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        )}

        {!loading && !overview && (
          <EmptyState
            icon={BarChart3}
            title="No analytics data"
            description="Analytics will appear once you start tracking blobs."
          />
        )}

        {!loading && overview && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {metricConfig.map((m) => {
                const Icon = m.icon
                const value = overview[m.key]
                return (
                  <div
                    key={m.key}
                    className="rounded-2xl border border-border bg-card p-4 transition-colors hover:border-primary/20 sm:p-5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">{m.label}</span>
                      <span className={cn('grid size-8 place-items-center rounded-lg', m.bg)}>
                        <Icon size={15} className={m.color} aria-hidden="true" />
                      </span>
                    </div>
                    <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">
                      {value.toLocaleString()}
                    </p>
                  </div>
                )
              })}
            </div>

            <section aria-labelledby="activity-heading">
              <h2 id="activity-heading" className="mb-4 text-sm font-semibold">Recent blobs</h2>
              {recentBlobs.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border bg-card px-6 py-12 text-center">
                  <Database className="mx-auto text-muted-foreground" size={28} />
                  <p className="mt-3 text-sm text-muted-foreground">No blobs registered yet.</p>
                </div>
              ) : (
                <div className="flex flex-col">
                  {recentBlobs.map((blob: BlobRegistration) => (
                    <div
                      key={blob.id}
                      className="flex items-center gap-3 border-b border-border py-3.5 last:border-0"
                    >
                      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted">
                        <Database size={14} className="text-primary" aria-hidden="true" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{blob.name || blob.blob_id}</p>
                        <p className="text-xs text-muted-foreground">
                          {blob.status}
                          {blob.size_bytes ? ` · ${(blob.size_bytes / 1024).toFixed(1)} KB` : ''}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground/60">
                        {new Date(blob.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
  )
}
