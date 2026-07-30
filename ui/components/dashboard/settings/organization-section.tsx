'use client'

import { useEffect, useState } from 'react'
import { Building2, Save } from 'lucide-react'
import { useAuth } from '@/lib/auth-provider'
import { api } from '@/lib/api-client'
import { useToast } from '@/lib/toast-context'
import { formatDate } from '@/lib/utils'
import { SectionCard } from '@/components/ui/section-card'
import { EmptyState } from '@/components/ui/empty-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CopyButton } from '@/components/ui/copy-button'
import { Spinner } from '@/components/ui/spinner'

export function OrganizationSection() {
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
    api.getSubscription().then((sub) => setPlan(sub.plan)).catch(() => {})
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
            <p className="mt-1 text-sm font-medium">{formatDate(org.createdAt)}</p>
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
            {saving ? <Spinner data-icon="inline-start" /> : <Save data-icon="inline-start" />}
            {saving ? 'Saving...' : 'Save changes'}
          </Button>
        </div>
      </div>
    </SectionCard>
  )
}


