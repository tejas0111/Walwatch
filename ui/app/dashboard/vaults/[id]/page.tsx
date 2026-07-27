import Link from 'next/link'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  Check,
  Clock3,
  Coins,
  Copy,
  RefreshCw,
} from 'lucide-react'

import { vaults } from '@/components/dashboard/vault-data'
import type { Vault } from '@/components/dashboard/vault-data'

export default async function VaultDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const vault = vaults.find((v) => v.id === id) ?? vaults[0];
  const runway = Math.floor(vault.balance / vault.estimatedCost);
  const pct = Math.min(100, (runway / 12) * 100);

  return (
    <>
      <Link
        href="/dashboard"
        className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft size={16} />
        All vaults
      </Link>

      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs text-accent">
              <span className="size-2 rounded-full bg-accent" />
              Active
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">{vault.name}</h1>
            <p className="mt-2 flex items-center gap-2 font-mono text-xs text-muted-foreground">
              {vault.id}
              <Copy size={13} />
            </p>
          </div>
          <div className="flex gap-2">
            <button className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted">
              Edit policy
            </button>
            <button className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted">
              Deposit WAL
            </button>
          </div>
        </div>

        <section className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
          <div>
            {/* Main funding card */}
            <div className="rounded-3xl border border-primary/35 bg-primary/10 p-6 lg:p-8">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-primary">Funding runway</p>
                  <div className="mt-3 flex items-baseline gap-2">
                    <span className="text-5xl font-semibold">{runway}</span>
                    <span className="text-muted-foreground">projected renewals</span>
                  </div>
                </div>
                <Coins className="text-primary" />
              </div>

              <div className="mt-8 h-2 overflow-hidden rounded-full bg-background">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${pct}%` }}
                />
              </div>

              <div className="mt-4 flex items-start gap-3 text-xs leading-relaxed text-muted-foreground">
                {runway < 3 ? (
                  <AlertTriangle size={16} className="shrink-0 text-destructive" />
                ) : (
                  <Check size={16} className="shrink-0 text-accent" />
                )}
                <p>
                  Based on {vault.threshold}% balance threshold of {vault.estimatedCost.toFixed(1)} WAL per renewal cycle. The
                  next threshold check is triggered at{' '}
                  {vault.balance < 20 ? (
                    <span className="text-destructive">10% of current balance</span>
                  ) : (
                    <span>20% of current balance</span>
                  )}
                  .
                </p>
              </div>
            </div>

            {/* Balance monitoring */}
            <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
              <RefreshCw size={13} />
              Balance monitoring triggered at {vault.estimatedCost.toFixed(1)} WAL
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <Info
              icon={Clock3}
              label="Created"
              value="Jul 2024"
            />
            <Info
              icon={ArrowUpRight}
              label="Renewals"
              value={`${vault.renewals} total`}
            />
            <Info
              icon={Coins}
              label="Extension"
              value={`${vault.extension} days`}
            />
            <Info
              icon={ArrowUpRight}
              label="Next epoch"
              value={`Epoch ${vault.nextEpoch}`}
            />
          </div>
        </section>
      </div>
    </>
  );
}

function Info({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Clock3;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon size={15} />
        {label}
      </div>
      <p className="mt-3 text-xl font-semibold">{value}</p>
    </div>
  );
}
