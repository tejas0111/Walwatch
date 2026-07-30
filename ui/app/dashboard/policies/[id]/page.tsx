'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { AlertTriangle, ArrowLeft } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Breadcrumbs } from '@/components/ui/breadcrumbs'
import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { PageTransition } from '@/components/dashboard/page-transition'
import { api, type Policy } from '@/lib/api-client'

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      <Skeleton className="h-4 w-24" />
      <div className="flex flex-col gap-5">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-4 w-48" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-24 rounded-2xl" />
      </div>
    </div>
  )
}

function NotFoundState() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20">
      <AlertTriangle size={40} className="text-muted-foreground" />
      <p className="text-lg font-medium">Policy not found</p>
      <p className="text-sm text-muted-foreground">
        The policy you&apos;re looking for doesn&apos;t exist or has been removed.
      </p>
      <Button variant="outline" render={<Link href="/dashboard/policies" />}>
        Back to policies
      </Button>
    </div>
  )
}

export default function PolicyDetailPage() {
  const params = useParams()
  const id = params.id as string

  const [policy, setPolicy] = useState<Policy | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    setLoading(true)
    setError(null)
    api.getPolicy(id)
      .then((data) => {
        if (!cancelled) setPolicy(data)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load policy')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [id, retryCount])

  return (
    <PageTransition>
      <div className="flex flex-col gap-6">
        <Breadcrumbs items={[
          { label: 'Policies', href: '/dashboard/policies' },
          { label: policy ? policy.name : 'Policy' },
        ]} />

        {loading && <LoadingSkeleton />}

        {!loading && error && <ErrorState message={error} onRetry={() => setRetryCount((c) => c + 1)} />}

        {!loading && !error && !policy && <NotFoundState />}

        {!loading && !error && policy && (
          <>
            <Link
              href="/dashboard/policies"
              className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft size={16} />
              All policies
            </Link>

            <div className="flex flex-col gap-6">
              <div className="flex items-start justify-between">
                <div>
                  <div className="mb-2">
                    <Badge variant={policy.active ? 'default' : 'secondary'}>
                      {policy.active ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>
                  <h1 className="text-3xl font-semibold tracking-tight">{policy.name}</h1>
                  {policy.description && (
                    <p className="mt-2 text-sm text-muted-foreground">{policy.description}</p>
                  )}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Info label="Renew Threshold" value={`${policy.renewThreshold} epochs`} />
                <Info label="Renew Extension" value={`${policy.renewExtension} epochs`} />
                {policy.maxTotalEpochs !== undefined && policy.maxTotalEpochs !== null && (
                  <Info label="Max Total Epochs" value={policy.maxTotalEpochs} />
                )}
                <Info label="Created" value={new Date(policy.createdAt).toLocaleString()} />
                {policy.updatedAt && (
                  <Info label="Updated" value={new Date(policy.updatedAt).toLocaleString()} />
                )}
                <Info label="Scope" value={policy.scope ?? 'None'} />
                {policy.scopeTargetId && (
                  <Info label="Scope Target" value={policy.scopeTargetId} />
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </PageTransition>
  )
}

function Info({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-3 text-xl font-semibold">{value}</p>
    </div>
  )
}
