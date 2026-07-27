'use client'

import { AnimatePresence, motion } from 'framer-motion'
import {
  Check,
  Copy,
  Key,
  Loader2,
  Plus,
  Shield,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api, type OrgMember, type ApiKey } from '@/lib/api-client'
import { useAuth } from '@/lib/auth-provider'
import { useToast } from '@/lib/toast-context'

import { Breadcrumbs } from '@/components/ui/breadcrumbs'
import { EmptyState } from '@/components/ui/empty-state'
import { SkeletonTable } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

type TeamMember = {
  userId: string
  email: string
  name: string
  role: string
  joinedAt: string
}

type ApiKeyEntry = {
  id: string
  name: string
  keyPrefix: string
  permissions: string[]
  expiresAt?: string
  lastUsedAt?: string
  createdAt: string
}

const roleColors: Record<string, string> = {
  owner: 'bg-amber-500/10 text-amber-500',
  admin: 'bg-primary/10 text-primary',
  developer: 'bg-accent/10 text-accent',
  viewer: 'bg-muted text-muted-foreground',
  billing: 'bg-chart-3/10 text-chart-3',
}

const permissionOptions = [
  { id: 'admin', label: 'Admin', desc: 'Full access to all resources' },
  { id: 'developer', label: 'Developer', desc: 'Manage vaults, blobs, and policies' },
  { id: 'viewer', label: 'Viewer', desc: 'Read-only access to all data' },
  { id: 'billing', label: 'Billing', desc: 'Manage billing and invoices' },
]

export default function AuthPage() {
  const { org } = useAuth()
  const { addToast } = useToast()
  const [loading, setLoading] = useState(true)
  const [members, setMembers] = useState<TeamMember[]>([])
  const [apiKeys, setApiKeys] = useState<ApiKeyEntry[]>([])

  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('viewer')
  const [inviting, setInviting] = useState(false)

  const [showCreateKeyModal, setShowCreateKeyModal] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [newKeyPerms, setNewKeyPerms] = useState<string[]>([])
  const [createdKey, setCreatedKey] = useState('')
  const [creatingKey, setCreatingKey] = useState(false)
  const [copied, setCopied] = useState(false)

  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    if (!org) return
    setLoading(true)
    try {
      const [membersRes, keysRes] = await Promise.all([
        api.listMembers(org.id),
        api.listApiKeys(org.id),
      ])
      const m = ((membersRes as unknown as Record<string, unknown>)?.members as OrgMember[]) || (Array.isArray(membersRes) ? membersRes : [])
      setMembers(m as unknown as TeamMember[])
      const k = ((keysRes as unknown as Record<string, unknown>)?.apiKeys as ApiKey[]) || (Array.isArray(keysRes) ? keysRes : [])
      setApiKeys(k as unknown as ApiKeyEntry[])
    } catch {
      addToast({ type: 'error', title: 'Failed to load team data' })
    } finally {
      setLoading(false)
    }
  }, [org, addToast])

  useEffect(() => { fetchData() }, [fetchData])

  async function handleInvite() {
    if (!org || !inviteEmail.trim()) return
    setInviting(true)
    try {
      await api.inviteMember(org.id, inviteEmail, inviteRole)
      addToast({ type: 'success', title: `Invitation sent to ${inviteEmail}` })
      setShowInviteModal(false)
      setInviteEmail('')
      setInviteRole('viewer')
      fetchData()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to invite member'
      addToast({ type: 'error', title: msg })
    } finally {
      setInviting(false)
    }
  }

  async function handleRoleChange(memberId: string, newRole: string) {
    if (!org) return
    try {
      await api.updateMember(org.id, memberId, newRole)
      addToast({ type: 'success', title: 'Role updated' })
      fetchData()
    } catch {
      addToast({ type: 'error', title: 'Failed to update role' })
    }
  }

  async function handleRemoveMember(memberId: string) {
    if (!org) return
    try {
      await api.removeMember(org.id, memberId)
      addToast({ type: 'success', title: 'Member removed' })
      setConfirmRemove(null)
      fetchData()
    } catch {
      addToast({ type: 'error', title: 'Failed to remove member' })
    }
  }

  async function handleCreateKey() {
    if (!org || !newKeyName.trim() || newKeyPerms.length === 0) return
    setCreatingKey(true)
    try {
      const result = await api.createApiKey(org.id, { name: newKeyName, permissions: newKeyPerms })
      setCreatedKey(result.key || '')
      addToast({ type: 'success', title: 'API key created' })
      fetchData()
    } catch {
      addToast({ type: 'error', title: 'Failed to create API key' })
    } finally {
      setCreatingKey(false)
    }
  }

  async function handleRevokeKey(keyId: string) {
    if (!org) return
    try {
      await api.revokeApiKey(org.id, keyId)
      addToast({ type: 'success', title: 'API key revoked' })
      setConfirmRevoke(null)
      fetchData()
    } catch {
      addToast({ type: 'error', title: 'Failed to revoke API key' })
    }
  }

  async function handleCopyKey() {
    await navigator.clipboard.writeText(createdKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function togglePerm(id: string) {
    setNewKeyPerms((prev) => prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id])
  }

  return (
      <div className="flex flex-col gap-6">
        <Breadcrumbs items={[{ label: 'Team & API Keys' }]} />

        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm text-primary">Access management</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              Team & API Keys
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Manage team members and API access for your organization.
            </p>
          </div>
        </div>

        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Users size={15} />
              Team members
            </h2>
            <button
              onClick={() => { setInviteEmail(''); setInviteRole('viewer'); setShowInviteModal(true) }}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs transition-colors hover:bg-muted/60 hover:text-foreground"
            >
              <Plus size={13} />
              Invite member
            </button>
          </div>

          {loading && <SkeletonTable rows={3} />}

          {!loading && members.length === 0 && (
            <EmptyState
              icon={Users}
              title="No team members"
              description="Invite collaborators to manage your organization together."
              action={{ label: 'Invite member', onClick: () => setShowInviteModal(true) }}
            />
          )}

          {!loading && members.length > 0 && (
            <>
              <div className="hidden overflow-x-auto rounded-2xl border border-border bg-card sm:block">
                {members.map((m) => (
                  <div
                    key={m.userId}
                    className="flex items-center gap-4 border-b border-border px-5 py-3.5 last:border-0 transition-colors hover:bg-muted/30"
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold">
                      {m.name?.slice(0, 2).toUpperCase() || m.email.slice(0, 2).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{m.name || 'Unnamed'}</p>
                      <p className="text-xs text-muted-foreground">{m.email}</p>
                    </div>
                    <select
                      value={m.role}
                      onChange={(e) => handleRoleChange(m.userId, e.target.value)}
                      className={cn(
                        'rounded-md border border-border bg-card px-2 py-0.5 text-[11px] font-medium capitalize outline-none',
                        roleColors[m.role] || 'bg-muted text-muted-foreground',
                      )}
                    >
                      {['owner', 'admin', 'developer', 'viewer', 'billing'].map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                    {confirmRemove === m.userId ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleRemoveMember(m.userId)}
                          className="rounded bg-destructive/10 px-2 py-1 text-[10px] font-medium text-destructive hover:bg-destructive/20"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => setConfirmRemove(null)}
                          className="rounded px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmRemove(m.userId)}
                        className="text-xs text-muted-foreground hover:text-destructive"
                        title="Remove member"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex flex-col gap-3 sm:hidden">
                {members.map((m) => (
                  <div
                    key={m.userId}
                    className="rounded-2xl border border-border bg-card p-4"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold">
                          {m.name?.slice(0, 2).toUpperCase() || m.email.slice(0, 2).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{m.name || 'Unnamed'}</p>
                          <p className="text-xs text-muted-foreground">{m.email}</p>
                        </div>
                      </div>
                      <select
                        value={m.role}
                        onChange={(e) => handleRoleChange(m.userId, e.target.value)}
                        className={cn(
                          'rounded-md border border-border bg-card px-2 py-0.5 text-[11px] font-medium capitalize outline-none',
                          roleColors[m.role] || 'bg-muted text-muted-foreground',
                        )}
                      >
                        {['owner', 'admin', 'developer', 'viewer', 'billing'].map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                    </div>
                    <div className="mt-3 flex justify-end">
                      {confirmRemove === m.userId ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleRemoveMember(m.userId)}
                            className="rounded bg-destructive/10 px-2 py-1 text-[10px] font-medium text-destructive hover:bg-destructive/20"
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => setConfirmRemove(null)}
                            className="rounded px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmRemove(m.userId)}
                          className="text-xs text-muted-foreground hover:text-destructive"
                          title="Remove member"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Key size={15} />
              API Keys
            </h2>
            <button
              onClick={() => { setNewKeyName(''); setNewKeyPerms([]); setCreatedKey(''); setShowCreateKeyModal(true) }}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs transition-colors hover:bg-muted/60 hover:text-foreground"
            >
              <Plus size={13} />
              Create API key
            </button>
          </div>

          {!loading && apiKeys.length === 0 && (
            <EmptyState
              icon={Key}
              title="No API keys"
              description="Create API keys to access Walwatch programmatically."
              action={{ label: 'Create API key', onClick: () => setShowCreateKeyModal(true) }}
            />
          )}

          {!loading && apiKeys.length > 0 && (
            <>
              <div className="hidden overflow-hidden rounded-2xl border border-border bg-card sm:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th className="px-5 py-3 font-medium">Name</th>
                      <th className="px-5 py-3 font-medium">Prefix</th>
                      <th className="px-5 py-3 font-medium">Permissions</th>
                      <th className="px-5 py-3 font-medium">Created</th>
                      <th className="px-5 py-3 font-medium">Last used</th>
                      <th className="px-5 py-3 font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {apiKeys.map((k) => (
                      <tr key={k.id} className="border-b border-border transition-colors last:border-0 hover:bg-muted/30">
                        <td className="px-5 py-3.5 font-medium">{k.name}</td>
                        <td className="px-5 py-3.5 font-mono text-xs text-muted-foreground">{k.keyPrefix}</td>
                        <td className="px-5 py-3.5">
                          <div className="flex flex-wrap gap-1">
                            {(k.permissions || []).map((p) => (
                              <span key={p} className="rounded bg-muted px-1.5 py-0.5 text-[10px] capitalize text-muted-foreground">
                                {p}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-5 py-3.5 text-muted-foreground">
                          {new Date(k.createdAt).toLocaleDateString()}
                        </td>
                        <td className="px-5 py-3.5 text-muted-foreground">
                          {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleDateString() : 'Never'}
                        </td>
                        <td className="px-5 py-3.5">
                          {confirmRevoke === k.id ? (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => handleRevokeKey(k.id)}
                                className="rounded bg-destructive/10 px-2 py-1 text-[10px] font-medium text-destructive hover:bg-destructive/20"
                              >
                                Confirm
                              </button>
                              <button
                                onClick={() => setConfirmRevoke(null)}
                                className="rounded px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setConfirmRevoke(k.id)}
                              className="text-xs text-muted-foreground underline-offset-2 hover:text-destructive hover:underline"
                            >
                              Revoke
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col gap-3 sm:hidden">
                {apiKeys.map((k) => (
                  <div key={k.id} className="rounded-2xl border border-border bg-card p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium">{k.name}</p>
                    </div>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">{k.keyPrefix}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {(k.permissions || []).map((p) => (
                        <span key={p} className="rounded bg-muted px-1.5 py-0.5 text-[10px] capitalize text-muted-foreground">
                          {p}
                        </span>
                      ))}
                    </div>
                    <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                      <span>Created {new Date(k.createdAt).toLocaleDateString()}</span>
                      {confirmRevoke === k.id ? (
                        <div className="flex items-center gap-1">
                          <button onClick={() => handleRevokeKey(k.id)} className="text-destructive text-[10px] font-medium">Confirm</button>
                          <button onClick={() => setConfirmRevoke(null)} className="text-[10px]">Cancel</button>
                        </div>
                      ) : (
                        <button onClick={() => setConfirmRevoke(k.id)} className="hover:text-destructive">Revoke</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        <AnimatePresence>
          {showInviteModal && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
              onClick={() => setShowInviteModal(false)}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-xl"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold">Invite member</h3>
                  <button onClick={() => setShowInviteModal(false)} className="rounded-lg p-1 text-muted-foreground hover:text-foreground">
                    <X size={18} />
                  </button>
                </div>
                <div className="mt-5 space-y-4">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium">Email address</span>
                    <input
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="colleague@example.com"
                      className="h-11 rounded-xl border border-input bg-background px-3.5 text-sm outline-none transition-colors focus:ring-2 focus:ring-ring/40"
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium">Role</span>
                    <select
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value)}
                      className="h-11 rounded-xl border border-input bg-background px-3.5 text-sm outline-none focus:ring-2 focus:ring-ring/40"
                    >
                      <option value="viewer">Viewer</option>
                      <option value="developer">Developer</option>
                      <option value="admin">Admin</option>
                      <option value="billing">Billing</option>
                    </select>
                  </label>
                </div>
                <div className="mt-6 flex gap-3">
                  <button
                    onClick={() => setShowInviteModal(false)}
                    className="flex-1 rounded-xl border border-border py-2.5 text-sm font-medium transition-colors hover:bg-muted"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleInvite}
                    disabled={!inviteEmail.trim() || inviting}
                    className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {inviting && <Loader2 size={16} className="animate-spin" />}
                    Send invite
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showCreateKeyModal && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
              onClick={() => !createdKey && setShowCreateKeyModal(false)}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-xl"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold">
                    {createdKey ? 'API Key created' : 'Create API key'}
                  </h3>
                  {!createdKey && (
                    <button onClick={() => setShowCreateKeyModal(false)} className="rounded-lg p-1 text-muted-foreground hover:text-foreground">
                      <X size={18} />
                    </button>
                  )}
                </div>

                {!createdKey ? (
                  <>
                    <div className="mt-5 space-y-4">
                      <label className="flex flex-col gap-1.5">
                        <span className="text-sm font-medium">Key name</span>
                        <input
                          value={newKeyName}
                          onChange={(e) => setNewKeyName(e.target.value)}
                          placeholder="e.g. Production API"
                          className="h-11 rounded-xl border border-input bg-background px-3.5 text-sm outline-none transition-colors focus:ring-2 focus:ring-ring/40"
                        />
                      </label>
                      <div>
                        <span className="text-sm font-medium">Permissions</span>
                        <p className="mt-0.5 text-xs text-muted-foreground">Choose what this key can do.</p>
                        <div className="mt-3 space-y-2">
                          {permissionOptions.map((opt) => (
                            <label
                              key={opt.id}
                              className="flex cursor-pointer items-center gap-3 rounded-xl border border-border px-4 py-3 transition-colors hover:border-primary/30"
                            >
                              <input
                                type="checkbox"
                                checked={newKeyPerms.includes(opt.id)}
                                onChange={() => togglePerm(opt.id)}
                                className="size-4 rounded border-border accent-primary"
                              />
                              <div>
                                <p className="text-sm font-medium capitalize">{opt.label}</p>
                                <p className="text-xs text-muted-foreground">{opt.desc}</p>
                              </div>
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={handleCreateKey}
                      disabled={!newKeyName.trim() || newKeyPerms.length === 0 || creatingKey}
                      className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {creatingKey && <Loader2 size={16} className="animate-spin" />}
                      <Shield size={16} />
                      Generate key
                    </button>
                  </>
                ) : (
                  <>
                    <div className="mt-6 rounded-xl border border-accent/30 bg-accent/5 p-4">
                      <p className="flex items-center gap-2 text-xs font-medium text-accent">
                        <Check size={14} />
                        Key created successfully
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Copy this key now. You won&apos;t be able to see it again.
                      </p>
                    </div>
                    <div className="mt-4 flex items-center gap-2 rounded-xl border border-border bg-background px-4 py-3">
                      <code className="flex-1 truncate text-xs font-mono text-primary">{createdKey}</code>
                      <button
                        onClick={handleCopyKey}
                        className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        {copied ? <Check size={16} className="text-accent" /> : <Copy size={16} />}
                      </button>
                    </div>
                    <button
                      onClick={() => setShowCreateKeyModal(false)}
                      className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
                    >
                      Done
                    </button>
                  </>
                )}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
  )
}
