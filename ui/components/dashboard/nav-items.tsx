import {
  LayoutDashboard,
  BarChart3,
  Plus,
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
      { href: '/dashboard/new', label: 'New Vault', icon: Plus },
      { href: '/dashboard/blobs', label: 'Blobs', icon: Database },
      { href: '/dashboard/wallets', label: 'Wallets', icon: Wallet },
    ],
  },
  {
    label: 'MANAGEMENT',
    items: [
      { href: '/dashboard/projects', label: 'Projects', icon: FolderOpen },
      { href: '/dashboard/policies', label: 'Policies', icon: Shield },
      { href: '/dashboard/alerts', label: 'Alerts', icon: Bell },
    ],
  },
  {
    label: 'ADMIN',
    items: [
      { href: '/dashboard/auth', label: 'Team', icon: Users },
      { href: '/dashboard/settings', label: 'Settings', icon: Settings },
      { href: '/dashboard/audit-logs', label: 'Audit Logs', icon: ScrollText },
      { href: '/dashboard/billing', label: 'Billing', icon: CreditCard },
      { href: '/dashboard/status', label: 'Status', icon: Activity },
    ],
  },
]
