'use client'

import { useAuth } from '@/lib/auth-provider'
import { SectionCard } from '@/components/ui/section-card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'

export function ProfileSection() {
  const { user } = useAuth()

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
            <Input id="profile-name" value={user?.name || ''} disabled />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Email</Label>
            <Input value={user?.email || ''} disabled />
          </div>
        </div>

        <Separator />

        <div>
          <h3 className="text-sm font-medium">Change password</h3>
          <p className="text-xs text-muted-foreground mt-1">Password changes are managed through your identity provider.</p>
        </div>
      </div>
    </SectionCard>
  )
}


