import { ShieldCheck } from 'lucide-react'

export default function SecuritySection() {
  return (
    <section id="security" className="mx-auto max-w-7xl px-5 py-20 sm:py-24 lg:px-8">
      <div className="grid gap-10 lg:grid-cols-2 lg:gap-12">
        <div>
          <p className="text-sm font-semibold text-accent">Resilient by construction</p>
          <h2 className="mt-3 text-balance text-2xl font-semibold tracking-tight sm:text-4xl">Our bot can go offline. Your renewal path stays online.</h2>
          <p className="mt-6 leading-relaxed text-muted-foreground">
            Walwatch coordinates execution; it does not control it. The contract exposes a permissionless renewal function, so any keeper can act when your policy conditions are met.
          </p>
        </div>
        <div className="rounded-3xl border border-border bg-card p-6 sm:p-7">
          <div className="flex items-start gap-4">
            <ShieldCheck className="mt-1 shrink-0 text-accent" size={20} />
            <div>
              <h3 className="font-semibold">Contract audit status</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Audit pending. Testnet contracts and source will be public before mainnet launch. Treat this preview as early-stage software, not audited infrastructure.
              </p>
            </div>
          </div>
          <div className="mt-8 rounded-xl border border-border bg-background/50 px-4 py-3 font-mono text-xs text-muted-foreground">
            renew(vault_id) &rarr; verify policy &rarr; pay storage &rarr; emit event
          </div>
        </div>
      </div>
    </section>
  )
}
