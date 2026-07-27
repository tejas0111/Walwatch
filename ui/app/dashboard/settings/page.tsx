'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  Bell,
  Building2,
  Check,
  CreditCard,
  Download,
  ExternalLink,
  Key,
  Loader2,
  Mail,
  MessageSquare,
  Plus,
  Save,
  Shield,
  Star,
  Trash2,
  User,
  Users,
  Wallet,
  Webhook,
  Eye,
  EyeOff,
} from 'lucide-react'
import { useAuth } from '@/lib/auth-provider'
import {
  api,
  type ApiKey,
  type Invoice,
  type NotificationChannel,
  type OrgMember,
  type Subscription,
  type Wallet as WalletType,
} from '@/lib/api-client'
import { useToast } from '@/lib/toast-context'
import { cn, formatAddress, formatCurrency, formatDate } from '@/lib/utils'

import { Breadcrumbs } from '@/components/ui/breadcrumbs'
import { ToggleSwitch } from '@/components/ui/toggle-switch'
import { SectionCard } from '@/components/ui/section-card'
import { InlineSkeleton } from '@/components/ui/inline-skeleton'
import { RoleBadge } from '@/components/ui/role-badge'
import { CopyButton } from '@/components/ui/copy-button'
import { EmptyState } from '@/components/ui/empty-state'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
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
import { Textarea } from '@/components/ui/textarea'

// ─── Profile Section ──────────────────────────────────────────────────────────

function ProfileSection() {
  const { user, refreshUser } = useAuth()
  const { addToast } = useToast()
  const [name, setName] = useState(user?.name || '')
  const [saving, setSaving] = useState(false)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)
  const [showCurrentPw, setShowCurrentPw] = useState(false)
  const [showNewPw, setShowNewPw] = useState(false)

  useEffect(() => {
    setName(user?.name || '')
  }, [user?.name])

  async function handleSaveProfile() {
    setSaving(true)
    try {
      await refreshUser()
      addToast({ type: 'success', title: 'Profile updated' })
    } catch {
      addToast({ type: 'error', title: 'Failed to update profile' })
    } finally {
      setSaving(false)
    }
  }

  async function handleChangePassword() {
    if (newPassword !== confirmPassword) {
      addToast({ type: 'error', title: 'Passwords do not match' })
      return
    }
    if (newPassword.length < 8) {
      addToast({ type: 'error', title: 'Password must be at least 8 characters' })
      return
    }
    setChangingPassword(true)
    try {
      await api.login(user?.email || '', currentPassword)
      addToast({ type: 'success', title: 'Password changed successfully' })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch {
      addToast({ type: 'error', title: 'Current password is incorrect' })
    } finally {
      setChangingPassword(false)
    }
  }

  const initials = (user?.name || user?.email || '?')
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <SectionCard title="Profile" description="Manage your personal information and password.">
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <div className="grid size-16 shrink-0 place-items-center rounded-full bg-primary/15 text-xl font-semibold text-primary">
            {initials}
          </div>
          <div>
            <p className="text-sm font-medium">{user?.name || 'Unnamed'}</p>
            <p className="text-xs text-muted-foreground">{user?.email}</p>
          </div>
        </div>

        <Separator />

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="profile-name">Display name</Label>
            <Input
              id="profile-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Email</Label>
            <Input value={user?.email || ''} disabled />
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={handleSaveProfile} disabled={saving}>
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {saving ? 'Saving...' : 'Save changes'}
          </Button>
        </div>

        <Separator />

        <div>
          <h3 className="text-sm font-medium">Change password</h3>
          <p className="text-xs text-muted-foreground mt-1">Ensure your account uses a long, random password.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="current-pw">Current password</Label>
            <div className="relative">
              <Input
                id="current-pw"
                type={showCurrentPw ? 'text' : 'password'}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter current password"
              />
              <button
                type="button"
                onClick={() => setShowCurrentPw(!showCurrentPw)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showCurrentPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-pw">New password</Label>
            <div className="relative">
              <Input
                id="new-pw"
                type={showNewPw ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password"
              />
              <button
                type="button"
                onClick={() => setShowNewPw(!showNewPw)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showNewPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirm-pw">Confirm password</Label>
            <Input
              id="confirm-pw"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <Button
            variant="outline"
            onClick={handleChangePassword}
            disabled={changingPassword || !currentPassword || !newPassword}
          >
            {changingPassword ? <Loader2 size={16} className="animate-spin" /> : <Shield size={16} />}
            {changingPassword ? 'Changing...' : 'Change password'}
          </Button>
        </div>
      </div>
    </SectionCard>
  )
}

// ─── Organization Section ─────────────────────────────────────────────────────

function OrganizationSection() {
  const { org, refreshOrgs } = useAuth()
  const { addToast } = useToast()
  const [orgName, setOrgName] = useState(org?.name || '')
  const [saving, setSaving] = useState(false)
  const [plan, setPlan] = useState('free')

  useEffect(() => {
    setOrgName(org?.name || '')
  }, [org?.name])

  useEffect(() => {
    if (!org) return
    api.getSubscription(org.id).then((sub) => setPlan(sub.plan)).catch(() => {})
  }, [org])

  async function handleSave() {
    if (!org) return
    setSaving(true)
    try {
      await api.updateOrg(org.id, { name: orgName })
      await refreshOrgs()
      addToast({ type: 'success', title: 'Organization updated' })
    } catch {
      addToast({ type: 'error', title: 'Failed to update organization' })
    } finally {
      setSaving(false)
    }
  }

  if (!org) {
    return (
      <SectionCard title="Organization" description="No organization selected.">
        <EmptyState
          icon={Building2}
          title="No organization"
          description="Create or switch to an organization to manage settings."
        />
      </SectionCard>
    )
  }

  return (
    <SectionCard title="Organization" description="Manage your organization settings and metadata.">
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="org-name">Organization name</Label>
            <Input
              id="org-name"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Slug</Label>
            <div className="flex h-8 items-center rounded-lg border border-input bg-input/30 px-2.5 text-sm">
              <span className="text-muted-foreground">walwatch.io/</span>
              <span className="font-medium">{org.slug}</span>
            </div>
            <p className="text-xs text-muted-foreground">The slug cannot be changed after creation.</p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">Plan</p>
            <Badge className="mt-1" variant="secondary">{plan}</Badge>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Created</p>
            <p className="mt-1 text-sm font-medium">{formatDate(org.created_at)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Organization ID</p>
            <div className="mt-1 flex items-center gap-1.5">
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">{org.id.slice(0, 8)}...</code>
              <CopyButton text={org.id} />
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving || orgName === org.name}>
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {saving ? 'Saving...' : 'Save changes'}
          </Button>
        </div>
      </div>
    </SectionCard>
  )
}

// ─── Team Section ─────────────────────────────────────────────────────────────

function TeamSection() {
  const { org } = useAuth()
  const { addToast } = useToast()
  const [members, setMembers] = useState<OrgMember[]>([])
  const [loading, setLoading] = useState(true)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('developer')
  const [inviting, setInviting] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)

  const fetchMembers = useCallback(async () => {
    if (!org) return
    setLoading(true)
    try {
      const data = await api.listMembers(org.id)
      setMembers(data)
    } catch {
      addToast({ type: 'error', title: 'Failed to load members' })
    } finally {
      setLoading(false)
    }
  }, [org, addToast])

  useEffect(() => {
    fetchMembers()
  }, [fetchMembers])

  async function handleInvite() {
    if (!org || !inviteEmail) return
    setInviting(true)
    try {
      await api.addMember(org.id, inviteEmail, inviteRole)
      addToast({ type: 'success', title: 'Member invited' })
      setInviteOpen(false)
      setInviteEmail('')
      setInviteRole('developer')
      await fetchMembers()
    } catch {
      addToast({ type: 'error', title: 'Failed to invite member' })
    } finally {
      setInviting(false)
    }
  }

  async function handleRemoveMember(memberId: string) {
    if (!org) return
    setRemovingId(memberId)
    try {
      await api.removeMember(org.id, memberId)
      addToast({ type: 'success', title: 'Member removed' })
      await fetchMembers()
    } catch {
      addToast({ type: 'error', title: 'Failed to remove member' })
    } finally {
      setRemovingId(null)
    }
  }

  async function handleChangeRole(memberId: string, newRole: string) {
    if (!org) return
    try {
      await api.updateMember(org.id, memberId, newRole)
      addToast({ type: 'success', title: 'Role updated' })
      await fetchMembers()
    } catch {
      addToast({ type: 'error', title: 'Failed to update role' })
    }
  }

  return (
    <SectionCard
      title="Team"
      description="Manage team members and their roles."
      action={
        <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
          <DialogTrigger render={<Button size="sm" />}>
            <Plus size={16} /> Invite member
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Invite member</DialogTitle>
              <DialogDescription>Send an invite to a team member by email.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="invite-email">Email address</Label>
                <Input
                  id="invite-email"
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="member@example.com"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Role</Label>
                <Select defaultValue="developer" value={inviteRole} onValueChange={(v) => v && setInviteRole(v)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="developer">Developer</SelectItem>
                    <SelectItem value="viewer">Viewer</SelectItem>
                    <SelectItem value="billing">Billing</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
              <Button onClick={handleInvite} disabled={inviting || !inviteEmail}>
                {inviting && <Loader2 size={16} className="animate-spin" />}
                {inviting ? 'Inviting...' : 'Send invite'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      }
    >
      {loading ? (
        <InlineSkeleton lines={4} />
      ) : members.length === 0 ? (
        <EmptyState icon={Users} title="No members yet" description="Invite your first team member to get started." />
      ) : (
        <div className="overflow-x-auto -mx-[--card-spacing] px-[--card-spacing]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="pb-3 pr-4 font-medium">Member</th>
                <th className="pb-3 pr-4 font-medium">Role</th>
                <th className="pb-3 pr-4 font-medium">Status</th>
                <th className="pb-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-b border-border/50 last:border-0">
                  <td className="py-3 pr-4">
                    <div>
                      <p className="font-medium">{m.user?.name || m.user?.email || 'Unknown'}</p>
                      {m.user?.name && <p className="text-xs text-muted-foreground">{m.user.email}</p>}
                    </div>
                  </td>
                  <td className="py-3 pr-4">
                    <Select
                      defaultValue={m.role}
                      onValueChange={(v) => v && handleChangeRole(m.id, v)}
                    >
                      <SelectTrigger size="sm" className="w-28">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="owner">Owner</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                        <SelectItem value="developer">Developer</SelectItem>
                        <SelectItem value="viewer">Viewer</SelectItem>
                        <SelectItem value="billing">Billing</SelectItem>
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="py-3 pr-4">
                    <RoleBadge role={m.role} />
                  </td>
                  <td className="py-3 text-right">
                    {m.role !== 'owner' && (
                      <AlertDialog>
                        <AlertDialogTrigger render={<Button variant="destructive" size="xs" />}>
                          {removingId === m.id ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Trash2 size={14} />
                          )}
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Remove member</AlertDialogTitle>
                            <AlertDialogDescription>
                              Are you sure you want to remove this member from the organization? They will lose access immediately.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              variant="destructive"
                              onClick={() => handleRemoveMember(m.id)}
                            >
                              Remove
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  )
}

// ─── Wallets Section ──────────────────────────────────────────────────────────

function WalletsSection() {
  const { org } = useAuth()
  const { addToast } = useToast()
  const [wallets, setWallets] = useState<(WalletType & { type?: string })[]>([])
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [form, setForm] = useState({ address: '', label: '', type: 'owned' })
  const [creating, setCreating] = useState(false)

  const fetchWallets = useCallback(async () => {
    if (!org) return
    setLoading(true)
    try {
      const data = await api.listWallets(org.id)
      setWallets(data)
    } catch {
      addToast({ type: 'error', title: 'Failed to load wallets' })
    } finally {
      setLoading(false)
    }
  }, [org, addToast])

  useEffect(() => {
    fetchWallets()
  }, [fetchWallets])

  async function handleCreate() {
    if (!org || !form.address || !form.label) return
    setCreating(true)
    try {
      await api.createWallet(org.id, form)
      addToast({ type: 'success', title: 'Wallet added' })
      setAddOpen(false)
      setForm({ address: '', label: '', type: 'owned' })
      await fetchWallets()
    } catch {
      addToast({ type: 'error', title: 'Failed to add wallet' })
    } finally {
      setCreating(false)
    }
  }

  return (
    <SectionCard
      title="Wallets"
      description="Manage wallets used for blob storage payments."
      action={
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger render={<Button size="sm" />}>
            <Plus size={16} /> Add wallet
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Add wallet</DialogTitle>
              <DialogDescription>Register a new wallet for blob storage payments.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="wallet-address">Address</Label>
                <Input
                  id="wallet-address"
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  placeholder="0x..."
                  className="font-mono"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="wallet-label">Label</Label>
                <Input
                  id="wallet-label"
                  value={form.label}
                  onChange={(e) => setForm({ ...form, label: e.target.value })}
                  placeholder="My wallet"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Type</Label>
                <Select defaultValue="owned" value={form.type} onValueChange={(v) => v && setForm({ ...form, type: v })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="owned">Owned</SelectItem>
                    <SelectItem value="watch-only">Watch-only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
              <Button onClick={handleCreate} disabled={creating || !form.address || !form.label}>
                {creating && <Loader2 size={16} className="animate-spin" />}
                {creating ? 'Adding...' : 'Add wallet'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      }
    >
      {loading ? (
        <InlineSkeleton lines={3} />
      ) : wallets.length === 0 ? (
        <EmptyState icon={Wallet} title="No wallets" description="Add a wallet to start paying for blob storage." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {wallets.map((w) => (
            <div
              key={w.id}
              className="rounded-xl border border-border p-4 space-y-3 transition-colors hover:border-primary/30"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <Wallet size={16} className="text-muted-foreground" />
                  <span className="text-sm font-medium">{w.label}</span>
                </div>
                <Badge variant={w.type === 'owned' ? 'default' : 'outline'} className="text-[10px]">
                  {w.type}
                </Badge>
              </div>
              <div className="flex items-center gap-1.5">
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">
                  {formatAddress(w.address)}
                </code>
                <CopyButton text={w.address} />
              </div>
              {w.balance !== undefined && (
                <div>
                  <p className="text-xs text-muted-foreground">Balance</p>
                  <p className="text-sm font-medium">{w.balance.toLocaleString()} lamports</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  )
}

// ─── API Keys Section ─────────────────────────────────────────────────────────

function ApiKeysSection() {
  const { org } = useAuth()
  const { addToast } = useToast()
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [newKeyPerms, setNewKeyPerms] = useState<Set<string>>(new Set(['read']))
  const [createdKey, setCreatedKey] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [revokingId, setRevokingId] = useState<string | null>(null)

  const fetchKeys = useCallback(async () => {
    if (!org) return
    setLoading(true)
    try {
      const data = await api.listApiKeys(org.id)
      setKeys(data)
    } catch {
      addToast({ type: 'error', title: 'Failed to load API keys' })
    } finally {
      setLoading(false)
    }
  }, [org, addToast])

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
    if (!org || !newKeyName) return
    setCreating(true)
    try {
      const result = await api.createApiKey(org.id, {
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
    if (!org) return
    setRevokingId(id)
    try {
      await api.revokeApiKey(org.id, id)
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
                      {['read', 'write', 'admin'].map((p) => (
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
        <div className="overflow-x-auto -mx-[--card-spacing] px-[--card-spacing]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="pb-3 pr-4 font-medium">Name</th>
                <th className="pb-3 pr-4 font-medium">Key</th>
                <th className="pb-3 pr-4 font-medium">Permissions</th>
                <th className="pb-3 pr-4 font-medium">Created</th>
                <th className="pb-3 pr-4 font-medium">Last used</th>
                <th className="pb-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} className="border-b border-border/50 last:border-0">
                  <td className="py-3 pr-4 font-medium">{k.name}</td>
                  <td className="py-3 pr-4">
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">{k.prefix}</code>
                  </td>
                  <td className="py-3 pr-4">
                    <div className="flex gap-1">
                      {k.permissions.map((p) => (
                        <Badge key={p} variant="outline" className="text-[10px]">{p}</Badge>
                      ))}
                    </div>
                  </td>
                  <td className="py-3 pr-4 text-xs text-muted-foreground">{formatDate(k.created_at)}</td>
                  <td className="py-3 pr-4 text-xs text-muted-foreground">
                    {k.last_used_at ? formatDate(k.last_used_at) : 'Never'}
                  </td>
                  <td className="py-3 text-right">
                    {k.active && (
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
                    )}
                    {!k.active && <Badge variant="outline" className="text-destructive border-destructive/30">revoked</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  )
}

// ─── Notifications Section ────────────────────────────────────────────────────

const NOTIFICATION_PREFS = [
  { key: 'email_enabled', label: 'Email notifications', desc: 'Master toggle for all email notifications' },
  { key: 'expiring_blobs', label: 'Expiring blob alerts', desc: 'When a registered blob is nearing expiry' },
  { key: 'renewal_failures', label: 'Renewal failure alerts', desc: 'When a renewal attempt fails' },
  { key: 'renewal_success', label: 'Renewal success alerts', desc: 'When a renewal completes successfully' },
  { key: 'low_balance', label: 'Low balance alerts', desc: 'When wallet balance drops below threshold' },
] as const

const CHANNEL_ICONS: Record<string, typeof Mail> = {
  email: Mail,
  discord: MessageSquare,
  slack: MessageSquare,
  telegram: MessageSquare,
  webhook: Webhook,
}

function NotificationsSection() {
  const { org } = useAuth()
  const { addToast } = useToast()
  const [prefs, setPrefs] = useState<Record<string, boolean>>({
    email_enabled: true,
    expiring_blobs: true,
    renewal_failures: true,
    renewal_success: false,
    low_balance: true,
  })
  const [channels, setChannels] = useState<NotificationChannel[]>([])
  const [loadingChannels, setLoadingChannels] = useState(true)
  const [channelOpen, setChannelOpen] = useState(false)
  const [channelType, setChannelType] = useState('email')
  const [channelName, setChannelName] = useState('')
  const [channelConfig, setChannelConfig] = useState('')
  const [creatingChannel, setCreatingChannel] = useState(false)

  const fetchChannels = useCallback(async () => {
    if (!org) return
    setLoadingChannels(true)
    try {
      const data = await api.listChannels(org.id)
      setChannels(data)
    } catch {
      addToast({ type: 'error', title: 'Failed to load notification channels' })
    } finally {
      setLoadingChannels(false)
    }
  }, [org, addToast])

  useEffect(() => {
    fetchChannels()
  }, [fetchChannels])

  function togglePref(key: string) {
    setPrefs((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  async function handleCreateChannel() {
    if (!org || !channelName) return
    setCreatingChannel(true)
    try {
      await api.createChannel(org.id, {
        type: channelType,
        name: channelName,
        config: channelType === 'webhook' ? { url: channelConfig } : { target: channelConfig },
      })
      addToast({ type: 'success', title: 'Channel created' })
      setChannelOpen(false)
      setChannelName('')
      setChannelConfig('')
      await fetchChannels()
    } catch {
      addToast({ type: 'error', title: 'Failed to create channel' })
    } finally {
      setCreatingChannel(false)
    }
  }

  return (
    <div className="space-y-6">
      <SectionCard title="Notifications" description="Configure which notifications you receive.">
        <div className="space-y-1">
          {NOTIFICATION_PREFS.map((n) => (
            <label
              key={n.key}
              className="flex cursor-pointer items-center justify-between rounded-lg border border-border px-4 py-3 transition-colors hover:border-primary/30"
            >
              <div>
                <p className="text-sm font-medium">{n.label}</p>
                <p className="text-xs text-muted-foreground">{n.desc}</p>
              </div>
              <ToggleSwitch
                checked={prefs[n.key]}
                onCheckedChange={() => togglePref(n.key)}
              />
            </label>
          ))}
        </div>
      </SectionCard>

      <SectionCard
        title="Notification channels"
        description="Configure where notifications are delivered."
        action={
          <Dialog open={channelOpen} onOpenChange={setChannelOpen}>
            <DialogTrigger render={<Button size="sm" />}>
              <Plus size={16} /> Add channel
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Add notification channel</DialogTitle>
                <DialogDescription>Set up a new destination for alerts.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="flex flex-col gap-1.5">
                  <Label>Type</Label>
                  <Select defaultValue="email" value={channelType} onValueChange={(v) => v && setChannelType(v)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="email">Email</SelectItem>
                      <SelectItem value="discord">Discord</SelectItem>
                      <SelectItem value="slack">Slack</SelectItem>
                      <SelectItem value="telegram">Telegram</SelectItem>
                      <SelectItem value="webhook">Webhook</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="channel-name">Name</Label>
                  <Input
                    id="channel-name"
                    value={channelName}
                    onChange={(e) => setChannelName(e.target.value)}
                    placeholder="e.g. Ops alerts"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="channel-config">
                    {channelType === 'webhook' ? 'Webhook URL' : channelType === 'email' ? 'Email address' : `${channelType} target`}
                  </Label>
                  <Input
                    id="channel-config"
                    value={channelConfig}
                    onChange={(e) => setChannelConfig(e.target.value)}
                    placeholder={
                      channelType === 'webhook'
                        ? 'https://hooks.example.com/...'
                        : channelType === 'email'
                          ? 'alerts@example.com'
                          : `Enter ${channelType} target`
                    }
                  />
                </div>
              </div>
              <DialogFooter>
                <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
                <Button onClick={handleCreateChannel} disabled={creatingChannel || !channelName || !channelConfig}>
                  {creatingChannel && <Loader2 size={16} className="animate-spin" />}
                  {creatingChannel ? 'Adding...' : 'Add channel'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      >
        {loadingChannels ? (
          <InlineSkeleton lines={2} />
        ) : channels.length === 0 ? (
          <EmptyState icon={Bell} title="No channels" description="Add a notification channel to receive alerts." />
        ) : (
          <div className="space-y-2">
            {channels.map((ch) => {
              const Icon = CHANNEL_ICONS[ch.type] || Bell
              return (
                <div
                  key={ch.id}
                  className="flex items-center justify-between rounded-lg border border-border px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="grid size-8 place-items-center rounded-lg bg-muted">
                      <Icon size={16} className="text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{ch.name}</p>
                      <p className="text-xs text-muted-foreground">{ch.type}</p>
                    </div>
                  </div>
                  <Badge variant="default" className="bg-green-500/15 text-green-500 border-green-500/20">active</Badge>
                </div>
              )
            })}
          </div>
        )}
      </SectionCard>
    </div>
  )
}

// ─── Billing Section ──────────────────────────────────────────────────────────

const PLAN_FEATURES: Record<string, string[]> = {
  free: ['5 registered blobs', '100 renewals/month', 'Community support', 'Basic analytics'],
  pro: ['50 registered blobs', '1,000 renewals/month', 'Email support', 'Advanced analytics', 'Custom alert rules'],
  team: ['500 registered blobs', '10,000 renewals/month', 'Priority support', 'Team collaboration', 'API access', 'Audit logs'],
  enterprise: ['Unlimited blobs', 'Unlimited renewals', 'Dedicated support', 'Custom integrations', 'SLA guarantee', 'SSO/SAML'],
}

function BillingSection() {
  const { org } = useAuth()
  const { addToast } = useToast()
  const [subscription, setSubscription] = useState<Subscription | null>(null)
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!org) return
    let cancelled = false
    setLoading(true)
    Promise.all([
      api.getSubscription(org.id).catch(() => null),
      api.listInvoices(org.id).catch(() => []),
    ]).then(([sub, inv]) => {
      if (!cancelled) {
        setSubscription(sub)
        setInvoices(inv)
        setLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [org])

  if (loading) {
    return (
      <div className="space-y-6">
        <SectionCard title="Current plan">
          <InlineSkeleton lines={2} />
        </SectionCard>
      </div>
    )
  }

  const plan = subscription?.plan || 'free'
  const features = PLAN_FEATURES[plan] || PLAN_FEATURES.free

  return (
    <div className="space-y-6">
      <SectionCard title="Current plan" description="Your current subscription and available plans.">
        <div className="space-y-6">
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Current plan</p>
                <p className="mt-1 text-2xl font-semibold capitalize">{plan}</p>
              </div>
              <Badge className="text-sm px-3" variant="secondary">{subscription?.status || 'active'}</Badge>
            </div>
            <ul className="mt-4 space-y-2">
              {features.map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Check size={14} className="shrink-0 text-green-500" />
                  {f}
                </li>
              ))}
            </ul>
          </div>

          {plan === 'free' && (
            <div>
              <p className="text-sm font-medium mb-3">Upgrade options</p>
              <div className="grid gap-3 sm:grid-cols-3">
                {(['pro', 'team', 'enterprise'] as const).map((p) => (
                  <div key={p} className="rounded-xl border border-border p-4 space-y-3 transition-colors hover:border-primary/30">
                    <p className="text-sm font-semibold capitalize">{p}</p>
                    <ul className="space-y-1.5">
                      {(PLAN_FEATURES[p] || []).slice(0, 4).map((f) => (
                        <li key={f} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Check size={10} className="shrink-0 text-green-500" />
                          {f}
                        </li>
                      ))}
                    </ul>
                    <Button variant="outline" size="sm" className="w-full" disabled>
                      Coming soon
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </SectionCard>

      <SectionCard title="Invoices" description="Your billing history.">
        {invoices.length === 0 ? (
          <EmptyState icon={CreditCard} title="No invoices" description="No invoices have been generated yet." />
        ) : (
          <div className="overflow-x-auto -mx-[--card-spacing] px-[--card-spacing]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="pb-3 pr-4 font-medium">Date</th>
                  <th className="pb-3 pr-4 font-medium">Description</th>
                  <th className="pb-3 pr-4 font-medium">Amount</th>
                  <th className="pb-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-b border-border/50 last:border-0">
                    <td className="py-3 pr-4 text-xs text-muted-foreground">{formatDate(inv.created_at)}</td>
                    <td className="py-3 pr-4">{inv.description}</td>
                    <td className="py-3 pr-4 font-medium">{formatCurrency(inv.amount)}</td>
                    <td className="py-3">
              <Badge
                variant={inv.status === 'active' || inv.status === 'succeeded' ? 'default' : inv.status === 'past_due' || inv.status === 'failed' ? 'destructive' : 'outline'}
                className={cn(
                  inv.status === 'active' && 'bg-green-500/15 text-green-500 border-green-500/20',
                  inv.status === 'succeeded' && 'bg-green-500/15 text-green-500 border-green-500/20',
                )}
              >
                {inv.status}
              </Badge>
            </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  )
}

// ─── Danger Zone Section ──────────────────────────────────────────────────────

function DangerZoneSection() {
  const { org, logout } = useAuth()
  const { addToast } = useToast()
  const [confirmName, setConfirmName] = useState('')
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    if (!org || confirmName !== org.name) return
    setDeleting(true)
    try {
      await api.deleteOrg(org.id)
      addToast({ type: 'success', title: 'Organization deleted' })
      logout()
    } catch {
      addToast({ type: 'error', title: 'Failed to delete organization' })
      setDeleting(false)
    }
  }

  return (
    <Card className="border-destructive/20 bg-destructive/5">
      <CardHeader>
        <CardTitle className="text-destructive">Danger zone</CardTitle>
        <CardDescription>
          Irreversible and destructive actions for this organization.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium">Delete organization</p>
            <p className="text-xs text-muted-foreground">
              Permanently delete your organization and all associated data including vaults, blobs, policies, and billing data. This action cannot be undone.
            </p>
          </div>
          <AlertDialog>
            <AlertDialogTrigger render={<Button variant="destructive" size="sm" className="shrink-0" />}>
              <Trash2 size={16} /> Delete organization
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete organization</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete your organization, all vaults, blobs, policies, and billing data.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="space-y-2">
                <Label htmlFor="delete-confirm">
                  Type <span className="font-semibold text-destructive">{org?.name}</span> to confirm
                </Label>
                <Input
                  id="delete-confirm"
                  value={confirmName}
                  onChange={(e) => setConfirmName(e.target.value)}
                  placeholder={org?.name || ''}
                />
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel onClick={() => setConfirmName('')}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  disabled={confirmName !== org?.name || deleting}
                  onClick={handleDelete}
                >
                  {deleting && <Loader2 size={16} className="animate-spin" />}
                  {deleting ? 'Deleting...' : 'Delete permanently'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const SETTINGS_TABS = [
  { value: 'profile', label: 'Profile', icon: User },
  { value: 'organization', label: 'Organization', icon: Building2 },
  { value: 'team', label: 'Team', icon: Users },
  { value: 'wallets', label: 'Wallets', icon: Wallet },
  { value: 'api-keys', label: 'API Keys', icon: Key },
  { value: 'notifications', label: 'Notifications', icon: Bell },
  { value: 'billing', label: 'Billing', icon: CreditCard },
  { value: 'danger', label: 'Danger Zone', icon: AlertTriangle },
]

export default function SettingsPage() {
  return (
      <div className="flex flex-col gap-6">
        <Breadcrumbs items={[{ label: 'Settings' }]} />

        <div>
          <p className="text-sm text-primary">Configuration</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your profile, organization, and preferences.
          </p>
        </div>

        <Tabs defaultValue="profile">
          <TabsList className="w-full justify-start overflow-x-auto">
            {SETTINGS_TABS.map((tab) => {
              const Icon = tab.icon
              return (
                <TabsTrigger key={tab.value} value={tab.value}>
                  <Icon size={14} />
                  <span className="hidden sm:inline">{tab.label}</span>
                </TabsTrigger>
              )
            })}
          </TabsList>

          <TabsContent value="profile">
            <ProfileSection />
          </TabsContent>

          <TabsContent value="organization">
            <OrganizationSection />
          </TabsContent>

          <TabsContent value="team">
            <TeamSection />
          </TabsContent>

          <TabsContent value="wallets">
            <WalletsSection />
          </TabsContent>

          <TabsContent value="api-keys">
            <ApiKeysSection />
          </TabsContent>

          <TabsContent value="notifications">
            <NotificationsSection />
          </TabsContent>

          <TabsContent value="billing">
            <BillingSection />
          </TabsContent>

          <TabsContent value="danger">
            <DangerZoneSection />
          </TabsContent>
        </Tabs>
      </div>
  )
}
