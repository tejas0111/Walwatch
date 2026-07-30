'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { AlertTriangle, ArrowLeft, Calendar, Clock, Layers, Tag } from 'lucide-react'

import { Breadcrumbs } from '@/components/ui/breadcrumbs'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/ui/error-state'
import { PageTransition } from '@/components/dashboard/page-transition'
import { api } from '@/lib/api-client'

import type { Project } from '@/lib/api-client'

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      <Skeleton className="h-4 w-24" />
      <div className="space-y-3">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-4 w-48" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
      <p className="text-lg font-medium">Project not found</p>
      <p className="text-sm text-muted-foreground">
        The project you&apos;re looking for doesn&apos;t exist or has been removed.
      </p>
      <Button variant="outline" render={<Link href="/dashboard/projects" />}>
        Back to projects
      </Button>
    </div>
  )
}

function InfoCard({ icon: Icon, label, value }: { icon: typeof Calendar; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon size={15} />
        {label}
      </div>
      <p className="mt-3 text-xl font-semibold">{value}</p>
    </div>
  )
}

export default function ProjectDetailPage() {
  const params = useParams()
  const id = params.id as string

  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    setLoading(true)
    setError(null)
    api.getProject(id)
      .then((data) => {
        if (!cancelled) setProject(data)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load project')
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
          { label: 'Projects', href: '/dashboard/projects' },
          { label: project ? project.name : 'Project' },
        ]} />

        {loading && <LoadingSkeleton />}

        {!loading && error && <ErrorState message={error} onRetry={() => setRetryCount((c) => c + 1)} />}

        {!loading && !error && !project && <NotFoundState />}

        {!loading && !error && project && (
          <>
            <Link
              href="/dashboard/projects"
              className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft size={16} />
              All projects
            </Link>

            <div className="flex flex-col gap-8">
              <div className="flex flex-col gap-1">
                <h1 className="text-3xl font-semibold tracking-tight">{project.name}</h1>
                <p className="text-sm text-muted-foreground">{project.slug}</p>
              </div>

              {project.description && (
                <p className="text-sm text-muted-foreground">{project.description}</p>
              )}

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <InfoCard
                  icon={Tag}
                  label="Environment"
                  value={project.environment || '\u2014'}
                />
                <InfoCard
                  icon={Layers}
                  label="Blob Count"
                  value={project.blobCount != null ? String(project.blobCount) : '\u2014'}
                />
                <InfoCard
                  icon={Calendar}
                  label="Created"
                  value={new Date(project.createdAt).toLocaleDateString()}
                />
                {project.updatedAt && (
                  <InfoCard
                    icon={Clock}
                    label="Updated"
                    value={new Date(project.updatedAt).toLocaleDateString()}
                  />
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </PageTransition>
  )
}
