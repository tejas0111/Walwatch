import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowRight,
  Bot,
  CircleDollarSign,
  Code2,
  Database,
  KeyRound,
  ShieldCheck,
  Wallet,
} from 'lucide-react'
import { HeroVisual } from '@/components/marketing/hero-visual'
import { Brand, SiteHeader } from '@/components/marketing/site-header'

type Step = [string, string, string]

const steps: Step[] = [
  ['01', 'Deposit WAL', 'Fund a dedicated on-chain vault. Your tokens never enter our custody.'],
  ['02', 'Set your policy', 'Choose your renewal threshold, extension, and maximum spend.'],
  ['03', 'Keepers execute', 'Any keeper can call the public renewal function before expiry.'],
  ['04', 'Stay online', 'Your Walrus blobs renew without repeated signatures or calendar reminders.'],
]

interface Feature {
  icon: LucideIcon
  title: string
  text: string
}

const features: Feature[] = [
  {
    icon: KeyRound,
    title: 'Non-custodial by design',
    text: 'Your vault stays under your control. Withdraw unused WAL or reclaim the vault at any time.',
  },
  {
    icon: Code2,
    title: 'Permissionless execution',
    text: 'The renewal function is public. Our keeper is convenient—not a point of trust or failure.',
  },
  {
    icon: CircleDollarSign,
    title: 'On-chain, predictable fees',
    text: 'Every fee is enforced by the contract and visible before you fund a renewal.',
  },
  {
    icon: Wallet,
    title: 'Exit whenever you want',
    text: 'Pause, update policy, withdraw, or reclaim without asking us for permission.',
  },
  {
    icon: Bot,
    title: 'Keeper redundancy',
    text: 'Multiple independent callers can compete to keep every eligible blob renewed.',
  },
  {
    icon: ShieldCheck,
    title: 'Policy guardrails',
    text: 'Thresholds and spending caps put automation inside boundaries you define.',
  },
]

function StepCard({ num, title, desc }: { num: string; title: string; desc: string }) {
  return (
    <article className="bg-background p-7">
      <span className="font-mono text-xs text-primary">{num}</span>
      <h3 className="mt-12 font-semibold">{title}</h3>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{desc}</p>
    </article>
  )
}

function FeatureCard({ icon: Icon, title, text }: Feature) {
  return (
    <article className="rounded-2xl border border-border bg-card p-6">
      <span className="grid size-10 place-items-center rounded-xl bg-secondary text-primary">
        <Icon size={19} />
      </span>
      <h3 className="mt-6 font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{text}</p>
    </article>
  )
}

export default function Page() {
  return (
    <main className="min-h-screen overflow-hidden">
      <SiteHeader />

      <section className="relative border-b border-border">
        <div aria-hidden="true" className="absolute inset-0 grid-pattern opacity-20" />
        <div aria-hidden="true" className="absolute inset-x-0 top-0 h-80 hero-glow" />
        <div className="relative mx-auto grid max-w-7xl items-center gap-16 px-5 py-16 md:py-24 lg:grid-cols-[.9fr_1.1fr] lg:px-8 lg:py-28">
          <div className="max-w-xl">
            <div className="mb-8 flex items-center gap-3 text-xs font-medium uppercase tracking-[.14em] text-muted-foreground">
              <span className="h-px w-8 bg-primary" />
              Walrus renewal infrastructure
            </div>
            <h1 className="text-balance text-5xl font-medium leading-[1.02] tracking-[-0.05em] sm:text-6xl lg:text-[4.25rem]">
              Keep your blobs alive.<br /><span className="text-muted-foreground">Automatically.</span>
            </h1>
            <p className="mt-7 max-w-lg text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
              A non-custodial renewal layer for Walrus. Fund once, define your limits, and let permissionless keepers handle every renewal.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/dashboard"
                className="flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
              >
                Create a vault <ArrowRight size={16} />
              </Link>
              <a
                href="#how"
                className="flex items-center justify-center rounded-lg border border-border bg-background/60 px-5 py-3 text-sm font-medium transition-colors hover:bg-muted"
              >
                How it works
              </a>
            </div>
            <dl className="mt-12 grid grid-cols-3 border-t border-border pt-5">
              <div>
                <dt className="text-xs text-muted-foreground">Custody</dt>
                <dd className="mt-1 text-sm font-medium">You</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Execution</dt>
                <dd className="mt-1 text-sm font-medium">Open</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Settlement</dt>
                <dd className="mt-1 text-sm font-medium">On-chain</dd>
              </div>
            </dl>
          </div>
          <HeroVisual />
        </div>
      </section>

      <section className="border-y border-border bg-card/30">
        <div className="mx-auto grid max-w-7xl gap-8 px-5 py-20 lg:grid-cols-2 lg:px-8">
          <div className="rounded-3xl border border-border bg-card p-7 lg:p-10">
            <p className="text-xs font-semibold uppercase tracking-[.18em] text-muted-foreground">Without Walwatch</p>
            <h2 className="mt-4 text-2xl font-semibold">Manual renewal is a hidden reliability risk.</h2>
            <ul className="mt-8 flex flex-col gap-5 text-sm text-muted-foreground">
              <li>Calendar reminders arrive too late—or not at all.</li>
              <li>Every renewal interrupts your team for a wallet signature.</li>
              <li>One missed epoch can make a critical blob unavailable.</li>
            </ul>
          </div>
          <div className="rounded-3xl border border-primary/30 bg-primary/10 p-7 lg:p-10">
            <p className="text-xs font-semibold uppercase tracking-[.18em] text-primary">With Walwatch</p>
            <h2 className="mt-4 text-2xl font-semibold">Policy-driven renewals, executed in public.</h2>
            <p className="mt-8 text-sm leading-relaxed text-muted-foreground">
              Fund a vault and encode your limits once. Keepers monitor expiry and renew when your
              policy allows. If ours disappears, anyone else can execute the same contract call.
            </p>
          </div>
        </div>
      </section>

      <section id="how" className="mx-auto max-w-7xl px-5 py-24 lg:px-8">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold text-primary">How it works</p>
          <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Four steps between you and permanent peace of mind.
          </h2>
        </div>
        <div className="mt-12 grid gap-px overflow-hidden rounded-3xl border border-border bg-border md:grid-cols-2 lg:grid-cols-4">
          {steps.map(([num, title, desc]) => (
            <StepCard key={num} num={num} title={title} desc={desc} />
          ))}
        </div>
      </section>

      <section className="border-y border-border bg-card/30">
        <div className="mx-auto max-w-7xl px-5 py-24 lg:px-8">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold text-primary">Control without overhead</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Automation you can verify.</h2>
          </div>
          <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <FeatureCard key={feature.title} {...feature} />
            ))}
          </div>
        </div>
      </section>

      <section id="security" className="mx-auto grid max-w-7xl gap-12 px-5 py-24 lg:grid-cols-2 lg:px-8">
        <div>
          <p className="text-sm font-semibold text-accent">Resilient by construction</p>
          <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Our bot can go offline. Your renewal path stays online.
          </h2>
          <p className="mt-6 leading-relaxed text-muted-foreground">
            Walwatch coordinates execution; it does not control it. The contract exposes a
            permissionless renewal function, so any keeper can act when your policy conditions are met.
          </p>
        </div>
        <div className="rounded-3xl border border-border bg-card p-7">
          <div className="flex items-start gap-4">
            <ShieldCheck className="mt-1 text-accent" />
            <div>
              <h3 className="font-semibold">Contract audit status</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Audit pending. Testnet contracts and source will be public before mainnet launch.
                Treat this preview as early-stage software, not audited infrastructure.
              </p>
            </div>
          </div>
          <div className="mt-8 border-t border-border pt-6 font-mono text-xs text-muted-foreground">
            renew(vault_id) &rarr; verify policy &rarr; pay storage &rarr; emit event
          </div>
        </div>
      </section>

      <section id="pricing" className="border-y border-border bg-card/30">
        <div className="mx-auto grid max-w-7xl gap-10 px-5 py-24 lg:grid-cols-[.8fr_1.2fr] lg:px-8">
          <div>
            <p className="text-sm font-semibold text-primary">Transparent pricing</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">Pay when a renewal succeeds.</h2>
            <p className="mt-5 text-sm leading-relaxed text-muted-foreground">
              No custody fee. No lock-in. The protocol fee is charged from your vault only after an
              eligible renewal executes.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <article className="rounded-3xl border border-primary/40 bg-primary/10 p-7">
              <span className="text-sm text-primary">Protocol</span>
              <div className="mt-5 text-4xl font-semibold">3&ndash;5%</div>
              <p className="mt-2 text-sm text-muted-foreground">of each renewal cost</p>
              <ul className="mt-8 flex flex-col gap-3 text-sm">
                <li>On-chain automation</li>
                <li>Permissionless keepers</li>
                <li>Public renewal history</li>
              </ul>
            </article>
            <article className="rounded-3xl border border-border bg-card p-7">
              <span className="text-sm text-muted-foreground">Pro subscription</span>
              <div className="mt-5 text-4xl font-semibold">Soon</div>
              <p className="mt-2 text-sm text-muted-foreground">for operational teams</p>
              <ul className="mt-8 flex flex-col gap-3 text-sm">
                <li>Low-latency execution</li>
                <li>Team dashboards</li>
                <li>Priority alerts</li>
              </ul>
            </article>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-5 py-24 text-center">
        <Database className="mx-auto text-primary" />
        <h2 className="mx-auto mt-6 max-w-2xl text-balance text-4xl font-semibold tracking-tight">
          Fund once. Keep your storage alive.
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
          Create your first vault and see exactly how many renewals your WAL balance can cover.
        </p>
        <Link
          href="/dashboard"
          className="mt-8 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3.5 text-sm font-semibold text-primary-foreground"
        >
          Launch app <ArrowRight size={17} />
        </Link>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-7xl flex-col gap-8 px-5 py-10 sm:flex-row sm:items-center sm:justify-between lg:px-8">
          <Brand />
          <div className="flex gap-6 text-sm text-muted-foreground">
            <a href="#">Docs</a>
            <a href="#">GitHub</a>
            <a href="#">X / Twitter</a>
          </div>
          <p className="text-xs text-muted-foreground">&copy; 2026 Walwatch</p>
        </div>
      </footer>
    </main>
  )
}