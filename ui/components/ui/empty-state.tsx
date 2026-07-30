import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon
  title: string
  description: string
  action?: {
    label: string
    href?: string
    onClick?: () => void
  }
  className?: string
}) {
  const actionEl = action?.href ? (
    <Link
      href={action.href}
      className="mt-6 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
    >
      {action.label}
    </Link>
  ) : action?.onClick ? (
    <Button variant="outline" size="sm" onClick={action.onClick} className="mt-6">
      {action.label}
    </Button>
  ) : null

  return (
    <div
      className={cn(
        'rounded-3xl border border-dashed border-border bg-card px-6 py-20 text-center',
        className,
      )}
      role="status"
    >
      <Icon className="mx-auto text-muted-foreground" size={32} />
      <h2 className="mt-5 font-semibold">{title}</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">{description}</p>
      {actionEl}
    </div>
  )
}
