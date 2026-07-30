'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { AlertTriangle, Bell, Building2, CreditCard, Key, User, Users, Wallet } from 'lucide-react'
import { Breadcrumbs } from '@/components/ui/breadcrumbs'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'

import { ProfileSection } from '@/components/dashboard/settings/profile-section'
import { OrganizationSection } from '@/components/dashboard/settings/organization-section'
import { TeamSection } from '@/components/dashboard/settings/team-section'
import { WalletsSection } from '@/components/dashboard/settings/wallets-section'
import { ApiKeysSection } from '@/components/dashboard/settings/api-keys-section'
import { NotificationsSection } from '@/components/dashboard/settings/notifications-section'
import { BillingSection } from '@/components/dashboard/settings/billing-section'
import { DangerZoneSection } from '@/components/dashboard/settings/danger-zone-section'
import { PageTransition } from '@/components/dashboard/page-transition'

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
  const router = useRouter()
  const searchParams = useSearchParams()
  const tab = searchParams.get('tab') || 'profile'

  const handleTabChange = (value: string) => {
    router.replace(`/dashboard/settings?tab=${value}`, { scroll: false })
  }

  return (
      <PageTransition>
      <div className="flex flex-col gap-6">
        <Breadcrumbs items={[{ label: 'Settings' }]} />

        <div>
          <p className="text-sm text-primary">Configuration</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your profile, organization, and preferences.
          </p>
        </div>

        <Tabs value={tab} onValueChange={handleTabChange}>
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
    </PageTransition>
  )
}
