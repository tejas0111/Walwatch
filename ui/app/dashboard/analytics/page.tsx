'use client'

import { BarChart3, Coins, Database, Folder, RefreshCw, Shield } from 'lucide-react'
import type { BlobRegistration } from '@/lib/api-client'
import { useAuth } from '@/lib/auth-provider'
import { useAnalytics } from '@/hooks/use-analytics'
import { useRecentBlobs } from '@/hooks/use-dashboard'

import { Badge } from '@/components/ui/badge'
import { Breadcrumbs } from '@/components/ui/breadcrumbs'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { SkeletonCard } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { PageTransition } from '@/components/dashboard/page-transition'

const metricConfig = [
  { key: 'totalBlobs' as const, label: 'Total Blobs', icon: Database, color: 'text-primary', bg: 'bg-primary/10' },
  { key: 'activeBlobs' as const, label: 'Active Blobs', icon: RefreshCw, color: 'text-accent', bg: 'bg-accent/10' },
  { key: 'totalProjects' as const, label: 'Projects', icon: Folder, color: 'text-chart-3', bg: 'bg-chart-3/10' },
  { key: 'totalPolicies' as const, label: 'Policies', icon: Shield, color: 'text-amber-500', bg: 'bg-amber-500/10' },
  { key: 'totalWallets' as const, label: 'Wallets', icon: Coins, color: 'text-primary', bg: 'bg-primary/10' },
]

export default function AnalyticsPage() {
  const { org } = useAuth()

  const { data: overview, isLoading, error, refetch } = useAnalytics(org?.id ?? '')
  const { data: recentBlobs = [] } = useRecentBlobs(org?.id ?? '', 10)

  return (
    <PageTransition>
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

      {isLoading && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      )}

      {!isLoading && error && (
        <ErrorState message={error instanceof Error ? error.message : 'Failed to load analytics'} onRetry={refetch} />
      )}

      {!isLoading && !error && !overview && (
        <EmptyState
          icon={BarChart3}
          title="No analytics data"
          description="Analytics will appear once you start tracking blobs."
        />
      )}

      {!isLoading && !error && overview && (
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
              <EmptyState
                icon={Database}
                title="No blobs registered yet."
                description=""
              />
            ) : (
              <>
                <div className="hidden sm:flex flex-col">
                  {recentBlobs.map((blob: BlobRegistration) => (
                    <div
                      key={blob.id}
                      className="flex items-center gap-3 border-b border-border py-3.5 last:border-0"
                    >
                      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted">
                        <Database size={14} className="text-primary" aria-hidden="true" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{blob.name || blob.blobId}</p>
                        <p className="text-xs text-muted-foreground">
                          {blob.status}
                          {blob.sizeBytes ? ` · ${(blob.sizeBytes / 1024).toFixed(1)} KB` : ''}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground/60">
                        {new Date(blob.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="flex flex-col gap-3 sm:hidden">
                  {recentBlobs.map((blob: BlobRegistration) => (
                    <div
                      key={blob.id}
                      className="rounded-2xl border border-border bg-card p-4"
                    >
                      <div className="flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{blob.name || blob.blobId}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {blob.sizeBytes ? `${(blob.sizeBytes / 1024).toFixed(1)} KB` : '—'} · {new Date(blob.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                        <Badge
                          variant={
                            blob.status === 'active' ? 'default' :
                            blob.status === 'expiring' ? 'secondary' :
                            blob.status === 'expired' ? 'destructive' : 'outline'
                          }
                        >
                          {blob.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        </>
      )}
    </div>
    </PageTransition>
  )
}
