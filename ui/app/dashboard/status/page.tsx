'use client'

import { Activity, AlertTriangle, Check, Clock, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api-client'
import { useToast } from '@/lib/toast-context'

import { Breadcrumbs } from '@/components/ui/breadcrumbs'
import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/ui/error-state'
import { SkeletonCard } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { PageTransition } from '@/components/dashboard/page-transition'

type ServiceStatus = 'ok' | 'connected' | 'degraded' | 'error' | 'unknown' | 'not_configured'

type HealthResponse = {
  status: 'ok' | 'degraded'
  timestamp: string
  uptime: number
  version: string
  db: ServiceStatus
  suiRpc: ServiceStatus
  keeper: ServiceStatus
}

type ServiceCard = {
  name: string
  status: ServiceStatus
  label: string
  dotColor: string
}

function resolveService(status: ServiceStatus): { label: string; dotColor: string; ok: boolean } {
  if (status === 'ok' || status === 'connected') return { label: 'Operational', dotColor: 'bg-accent', ok: true }
  if (status === 'degraded') return { label: 'Degraded', dotColor: 'bg-amber-500', ok: false }
  if (status === 'not_configured') return { label: 'Not configured', dotColor: 'bg-muted-foreground/40', ok: false }
  if (status === 'unknown') return { label: 'Unknown', dotColor: 'bg-muted-foreground/40', ok: false }
  return { label: 'Error', dotColor: 'bg-destructive', ok: false }
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hrs = Math.floor((seconds % 86400) / 3600)
  if (days > 0) return `${days}d ${hrs}h`
  return `${hrs}h ${Math.floor((seconds % 3600) / 60)}m`
}

const REFRESH_INTERVAL = 30_000

export default function StatusPage() {
  const { addToast } = useToast()
  const [loading, setLoading] = useState(true)
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [lastChecked, setLastChecked] = useState<Date | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchHealth = useCallback(async () => {
    setError(null)
    try {
      const data = await api.getHealth()
      setHealth((data ?? {}) as HealthResponse)
      setLastChecked(new Date())
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch system status'
      setError(msg)
      addToast({ type: 'error', title: msg })
    } finally {
      setLoading(false)
    }
  }, [addToast])

  useEffect(() => {
    fetchHealth()
    intervalRef.current = setInterval(fetchHealth, REFRESH_INTERVAL)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [fetchHealth])

  const services: ServiceCard[] = health ? [
    { name: 'API Server', status: ((health.status === 'ok' ? 'ok' : 'error')) as ServiceStatus, label: '', dotColor: '' },
    { name: 'Database', status: (health.db || 'unknown') as ServiceStatus, label: '', dotColor: '' },
    { name: 'Sui RPC', status: (health.suiRpc || 'unknown') as ServiceStatus, label: '', dotColor: '' },
    { name: 'Keeper Service', status: (health.keeper || 'unknown') as ServiceStatus, label: '', dotColor: '' },
  ].map((s) => {
    const resolved = resolveService(s.status)
    return { ...s, label: resolved.label, dotColor: resolved.dotColor }
  }) : []

  const allOperational = health
    ? ['ok', 'connected', 'not_configured'].includes(health.status) &&
      ['ok', 'connected', 'not_configured', 'unknown'].includes(health.db) &&
      ['ok', 'connected', 'not_configured', 'unknown'].includes(health.suiRpc) &&
      ['ok', 'connected', 'not_configured', 'unknown'].includes(health.keeper)
    : false

  return (
    <PageTransition>
      <div className="flex flex-col gap-6">
      <Breadcrumbs items={[{ label: 'System status' }]} />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-primary">System health</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Status</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Real-time status of Walwatch services and infrastructure.
          </p>
        </div>
      </div>

      {loading && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      )}

      {!loading && error && <ErrorState message={error} onRetry={fetchHealth} />}

      {!loading && !error && health && (
        <>
          <div className={cn(
            'flex items-center gap-4 rounded-3xl border px-6 py-5',
            allOperational ? 'border-accent/30 bg-accent/5' : 'border-amber-500/30 bg-amber-500/5',
          )}>
            <span className={cn(
              'grid size-12 shrink-0 place-items-center rounded-2xl',
              allOperational ? 'bg-accent/15' : 'bg-amber-500/15',
            )}>
              {allOperational ? (
                <Check size={24} className="text-accent" aria-hidden="true" />
              ) : (
                <AlertTriangle size={24} className="text-amber-500" aria-hidden="true" />
              )}
            </span>
            <div>
              <p className="text-lg font-semibold">
                {allOperational ? 'All systems operational' : 'Some systems degraded'}
              </p>
              <p className="text-sm text-muted-foreground">
                {lastChecked
                  ? `Last checked ${lastChecked.toLocaleTimeString()}`
                  : 'Checking...'}
                {health.uptime > 0 && ` · Uptime ${formatUptime(health.uptime)}`}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchHealth}
              className="ml-auto shrink-0"
              aria-label="Refresh status"
            >
              <RefreshCw data-icon="inline-start" />
              Refresh
            </Button>
          </div>

          <section aria-labelledby="services-heading">
            <h2 id="services-heading" className="mb-4 text-sm font-semibold">Services</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {services.map((s, i) => (
                <div
                  key={s.name}
                  className="flex items-center justify-between rounded-2xl border border-border bg-card p-4 transition-colors hover:border-primary/20 sm:p-5"
                >
                  <div className="flex items-center gap-3">
                    <span className={cn('size-2.5 rounded-full', s.dotColor)} aria-hidden="true" />
                    <div>
                      <p className="text-sm font-medium">{s.name}</p>
                      <p className="text-xs text-muted-foreground">{s.label}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section aria-labelledby="version-heading">
            <h2 id="version-heading" className="mb-4 text-sm font-semibold">System info</h2>
            <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <p className="text-xs text-muted-foreground">Version</p>
                  <p className="mt-1 text-sm font-medium">{health.version || '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Uptime</p>
                  <p className="mt-1 text-sm font-medium">{health.uptime > 0 ? formatUptime(health.uptime) : '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Last check</p>
                  <p className="mt-1 text-sm font-medium">{lastChecked ? lastChecked.toLocaleTimeString() : '—'}</p>
                </div>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
    </PageTransition>
  )
}
