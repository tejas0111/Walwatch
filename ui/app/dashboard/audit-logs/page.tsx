'use client'

import {
  Edit,
  FileText,
  PlusCircle,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api, type AuditLogEntry } from '@/lib/api-client'
import { useAuth } from '@/lib/auth-provider'
import { useToast } from '@/lib/toast-context'

import { Breadcrumbs } from '@/components/ui/breadcrumbs'
import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/ui/error-state'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Pagination } from '@/components/ui/pagination'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectGroup, SelectValue } from '@/components/ui/select'
import { SkeletonTable } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { PageTransition } from '@/components/dashboard/page-transition'

type LogAction = 'create' | 'update' | 'delete'
type ResourceType = 'org' | 'project' | 'blob' | 'vault' | 'policy' | 'wallet' | 'alert' | 'billing' | string

const PAGE_SIZE = 10

const actionIcons: Record<string, typeof PlusCircle> = { create: PlusCircle, update: Edit, delete: Trash2 }
const actionColors: Record<string, string> = { create: 'text-accent', update: 'text-primary', delete: 'text-destructive' }

function getActionCategory(action: string): LogAction {
  if (action.includes('create') || action.includes('created') || action.includes('invited')) return 'create'
  if (action.includes('delete') || action.includes('deleted') || action.includes('removed') || action.includes('revoked')) return 'delete'
  return 'update'
}

function formatAction(action: string): string {
  return action.split('.').pop()?.replace(/_/g, ' ') || action
}

const resourceLabels: Record<string, string> = {
  organization: 'Organization', project: 'Project', blob: 'Blob', vault: 'Vault',
  policy: 'Policy', wallet: 'Wallet', alert: 'Alert', billing: 'Billing',
  subscription: 'Subscription', 'api-key': 'API Key',
}

export default function AuditLogsPage() {
  const { org } = useAuth()
  const { addToast } = useToast()
  const [loading, setLoading] = useState(true)
  const [logs, setLogs] = useState<AuditLogEntry[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [actionFilter, setActionFilter] = useState('')
  const [resourceFilter, setResourceFilter] = useState('')
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params: Record<string, string> = { page: String(page), limit: String(PAGE_SIZE) }
      if (actionFilter) params.action = actionFilter
      if (resourceFilter) params.resourceType = resourceFilter

      const logList = await api.listAuditLogs(params)

      const filtered = query
        ? logList.filter((l: AuditLogEntry) =>
            l.action.toLowerCase().includes(query.toLowerCase()) ||
            l.resourceType.toLowerCase().includes(query.toLowerCase()) ||
            l.description?.toLowerCase().includes(query.toLowerCase()) ||
            l.userId.toLowerCase().includes(query.toLowerCase()),
          )
        : logList

      setLogs(query ? filtered : logList)
      setTotal(query ? filtered.length : logList.length)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load audit logs'
      setError(msg)
      addToast({ type: 'error', title: msg })
    } finally {
      setLoading(false)
    }
  }, [page, actionFilter, resourceFilter, query, addToast])

  useEffect(() => { fetchLogs() }, [fetchLogs])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)

  const clearFilters = () => {
    setQuery('')
    setActionFilter('')
    setResourceFilter('')
    setPage(1)
  }

  return (
    <PageTransition>
      <div className="flex flex-col gap-6">
      <Breadcrumbs items={[{ label: 'Audit logs' }]} />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-primary">Audit trail</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Audit logs</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Track every action across your organization.
          </p>
        </div>
      </div>

      <div className="relative flex max-w-lg flex-1 items-center">
        <Search size={16} className="absolute left-3 text-muted-foreground" aria-hidden="true" />
        <Input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setPage(1) }}
          placeholder="Search by action, resource, or user…"
          className="pl-9"
          aria-label="Search audit logs"
        />
        {query && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setQuery(''); setPage(1) }}
            className="absolute right-3"
            aria-label="Clear search"
          >
            <X data-icon="inline-start" />
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium text-muted-foreground">Action</span>
          <Select value={actionFilter} onValueChange={(v) => { setActionFilter(v ?? ''); setPage(1) }}>
            <SelectTrigger className="h-9 text-xs min-w-28">
              <SelectValue placeholder="All actions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All actions</SelectItem>
              <SelectItem value="create">Create</SelectItem>
              <SelectItem value="update">Update</SelectItem>
              <SelectItem value="delete">Delete</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium text-muted-foreground">Resource</span>
          <Select value={resourceFilter} onValueChange={(v) => { setResourceFilter(v ?? ''); setPage(1) }}>
            <SelectTrigger className="h-9 text-xs min-w-36">
              <SelectValue placeholder="All resources" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All resources</SelectItem>
              {Object.entries(resourceLabels).map(([key, label]) => (
                <SelectItem key={key} value={key}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {(actionFilter || resourceFilter) && (
          <Button variant="outline" size="sm" onClick={clearFilters} aria-label="Clear all filters">
            <SlidersHorizontal aria-hidden="true" />
            Clear filters
          </Button>
        )}
      </div>

      {loading && <SkeletonTable rows={5} />}

      {!loading && error && <ErrorState message={error} onRetry={fetchLogs} />}

      {!loading && !error && logs.length === 0 && (
        <EmptyState
          icon={FileText}
          title="No audit logs found"
          description={
            query || actionFilter || resourceFilter
              ? 'No logs match your search or filter criteria.'
              : 'No audit logs recorded yet.'
          }
          action={query || actionFilter || resourceFilter
            ? { label: 'Clear all filters', onClick: clearFilters }
            : undefined
          }
        />
      )}

      {!loading && logs.length > 0 && (
        <>
          <div className="hidden overflow-hidden rounded-2xl border border-border bg-card sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Timestamp</th>
                  <th className="px-5 py-3 font-medium">User</th>
                  <th className="px-5 py-3 font-medium">Action</th>
                  <th className="px-5 py-3 font-medium">Resource</th>
                  <th className="px-5 py-3 font-medium">IP address</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((entry) => {
                  const cat = getActionCategory(entry.action)
                  const ActionIcon = actionIcons[cat]
                  return (
                    <tr key={entry.id} className="border-b border-border transition-colors last:border-0 hover:bg-muted/30">
                      <td className="whitespace-nowrap px-5 py-3.5 font-mono text-xs text-muted-foreground">
                        {new Date(entry.createdAt).toLocaleString()}
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="grid size-7 place-items-center rounded-full bg-muted text-[10px] font-medium">
                          {entry.userId.slice(0, 2).toUpperCase()}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={cn('flex items-center gap-1.5 text-xs font-medium', actionColors[cat])}>
                          <ActionIcon size={14} aria-hidden="true" />
                          {formatAction(entry.action)}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <div>
                          <span className="text-xs text-muted-foreground">
                            {resourceLabels[entry.resourceType] || entry.resourceType}
                          </span>
                          {entry.resourceId && (
                            <p className="text-xs font-mono text-muted-foreground/60">{entry.resourceId.slice(0, 8)}…</p>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-3.5 font-mono text-xs text-muted-foreground">
                        {entry.ipAddress || '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-3 sm:hidden">
            {logs.map((entry) => {
              const cat = getActionCategory(entry.action)
              const ActionIcon = actionIcons[cat]
              return (
                <div key={entry.id} className="rounded-2xl border border-border bg-card p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {resourceLabels[entry.resourceType] || entry.resourceType}
                    </span>
                    <span className={cn('flex items-center gap-1 text-xs font-medium', actionColors[cat])}>
                      <ActionIcon size={13} aria-hidden="true" />
                      {formatAction(entry.action)}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span className="font-mono">{new Date(entry.createdAt).toLocaleString()}</span>
                    <span>{entry.ipAddress || '—'}</span>
                  </div>
                </div>
              )
            })}
          </div>

          <Pagination
            page={safePage}
            totalPages={totalPages}
            totalItems={total}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
    </PageTransition>
  )
}
