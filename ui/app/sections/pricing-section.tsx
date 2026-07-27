import { Check, Database } from 'lucide-react'

export default function PricingSection() {
  return (
    <>
      <section id="pricing" className="border-y border-border bg-card/30">
        <div className="mx-auto max-w-7xl px-5 py-20 sm:py-24 lg:px-8">
          <div className="mb-10 max-w-lg lg:mb-12">
            <p className="text-sm font-semibold text-primary">Transparent pricing</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">Pay when a renewal succeeds.</h2>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              No custody fee. No lock-in. The protocol fee is charged from your vault only after an eligible renewal executes.
            </p>
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <article className="relative rounded-3xl border border-primary/40 bg-primary/[0.08] p-7 sm:p-8">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-primary">Protocol</span>
                <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-0.5 text-[11px] text-primary">Active</span>
              </div>
              <div className="mt-6 flex items-baseline gap-1">
                <span className="text-4xl font-semibold sm:text-5xl">3&ndash;5%</span>
                <span className="text-sm text-muted-foreground">of each renewal cost</span>
              </div>
              <ul className="mt-8 flex flex-col gap-3 border-t border-border pt-6 text-sm">
                {['On-chain automation', 'Permissionless keepers', 'Public renewal history', 'No monthly fee'].map((item) => (
                  <li key={item} className="flex items-center gap-2.5">
                    <Check size={14} className="shrink-0 text-primary" />
                    {item}
                  </li>
                ))}
              </ul>
            </article>
            <article className="relative rounded-3xl border border-border bg-card p-7 sm:p-8">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-muted-foreground">Pro subscription</span>
                <span className="rounded-full border border-border bg-muted px-3 py-0.5 text-[11px] text-muted-foreground">Coming soon</span>
              </div>
              <div className="mt-6 flex items-baseline gap-1">
                <span className="text-4xl font-semibold sm:text-5xl">Soon</span>
                <span className="text-sm text-muted-foreground">for operational teams</span>
              </div>
              <ul className="mt-8 flex flex-col gap-3 border-t border-border pt-6 text-sm">
                {['Low-latency execution', 'Team dashboards', 'Priority alerts', 'Dedicated support'].map((item) => (
                  <li key={item} className="flex items-center gap-2.5">
                    <Check size={14} className="shrink-0 text-muted-foreground" />
                    {item}
                  </li>
                ))}
              </ul>
            </article>
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden border-b border-border">
        <div aria-hidden="true" className="absolute inset-0 grid-pattern opacity-10" />
        <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-48 hero-glow" />
        <div className="relative mx-auto max-w-5xl px-5 py-20 text-center sm:py-24">
          <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-4 py-1.5 text-xs text-primary">
            <Database size={12} />
            Ready for mainnet
          </div>
          <h2 className="mx-auto mt-6 max-w-2xl text-balance text-3xl font-semibold tracking-tight sm:text-4xl">Fund once. Keep your storage alive.</h2>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            Create your first vault and see exactly how many renewals your WAL balance can cover.
          </p>
          <a
            href="/dashboard"
            className="mt-8 inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:opacity-90 hover:shadow-xl hover:shadow-primary/30"
          >
            Launch app
          </a>
        </div>
      </section>
    </>
  )
}
