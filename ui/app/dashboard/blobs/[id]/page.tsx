'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { AlertTriangle, ArrowLeft, Clock3, Copy, Database } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Breadcrumbs } from '@/components/ui/breadcrumbs'
import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { PageTransition } from '@/components/dashboard/page-transition'
import { api, type BlobRegistration } from '@/lib/api-client'
import { formatBytes } from '@/lib/utils'

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
      <p className="text-lg font-medium">Blob not found</p>
      <p className="text-sm text-muted-foreground">
        The blob you&apos;re looking for doesn&apos;t exist or has been removed.
      </p>
      <Button variant="outline" render={<Link href="/dashboard/blobs" />}>
        Back to blobs
      </Button>
    </div>
  )
}

export default function BlobDetailPage() {
  const params = useParams()
  const id = params.id as string

  const [blob, setBlob] = useState<BlobRegistration | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    setLoading(true)
    setError(null)
    api.getBlob(id)
      .then((data) => {
        if (!cancelled) setBlob(data)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load blob')
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
          { label: 'Blobs', href: '/dashboard/blobs' },
          { label: blob ? `Blob ${blob.blobId.substring(0, 8)}` : 'Blob' },
        ]} />

        {loading && <LoadingSkeleton />}

        {!loading && error && <ErrorState message={error} onRetry={() => setRetryCount((c) => c + 1)} />}

        {!loading && !error && !blob && <NotFoundState />}

        {!loading && !error && blob && (
          <>
            <Link
              href="/dashboard/blobs"
              className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft size={16} />
              All blobs
            </Link>

            <div className="flex flex-col gap-8">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex items-center gap-2 text-xs text-accent">
                    <span className="size-2 rounded-full bg-accent" />
                    {blob.status}
                  </div>
                  <h1 className="mt-3 text-3xl font-semibold tracking-tight">
                    {blob.name || `Blob ${blob.blobId.substring(0, 8)}`}
                  </h1>
                  <p className="mt-2 flex items-center gap-2 font-mono text-xs text-muted-foreground">
                    {blob.blobId}
                    <Copy size={13} />
                  </p>
                </div>
              </div>

              <section className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
                <div className="rounded-3xl border border-border bg-card p-6 lg:p-8">
                  <div className="flex items-start justify-between">
                    <p className="text-sm text-muted-foreground">Details</p>
                    <Database className="text-muted-foreground" size={20} />
                  </div>

                  <div className="mt-6 space-y-4">
                    <div className="flex items-center justify-between border-b border-border pb-3 text-sm">
                      <span className="text-muted-foreground">Status</span>
                      <Badge variant="outline" className="capitalize">{blob.status}</Badge>
                    </div>
                    <div className="flex items-center justify-between border-b border-border pb-3 text-sm">
                      <span className="text-muted-foreground">Size</span>
                      <span className="font-medium">
                        {blob.sizeBytes != null ? formatBytes(blob.sizeBytes) : '\u2014'}
                      </span>
                    </div>
                    {blob.tags && blob.tags.length > 0 && (
                      <div className="flex items-center justify-between border-b border-border pb-3 text-sm">
                        <span className="text-muted-foreground">Tags</span>
                        <div className="flex flex-wrap gap-1">
                          {blob.tags.map((tag, i) => (
                            <Badge key={i} variant="secondary" className="text-xs">{tag}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  <Info icon={Clock3} label="Created" value={blob.createdAt ? new Date(blob.createdAt).toLocaleString() : '\u2014'} />
                  <Info icon={Clock3} label="Updated" value={blob.updatedAt ? new Date(blob.updatedAt).toLocaleString() : '\u2014'} />
                  {blob.deletedAt && (
                    <Info icon={Clock3} label="Deleted" value={new Date(blob.deletedAt).toLocaleString()} />
                  )}
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
      <p className="mt-3 text-sm font-medium">{value}</p>
    </div>
  )
}
