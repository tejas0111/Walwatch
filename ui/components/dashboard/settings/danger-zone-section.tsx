'use client'

import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-provider'
import { api } from '@/lib/api-client'
import { useToast } from '@/lib/toast-context'
import { SectionCard } from '@/components/ui/section-card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
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

export function DangerZoneSection() {
  const { org, logout } = useAuth()
  const { addToast } = useToast()
  const router = useRouter()
  const [confirmName, setConfirmName] = useState('')
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    if (!org || confirmName !== org.name) return
    setDeleting(true)
    try {
      await api.deleteOrg(org.id)
      addToast({ type: 'success', title: 'Organization deleted' })
      logout()
      router.push('/')
    } catch (err) {
      addToast({ type: 'error', title: 'Failed to delete organization', description: err instanceof Error ? err.message : undefined })
      setDeleting(false)
    }
  }

  return (
    <SectionCard title="Danger zone" description="Irreversible and destructive actions for this organization.">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium">Delete organization</p>
            <p className="text-xs text-muted-foreground">
              Permanently delete your organization and all associated data including vaults, blobs, policies, and billing data. This action cannot be undone.
            </p>
          </div>
          <AlertDialog>
            <AlertDialogTrigger render={<Button variant="destructive" size="sm" className="shrink-0" />}>
              <Trash2 data-icon="inline-start" /> Delete organization
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
                  {deleting && <Spinner data-icon="inline-start" />}
                  {deleting ? 'Deleting...' : 'Delete permanently'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
    </SectionCard>
  )
}


