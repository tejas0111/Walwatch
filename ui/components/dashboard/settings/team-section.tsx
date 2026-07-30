'use client'

import { useCallback, useEffect, useState } from 'react'
import { Plus, Trash2, Users } from 'lucide-react'
import { useAuth } from '@/lib/auth-provider'
import { api, type OrgMember } from '@/lib/api-client'
import { useToast } from '@/lib/toast-context'
import { SectionCard } from '@/components/ui/section-card'
import { InlineSkeleton } from '@/components/ui/inline-skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { RoleBadge } from '@/components/ui/role-badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
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
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'

export function TeamSection() {
  const { org } = useAuth()
  const { addToast } = useToast()
  const [members, setMembers] = useState<OrgMember[]>([])
  const [loading, setLoading] = useState(true)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('developer')
  const [inviting, setInviting] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [updatingRole, setUpdatingRole] = useState<Record<string, boolean>>({})

  const fetchMembers = useCallback(async () => {
    if (!org) { setLoading(false); return }
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
    setUpdatingRole((prev) => ({ ...prev, [memberId]: true }))
    try {
      await api.updateMember(org.id, memberId, newRole)
      addToast({ type: 'success', title: 'Role updated' })
      await fetchMembers()
    } catch {
      addToast({ type: 'error', title: 'Failed to update role' })
    } finally {
      setUpdatingRole((prev) => ({ ...prev, [memberId]: false }))
    }
  }

  return (
    <SectionCard
      title="Team"
      description="Manage team members and their roles."
      action={
        <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
          <DialogTrigger render={<Button size="sm" />}>
            <Plus data-icon="inline-start" /> Invite member
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
                {inviting && <Spinner data-icon="inline-start" />}
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
        <div className="-mx-[--card-spacing] px-[--card-spacing]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.userId}>
                  <TableCell>
                    <div>
                      <p className="font-medium">{m.name || m.email || 'Unknown'}</p>
                      {m.name && <p className="text-xs text-muted-foreground">{m.email}</p>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Select
                      defaultValue={m.role}
                      onValueChange={(v) => v && handleChangeRole(m.userId, v)}
                      disabled={updatingRole[m.userId]}
                    >
                      <SelectTrigger size="sm" className="w-28">
                        {updatingRole[m.userId] ? (
                          <Spinner className="mx-auto" />
                        ) : (
                          <SelectValue />
                        )}
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="owner">Owner</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                        <SelectItem value="developer">Developer</SelectItem>
                        <SelectItem value="viewer">Viewer</SelectItem>
                        <SelectItem value="billing">Billing</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <RoleBadge role={m.role} />
                  </TableCell>
                  <TableCell className="text-right">
                    {m.role !== 'owner' && (
                      <AlertDialog>
                        <AlertDialogTrigger render={<Button variant="destructive" size="xs" />}>
                            {removingId === m.userId ? (
                            <Spinner data-icon="inline-start" />
                          ) : (
                            <Trash2 data-icon="inline-start" />
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
                              onClick={() => handleRemoveMember(m.userId)}
                            >
                              Remove
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
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


