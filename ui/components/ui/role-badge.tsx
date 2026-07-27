import { cn } from '@/lib/utils'

const ROLE_BADGE_VARIANT: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  owner: 'default',
  admin: 'secondary',
  developer: 'default',
  viewer: 'outline',
  billing: 'secondary',
}

const ROLE_BADGE_COLOR: Record<string, string> = {
  owner: 'bg-amber-500/15 text-amber-500',
  admin: 'bg-blue-500/15 text-blue-500',
  developer: 'bg-green-500/15 text-green-500',
  viewer: 'bg-muted text-muted-foreground',
  billing: 'bg-purple-500/15 text-purple-500',
}

function RoleBadge({ role }: { role: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center rounded-full px-2 text-xs font-medium',
        ROLE_BADGE_COLOR[role] || 'bg-muted text-muted-foreground',
      )}
    >
      {role}
    </span>
  )
}

export { RoleBadge, ROLE_BADGE_COLOR, ROLE_BADGE_VARIANT }
export default RoleBadge
