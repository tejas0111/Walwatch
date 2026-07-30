import {
  Activity,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Coins,
  Database,
  FileText,
  Globe,
  Layers,
  Shield,
  Users,
  XCircle,
} from 'lucide-react'

const statusData = {
  overall: 'Operational' as const,
  uptime: '99.97%',
  latency: { p50: 45, p95: 120, p99: 350 },
  activity: { renewals: 1287, vaultsCreated: 342, errors: 3 },
  keeper: {
    lastCycle: '2 min ago',
    nextScan: 'Scheduled',
    leader: '0x8f3a…c7b2',
  },
  network: {
    connected: true,
    name: 'Sui Testnet',
    currentEpoch: 492,
    latestCheckpoint: '19,283,411',
  },
  contract: {
    packageId: '0x4a2d…f91e',
    feeConfigId: '0xb1e7…3a0c',
    treasuryAddr: '0x6c8f…d412',
  },
}

const statusColor = {
  Operational: 'text-accent',
  Degraded: 'text-yellow-400',
  Down: 'text-destructive',
}

const statusBg = {
  Operational: 'bg-accent/15',
  Degraded: 'bg-yellow-400/15',
  Down: 'bg-destructive/15',
}

const statusDot = {
  Operational: 'bg-accent',
  Degraded: 'bg-yellow-400',
  Down: 'bg-destructive',
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-border bg-card p-5 ${className}`}>
      {children}
    </div>
  )
}

function CardHeader({ icon: Icon, title }: { icon: React.ElementType; title: string }) {
  return (
    <div className="mb-4 flex items-center gap-2.5 text-sm font-semibold text-foreground">
      <span className="grid size-8 place-items-center rounded-lg bg-secondary text-primary">
        <Icon size={16} />
      </span>
      {title}
    </div>
  )
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tracking-tight text-foreground">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  )
}

function Badge({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}>
      {children}
    </span>
  )
}

export default function StatusPage() {
  const status = statusData.overall
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-3">
            <Shield size={20} className="text-primary" />
            <span className="text-sm font-semibold">Walwatch</span>
          </div>
          <nav className="flex gap-5 text-xs text-muted-foreground">
            <a href="/" className="transition-colors hover:text-foreground">Home</a>
            <a href="/dashboard" className="transition-colors hover:text-foreground">Dashboard</a>
            <span className="text-foreground">Status</span>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-10">
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">System Status</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Live operational status of the Walwatch keeper network
            </p>
          </div>
          <Badge className={`${statusBg[status]} ${statusColor[status]}`}>
            <span className={`size-1.5 rounded-full ${statusDot[status]}`} />
            {status}
          </Badge>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Card>
            <CardHeader icon={CheckCircle2} title="Uptime" />
            <div className="flex items-baseline gap-1.5">
              <span className="text-3xl font-semibold tracking-tight text-accent">{statusData.uptime}</span>
              <span className="text-xs text-muted-foreground">last 90 days</span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-secondary">
              <div className="h-full w-[99.97%] rounded-full bg-accent" />
            </div>
          </Card>

          <Card>
            <CardHeader icon={Activity} title="API Latency" />
            <div className="grid grid-cols-3 gap-3">
              <Metric label="p50" value={`${statusData.latency.p50}ms`} />
              <Metric label="p95" value={`${statusData.latency.p95}ms`} />
              <Metric label="p99" value={`${statusData.latency.p99}ms`} />
            </div>
          </Card>

          <Card className="sm:col-span-2 lg:col-span-1">
            <CardHeader icon={Clock} title="Last 24h Activity" />
            <div className="grid grid-cols-3 gap-3">
              <Metric label="Renewals" value={statusData.activity.renewals.toLocaleString()} />
              <Metric label="Vaults Created" value={statusData.activity.vaultsCreated.toLocaleString()} />
              <div>
                <p className="text-xs text-muted-foreground">Errors</p>
                <p className={`mt-0.5 text-lg font-semibold tracking-tight ${statusData.activity.errors > 0 ? 'text-destructive' : 'text-foreground'}`}>
                  {statusData.activity.errors}
                </p>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader icon={Users} title="Keeper Status" />
            <div className="space-y-3">
              <Metric label="Last Cycle" value={statusData.keeper.lastCycle} />
              <Metric label="Next Scheduled Scan" value={statusData.keeper.nextScan} />
              <div>
                <p className="text-xs text-muted-foreground">Leader Instance</p>
                <code className="mt-0.5 block text-sm text-foreground">{statusData.keeper.leader}</code>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader icon={Globe} title="Network" />
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className={`size-2 rounded-full ${statusData.network.connected ? 'bg-accent' : 'bg-destructive'}`} />
                <span className="text-sm font-medium text-foreground">{statusData.network.name}</span>
              </div>
              <Metric label="Current Epoch" value={statusData.network.currentEpoch.toLocaleString()} />
              <Metric label="Latest Checkpoint" value={statusData.network.latestCheckpoint} />
            </div>
          </Card>

          <Card>
            <CardHeader icon={FileText} title="Contract" />
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Package ID</p>
                <code className="mt-0.5 block text-xs text-foreground">{statusData.contract.packageId}</code>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">FeeConfig ID</p>
                <code className="mt-0.5 block text-xs text-foreground">{statusData.contract.feeConfigId}</code>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Treasury Address</p>
                <code className="mt-0.5 block text-xs text-foreground">{statusData.contract.treasuryAddr}</code>
              </div>
            </div>
          </Card>
        </div>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-5 py-8 sm:flex-row sm:justify-between">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Shield size={14} className="text-primary" />
            Walwatch Status
          </div>
          <p className="text-xs text-muted-foreground">
            All metrics are updated in real-time. Page auto-refreshes every 30s.
          </p>
        </div>
      </footer>
    </div>
  )
}
