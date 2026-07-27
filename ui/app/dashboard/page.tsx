'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { AlertCircle, Database, Plus, RefreshCw, Shield, Wallet, FileText } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'
import { SkeletonCard } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/lib/auth-provider'
import { useToast } from '@/lib/toast-context'
import { api, type BlobRegistration } from '@/lib/api-client'
import { cn, formatBytes } from '@/lib/utils'

type AnalyticsOverview = {
  totalBlobs?: number
  activeBlobs?: number
  totalProjects?: number
  totalPolicies?: number
  totalWallets?: number
  [key: string]: string | number | boolean | undefined
}

export default function DashboardPage() {
  const { org } = useAuth()
  const { addToast } = useToast()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [analytics, setAnalytics] = useState<AnalyticsOverview | null>(null)
  const [recentBlobs, setRecentBlobs] = useState<BlobRegistration[]>([])

  useEffect(() => {
    if (!org?.id) return
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [analyticsRes, blobsRes] = await Promise.all([
          api.getAnalytics(org!.id),
          api.listBlobs(org!.id, { limit: 5 }),
        ])
        if (cancelled) return
        setAnalytics(analyticsRes?.overview as unknown as AnalyticsOverview ?? {})
        setRecentBlobs(Array.isArray(blobsRes) ? blobsRes.slice(0, 5) : [])
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to load dashboard data'
        if (cancelled) return
        setError(msg)
        addToast({ type: 'error', title: 'Failed to load dashboard', description: msg })
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [org?.id, addToast])

  const metrics = [
    { icon: Database, label: 'Total blobs', value: analytics?.totalBlobs ?? 0 },
    { icon: RefreshCw, label: 'Active blobs', value: analytics?.activeBlobs ?? 0 },
    { icon: FileText, label: 'Projects', value: analytics?.totalProjects ?? 0 },
    { icon: Shield, label: 'Policies', value: analytics?.totalPolicies ?? 0 },
    { icon: Wallet, label: 'Wallets', value: analytics?.totalWallets ?? 0 },
  ]

  return (
      <div className="flex flex-col gap-8">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm text-primary">Overview</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Dashboard</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Monitor your storage, renewals, and wallet balances at a glance.
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/dashboard/blobs">
              <Button variant="outline" size="sm">
                <Database size={15} />
                View Blobs
              </Button>
            </Link>
            <Link href="/dashboard/wallets">
              <Button variant="outline" size="sm">
                <Wallet size={15} />
                Wallets
              </Button>
            </Link>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive" role="alert">
            <AlertCircle size={16} />
            <span>{error}</span>
            <Button variant="ghost" size="sm" className="ml-auto" onClick={() => window.location.reload()}>
              Retry
            </Button>
          </div>
        )}

        {/* Metrics */}
        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {metrics.map((m) => (
              <Card key={m.label}>
                <CardContent className="flex items-center gap-4">
                  <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                    <m.icon size={18} />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{m.label}</p>
                    <p className="text-2xl font-semibold tracking-tight">{m.value}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Recent blobs */}
        {!loading && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Recent Blobs</h2>
              <Link href="/dashboard/blobs">
                <Button variant="ghost" size="sm">View all</Button>
              </Link>
            </div>
            {recentBlobs.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-border bg-card px-6 py-16 text-center">
                <Database className="mx-auto text-muted-foreground" size={32} />
                <h3 className="mt-5 font-semibold">Welcome to WalWatch!</h3>
                <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
                  Start by adding your first blob to begin tracking storage and renewals.
                </p>
                <Link href="/dashboard/blobs" className="mt-6 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90">
                  <Plus size={16} />
                  Add your first blob
                </Link>
              </div>
            ) : (
              <Card>
                <div className="overflow-x-auto rounded-xl">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted-foreground">
                        <th className="px-5 py-3 font-medium">Name</th>
                        <th className="px-5 py-3 font-medium">Status</th>
                        <th className="px-5 py-3 font-medium">Size</th>
                        <th className="px-5 py-3 font-medium hidden sm:table-cell">Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentBlobs.map((b) => (
                        <tr key={b.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                          <td className="px-5 py-3 font-medium">{b.name || b.blob_id}</td>
                          <td className="px-5 py-3">
                            <span className={cn(
                              'rounded-md px-2 py-0.5 text-[11px] font-medium',
                              b.status === 'active' && 'bg-primary/10 text-primary',
                              b.status === 'expiring' && 'bg-amber-500/10 text-amber-500',
                              b.status === 'expired' && 'bg-destructive/10 text-destructive',
                              b.status !== 'active' && b.status !== 'expiring' && b.status !== 'expired' && 'bg-muted text-muted-foreground',
                            )}>
                              {b.status}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-muted-foreground">
                            {b.size_bytes != null ? formatBytes(b.size_bytes) : '—'}
                          </td>
                          <td className="px-5 py-3 text-muted-foreground hidden sm:table-cell">
                            {b.created_at ? new Date(b.created_at).toLocaleDateString() : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </div>
        )}

        {/* Quick actions */}
        {!loading && recentBlobs.length > 0 && (
          <div className="flex flex-wrap gap-3">
            <Link href="/dashboard/new">
              <Button size="sm">
                <Plus size={15} />
                New Vault
              </Button>
            </Link>
            <Link href="/dashboard/blobs">
              <Button variant="outline" size="sm">
                <Database size={15} />
                Add Blob
              </Button>
            </Link>
            <Link href="/dashboard/policies">
              <Button variant="outline" size="sm">
                <Shield size={15} />
                View Policies
              </Button>
            </Link>
          </div>
        )}
      </div>
  )
}


