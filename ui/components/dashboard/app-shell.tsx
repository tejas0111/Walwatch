'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronRight, LogOut } from 'lucide-react'
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarTrigger,
  SidebarRail,
  SidebarInset,
  SidebarSeparator,
} from '@/components/ui/sidebar'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { WalletButton } from '@/components/dashboard/wallet-button'
import { OrgSwitcher } from '@/components/dashboard/org-switcher'
import { navSections } from '@/components/dashboard/nav-items'
import { useAuth } from '@/lib/auth-provider'

const segmentLabels: Record<string, string> = {
  dashboard: 'Dashboard',
  analytics: 'Analytics',
  new: 'New Vault',
  blobs: 'Blobs',
  wallets: 'Wallets',
  projects: 'Projects',
  policies: 'Policies',
  alerts: 'Alerts',
  billing: 'Billing',
  'audit-logs': 'Audit Logs',
  settings: 'Settings',
  status: 'Status',
  auth: 'Team',
}

function Breadcrumb() {
  const path = usePathname()
  const segments = path.split('/').filter(Boolean)

  if (segments.length === 0) return null

  return (
    <nav className="flex items-center gap-1 text-sm text-muted-foreground">
      {segments.map((segment, i) => {
        const href = '/' + segments.slice(0, i + 1).join('/')
        const label = segmentLabels[segment] ?? segment
        const isLast = i === segments.length - 1
        return (
          <span key={href} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="size-3.5" />}
            {isLast ? (
              <span className="font-medium text-foreground">{label}</span>
            ) : (
              <Link href={href} className="transition-colors hover:text-foreground">
                {label}
              </Link>
            )}
          </span>
        )
      })}
    </nav>
  )
}

function UserMenu() {
  const { user, logout } = useAuth()
  if (!user) return null

  const initials = (user.name || user.email || '??')
    .slice(0, 2)
    .toUpperCase()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-2 rounded-md p-2 text-sm outline-none hover:bg-sidebar-accent transition-colors">
        <Avatar>
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
        <div className="flex flex-1 flex-col items-start leading-tight group-data-[collapsible=icon]:hidden">
          <span className="truncate font-medium text-sidebar-foreground max-w-[140px]">
            {user.name || user.email?.split('@')[0]}
          </span>
          <span className="truncate text-xs text-sidebar-foreground/60 max-w-[140px]">
            {user.email}
          </span>
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-64">
        <DropdownMenuLabel>
          <div className="flex flex-col">
            <span className="font-medium">{user.name || 'User'}</span>
            <span className="text-xs text-muted-foreground">
              {user.email}
            </span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={logout}>
          <LogOut className="size-4" />
          <span>Log out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname()

  function isActive(href: string) {
    return href === '/dashboard'
      ? path === href || path === '/dashboard/'
      : path.startsWith(href)
  }

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <Link
            href="/dashboard"
            className="flex items-center gap-2.5 rounded-md p-2 font-semibold tracking-tight hover:bg-sidebar-accent transition-colors"
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
              <span className="size-2.5 rounded-sm border-2 border-current" />
            </span>
            <span className="group-data-[collapsible=icon]:hidden truncate">
              Walwatch
            </span>
          </Link>
          <div className="group-data-[collapsible=icon]:hidden">
            <OrgSwitcher />
          </div>
        </SidebarHeader>

        <SidebarSeparator />

        <SidebarContent>
          {navSections.map((section) => (
            <SidebarGroup key={section.label}>
              <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {section.items.map((item) => (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        isActive={isActive(item.href)}
                        tooltip={item.label}
                        render={<Link href={item.href} />}
                      >
                        <item.icon />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>

        <SidebarSeparator />

        <SidebarFooter>
          <UserMenu />
        </SidebarFooter>
      </Sidebar>

      <SidebarRail />

      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
          <SidebarTrigger className="-ml-1 md:hidden" />
          <Breadcrumb />
          <div className="ml-auto">
            <WalletButton />
          </div>
        </header>

        <main className="flex-1 overflow-auto p-4 md:p-8">
          <div className="mx-auto max-w-5xl">{children}</div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
