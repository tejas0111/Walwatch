'use client'

import { useCallback, useEffect, useState } from 'react'
import { Key, Loader2, Plus, Trash2 } from 'lucide-react'
import { api, type ApiKeyEntry } from '@/lib/api-client'
import { useToast } from '@/lib/toast-context'
import { cn, formatDate } from '@/lib/utils'
import { SectionCard } from '@/components/ui/section-card'
import { InlineSkeleton } from '@/components/ui/inline-skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CopyButton } from '@/components/ui/copy-button'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'

export function ApiKeysSection() {
  const { addToast } = useToast()
  const [keys, setKeys] = useState<ApiKeyEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [newKeyPerms, setNewKeyPerms] = useState<Set<string>>(new Set(['read']))
  const [createdKey, setCreatedKey] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [revokingId, setRevokingId] = useState<string | null>(null)

  const fetchKeys = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.listApiKeys()
      setKeys(data)
    } catch {
      addToast({ type: 'error', title: 'Failed to load API keys' })
    } finally {
      setLoading(false)
    }
  }, [addToast])

  useEffect(() => {
    fetchKeys()
  }, [fetchKeys])

  function togglePerm(perm: string) {
    setNewKeyPerms((prev) => {
      const next = new Set(prev)
      if (next.has(perm)) next.delete(perm)
      else next.add(perm)
      return next
    })
  }

  async function handleCreate() {
    if (!newKeyName) return
    setCreating(true)
    try {
      const result = await api.createApiKey({
        name: newKeyName,
        permissions: Array.from(newKeyPerms),
      })
      setCreatedKey(result.key)
      addToast({ type: 'success', title: 'API key created' })
      setNewKeyName('')
      setNewKeyPerms(new Set(['read']))
      await fetchKeys()
    } catch {
      addToast({ type: 'error', title: 'Failed to create API key' })
    } finally {
      setCreating(false)
    }
  }

  async function handleRevoke(id: string) {
    setRevokingId(id)
    try {
      await api.revokeApiKey(id)
      addToast({ type: 'success', title: 'API key revoked' })
      await fetchKeys()
    } catch {
      addToast({ type: 'error', title: 'Failed to revoke API key' })
    } finally {
      setRevokingId(null)
    }
  }

  return (
    <SectionCard
      title="API Keys"
      description="Manage API keys for programmatic access."
      action={
        <Dialog open={createOpen} onOpenChange={(v) => { setCreateOpen(v); if (!v) setCreatedKey(null) }}>
          <DialogTrigger render={<Button size="sm" />}>
            <Plus size={16} /> Create key
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            {createdKey ? (
              <>
                <DialogHeader>
                  <DialogTitle>Key created</DialogTitle>
                  <DialogDescription>
                    Copy your API key now. It will not be shown again.
                  </DialogDescription>
                </DialogHeader>
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
                  <div className="flex items-center gap-2">
                    <code className="flex-1 break-all font-mono text-xs text-amber-500">{createdKey}</code>
                    <CopyButton text={createdKey} />
                  </div>
                </div>
                <DialogFooter>
                  <DialogClose render={<Button />}>Done</DialogClose>
                </DialogFooter>
              </>
            ) : (
              <>
                <DialogHeader>
                  <DialogTitle>Create API key</DialogTitle>
                  <DialogDescription>Generate a new API key for programmatic access.</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="key-name">Name</Label>
                    <Input
                      id="key-name"
                      value={newKeyName}
                      onChange={(e) => setNewKeyName(e.target.value)}
                      placeholder="e.g. CI/CD pipeline"
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label>Permissions</Label>
                    <div className="flex gap-3">
                      {['admin', 'developer', 'viewer', 'billing'].map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => togglePerm(p)}
                          className={cn(
                            'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                            newKeyPerms.has(p)
                              ? 'border-primary bg-primary/10 text-primary'
                              : 'border-border text-muted-foreground hover:text-foreground',
                          )}
                        >
                          <div
                            className={cn(
                              'size-3.5 rounded-sm border transition-colors',
                              newKeyPerms.has(p)
                                ? 'border-primary bg-primary'
                                : 'border-muted-foreground/30',
                            )}
                          />
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
                  <Button onClick={handleCreate} disabled={creating || !newKeyName || newKeyPerms.size === 0}>
                    {creating && <Loader2 size={16} className="animate-spin" />}
                    {creating ? 'Creating...' : 'Create key'}
                  </Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>
      }
    >
      {loading ? (
        <InlineSkeleton lines={4} />
      ) : keys.length === 0 ? (
        <EmptyState icon={Key} title="No API keys" description="Create an API key to access WalWatch programmatically." />
      ) : (
        <div className="-mx-[--card-spacing] px-[--card-spacing]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Permissions</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((k) => (
                <TableRow key={k.id}>
                  <TableCell className="font-medium">{k.name}</TableCell>
                  <TableCell>
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">{k.keyPrefix}</code>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {k.permissions.map((p) => (
                        <Badge key={p} variant="outline" className="text-[10px]">{p}</Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatDate(k.createdAt)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {k.lastUsedAt ? formatDate(k.lastUsedAt) : 'Never'}
                  </TableCell>
                  <TableCell className="text-right">
                      <AlertDialog>
                        <AlertDialogTrigger render={<Button variant="destructive" size="xs" />}>
                          {revokingId === k.id ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Trash2 size={14} />
                          )}
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Revoke API key</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will permanently revoke the API key &quot;{k.name}&quot;. Any applications using it will stop working immediately.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction variant="destructive" onClick={() => handleRevoke(k.id)}>
                              Revoke
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </SectionCard>
  )
}


