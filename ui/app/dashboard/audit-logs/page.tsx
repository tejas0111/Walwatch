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
import { api } from '@/lib/api-client'
import { useAuth } from '@/lib/auth-provider'
import { useToast } from '@/lib/toast-context'

import { Breadcrumbs } from '@/components/ui/breadcrumbs'
import { EmptyState } from '@/components/ui/empty-state'
import { Pagination } from '@/components/ui/pagination'
import { SkeletonTable } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

type LogAction = 'create' | 'update' | 'delete'
type ResourceType = 'org' | 'project' | 'blob' | 'vault' | 'policy' | 'wallet' | 'alert' | 'billing' | string

type AuditLogEntry = {
  id: string
  user_id: string
  action: string
  resource_type: string
  resource_id?: string
  details?: Record<string, unknown>
  description?: string
  ip_address?: string
  created_at: string
}

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

  const fetchLogs = useCallback(async () => {
    if (!org) return
    setLoading(true)
    try {
      const params: Record<string, string> = { page: String(page), limit: String(PAGE_SIZE) }
      if (actionFilter) params.action = actionFilter
      if (resourceFilter) params.resource_type = resourceFilter

      const response = await api.listAuditLogs(org.id, params) as Record<string, unknown> | AuditLogEntry[]
      const logList = (Array.isArray(response) ? response : ((response as Record<string, unknown>)?.logs || (response as Record<string, unknown>)?.auditLogs || [])) as AuditLogEntry[]
      const totalCount = Array.isArray(response) ? logList.length : ((response as Record<string, unknown>)?.total as number ?? logList.length)

      const filtered = query
        ? logList.filter((l: AuditLogEntry) =>
            l.action.toLowerCase().includes(query.toLowerCase()) ||
            l.resource_type.toLowerCase().includes(query.toLowerCase()) ||
            l.description?.toLowerCase().includes(query.toLowerCase()) ||
            l.user_id.toLowerCase().includes(query.toLowerCase()),
          )
        : logList

      setLogs(query ? filtered : logList)
      setTotal(query ? filtered.length : totalCount)
    } catch {
      addToast({ type: 'error', title: 'Failed to load audit logs' })
    } finally {
      setLoading(false)
    }
  }, [org, page, actionFilter, resourceFilter, query, addToast])

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

        <label className="flex max-w-lg items-center gap-2 rounded-xl border border-input bg-card px-3 transition-colors focus-within:border-ring">
          <Search size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="sr-only">Search logs</span>
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(1) }}
            placeholder="Search by action, resource, or user…"
            className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
            aria-label="Search audit logs"
          />
          {query && (
            <button onClick={() => { setQuery(''); setPage(1) }} className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground" aria-label="Clear search">
              <X size={14} />
            </button>
          )}
        </label>

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="action-filter" className="text-[11px] font-medium text-muted-foreground">Action</label>
            <select
              id="action-filter"
              value={actionFilter}
              onChange={(e) => { setActionFilter(e.target.value); setPage(1) }}
              className="h-9 rounded-lg border border-input bg-card px-3 text-xs outline-none focus:ring-2 focus:ring-ring/40"
            >
              <option value="">All actions</option>
              <option value="create">Create</option>
              <option value="update">Update</option>
              <option value="delete">Delete</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="resource-filter" className="text-[11px] font-medium text-muted-foreground">Resource</label>
            <select
              id="resource-filter"
              value={resourceFilter}
              onChange={(e) => { setResourceFilter(e.target.value); setPage(1) }}
              className="h-9 rounded-lg border border-input bg-card px-3 text-xs outline-none focus:ring-2 focus:ring-ring/40"
            >
              <option value="">All resources</option>
              {Object.entries(resourceLabels).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>
          {(actionFilter || resourceFilter) && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs transition-colors hover:bg-muted/60"
              aria-label="Clear all filters"
            >
              <SlidersHorizontal size={13} aria-hidden="true" />
              Clear filters
            </button>
          )}
        </div>

        {loading && <SkeletonTable rows={5} />}

        {!loading && logs.length === 0 && (
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
                          {new Date(entry.created_at).toLocaleString()}
                        </td>
                        <td className="px-5 py-3.5">
                          <span className="grid size-7 place-items-center rounded-full bg-muted text-[10px] font-medium">
                            {entry.user_id.slice(0, 2).toUpperCase()}
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
                              {resourceLabels[entry.resource_type] || entry.resource_type}
                            </span>
                            {entry.resource_id && (
                              <p className="text-xs font-mono text-muted-foreground/60">{entry.resource_id.slice(0, 8)}…</p>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-3.5 font-mono text-xs text-muted-foreground">
                          {entry.ip_address || '—'}
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
                        {resourceLabels[entry.resource_type] || entry.resource_type}
                      </span>
                      <span className={cn('flex items-center gap-1 text-xs font-medium', actionColors[cat])}>
                        <ActionIcon size={13} aria-hidden="true" />
                        {formatAction(entry.action)}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                      <span className="font-mono">{new Date(entry.created_at).toLocaleString()}</span>
                      <span>{entry.ip_address || '—'}</span>
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
  )
}
