import {
  LayoutDashboard,
  BarChart3,
  Database,
  Wallet,
  FolderOpen,
  Shield,
  Bell,
  Users,
  Settings,
  ScrollText,
  CreditCard,
  Activity,
  ShieldCheck,
  Key,
  Coins,
  Ban,
  Handshake,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  href: string
  label: string
  icon: LucideIcon
}

export interface NavSection {
  label: string
  items: NavItem[]
}

export const navSections: NavSection[] = [
  {
    label: 'OVERVIEW',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/dashboard/analytics', label: 'Analytics', icon: BarChart3 },
    ],
  },
  {
    label: 'STORAGE',
    items: [
      { href: '/dashboard/vaults', label: 'Vaults', icon: ShieldCheck },
      { href: '/dashboard/blobs', label: 'Blobs', icon: Database },
      { href: '/dashboard/settings?tab=wallets', label: 'Wallets', icon: Wallet },
    ],
  },
  {
    label: 'MANAGEMENT',
    items: [
      { href: '/dashboard/projects', label: 'Projects', icon: FolderOpen },
      { href: '/dashboard/policies', label: 'Policies', icon: Shield },
      { href: '/dashboard/budgets', label: 'Budgets', icon: Coins },
      { href: '/dashboard/spending-limits', label: 'Spending Limits', icon: Ban },
      { href: '/dashboard/delegations', label: 'Delegations', icon: Handshake },
      { href: '/dashboard/alerts', label: 'Alerts', icon: Bell },
    ],
  },
  {
    label: 'ADMIN',
    items: [
      { href: '/dashboard/settings?tab=team', label: 'Team', icon: Users },
      { href: '/dashboard/settings?tab=api-keys', label: 'API Keys', icon: Key },
      { href: '/dashboard/settings', label: 'Settings', icon: Settings },
      { href: '/dashboard/audit-logs', label: 'Audit Logs', icon: ScrollText },
      { href: '/dashboard/settings?tab=billing', label: 'Billing', icon: CreditCard },
      { href: '/dashboard/status', label: 'Status', icon: Activity },
    ],
  },
]
