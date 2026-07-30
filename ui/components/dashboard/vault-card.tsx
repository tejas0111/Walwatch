import Link from 'next/link'
import { ArrowUpRight, Clock3, Database, RefreshCw } from 'lucide-react'
import type { Vault } from './vault-data'

export function VaultCard({ vault }: { vault: Vault }) {
  const runway = Math.floor(vault.balance / vault.estimatedCost)

  return (
    <Link
      href={`/dashboard/vaults/${vault.id}`}
      className="group rounded-2xl border border-border bg-card p-6 transition-colors hover:border-primary/40"
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span
              className={`size-2 rounded-full ${vault.active ? 'bg-accent' : 'bg-muted-foreground'}`}
              aria-hidden="true"
            />
            <span className="text-xs text-muted-foreground">
              {vault.active ? 'Active' : 'Paused'}
            </span>
          </div>
          <h3 className="mt-3 font-semibold">{vault.name}</h3>
          <p className="mt-1 font-mono text-xs text-muted-foreground">{vault.id}</p>
        </div>
        <ArrowUpRight
          size={18}
          className="text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
          aria-hidden="true"
        />
      </div>

      <div className="mt-8 flex items-end justify-between">
        <div>
          <p className="text-xs text-muted-foreground">Available balance</p>
          <p className="mt-1 text-2xl font-semibold">
            {vault.balance.toFixed(1)}{' '}
            <span className="text-sm text-muted-foreground">WAL</span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Runway</p>
          <p className="mt-1 font-medium">~{runway} renewals</p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-2 border-t border-border pt-5 text-xs">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <RefreshCw size={13} aria-hidden="true" />
          {vault.renewals} done
        </span>
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Clock3 size={13} aria-hidden="true" />
          {vault.threshold} epochs
        </span>
        <span className="flex items-center justify-end gap-1.5 text-muted-foreground">
          <Database size={13} aria-hidden="true" />
          {vault.extension} extend
        </span>
      </div>
    </Link>
  )
}
