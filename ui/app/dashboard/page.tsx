'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { AlertCircle, Database, Plus, RefreshCw, Shield, Wallet } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { SkeletonCard } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/lib/auth-provider'
import { useToast } from '@/lib/toast-context'
import { cn, formatBytes } from '@/lib/utils'
import { useDashboardSummary, useRecentBlobs } from '@/hooks/use-dashboard'
import { PageTransition } from '@/components/dashboard/page-transition'

export default function DashboardPage() {
  const router = useRouter()
  const { org } = useAuth()
  const { addToast } = useToast()
  const { data: summaryRes, isLoading, error, refetch } = useDashboardSummary(org?.id ?? '')
  const { data: blobsRes, error: blobsError } = useRecentBlobs(org?.id ?? '')

  const errorMessage = error instanceof Error ? error.message : null

  const recentBlobs = Array.isArray(blobsRes) ? blobsRes.slice(0, 5) : []

  useEffect(() => {
    if (error) {
      addToast({ type: 'error', title: 'Failed to load dashboard', description: error instanceof Error ? error.message : 'Unknown error' })
    }
    if (blobsError) {
      addToast({ type: 'error', title: 'Failed to load recent blobs', description: blobsError instanceof Error ? blobsError.message : 'Unknown error' })
    }
  }, [error, blobsError, addToast])

  const metrics = [
    { icon: Database, label: 'Total blobs', value: summaryRes?.storageUnderManagement.totalBlobs ?? 0 },
    { icon: RefreshCw, label: 'Healthy', value: summaryRes?.blobsByHealth.healthy ?? 0 },
    { icon: AlertCircle, label: 'At risk', value: summaryRes?.blobsByHealth.atRisk ?? 0 },
    { icon: Shield, label: 'Renewals', value: summaryRes?.recentSpend.renewalCount ?? 0 },
    { icon: Wallet, label: 'Total cost', value: summaryRes?.recentSpend.totalCost != null ? `$${summaryRes.recentSpend.totalCost.toFixed(2)}` : '$0.00' },
  ]

  return (
    <PageTransition>
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
              <Button variant="outline" size="sm" className="min-h-11 sm:min-h-9">
<Database data-icon="inline-start" />
                View Blobs
              </Button>
            </Link>
            <Link href="/dashboard/wallets">
              <Button variant="outline" size="sm" className="min-h-11 sm:min-h-9">
                <Wallet data-icon="inline-start" />
                Wallets
              </Button>
            </Link>
          </div>
      </div>

      {/* Error */}
      {errorMessage && (
        <Alert variant="destructive">
          <AlertCircle size={16} />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => refetch()}>
            Retry
          </Button>
        </Alert>
      )}

      {/* Metrics */}
      {isLoading ? (
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
      {!isLoading && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Recent Blobs</h2>
            <Link href="/dashboard/blobs">
              <Button variant="ghost" size="sm">View all</Button>
            </Link>
          </div>
          {recentBlobs.length === 0 ? (
            <EmptyState
              icon={Database}
              title="Welcome to WalWatch!"
              description="Start by adding your first blob to begin tracking storage and renewals."
              action={{ label: 'Add your first blob', onClick: () => router.push('/dashboard/blobs') }}
            />
          ) : (
            <>
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
                          <td className="px-5 py-3 font-medium">{b.name || b.blobId}</td>
                          <td className="px-5 py-3">
                            <Badge
                              variant={
                                b.status === 'active' ? 'default' :
                                b.status === 'expiring' ? 'secondary' :
                                b.status === 'expired' ? 'destructive' : 'outline'
                              }
                            >
                              {b.status}
                            </Badge>
                          </td>
                          <td className="px-5 py-3 text-muted-foreground">
                            {b.sizeBytes != null ? formatBytes(b.sizeBytes) : '—'}
                          </td>
                          <td className="px-5 py-3 text-muted-foreground hidden sm:table-cell">
                            {b.createdAt ? new Date(b.createdAt).toLocaleDateString() : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              <div className="flex flex-col gap-3 sm:hidden">
                {recentBlobs.map((b) => (
                  <div
                    key={b.id}
                    className="rounded-2xl border border-border bg-card p-4"
                  >
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{b.name || b.blobId}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {b.sizeBytes != null ? formatBytes(b.sizeBytes) : '—'} · {b.createdAt ? new Date(b.createdAt).toLocaleDateString() : '—'}
                        </p>
                      </div>
                      <Badge
                        variant={
                          b.status === 'active' ? 'default' :
                          b.status === 'expiring' ? 'secondary' :
                          b.status === 'expired' ? 'destructive' : 'outline'
                        }
                      >
                        {b.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Quick actions */}
      {!isLoading && recentBlobs.length > 0 && (
        <div className="flex flex-wrap gap-3">
          <Link href="/dashboard/new">
            <Button size="sm" className="min-h-11 sm:min-h-9">
              <Plus data-icon="inline-start" />
              New Vault
            </Button>
          </Link>
          <Link href="/dashboard/blobs">
            <Button variant="outline" size="sm" className="min-h-11 sm:min-h-9">
              <Database data-icon="inline-start" />
              Add Blob
            </Button>
          </Link>
          <Link href="/dashboard/policies">
            <Button variant="outline" size="sm" className="min-h-11 sm:min-h-9">
              <Shield data-icon="inline-start" />
              View Policies
            </Button>
          </Link>
        </div>
      )}
    </div>
    </PageTransition>
  )
}
