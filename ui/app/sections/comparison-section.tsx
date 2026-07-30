import { Check } from 'lucide-react'

const withoutPains = [
  'Calendar reminders arrive too late—or not at all.',
  'Every renewal interrupts your team for a wallet signature.',
  'One missed epoch can make a critical blob unavailable.',
]

const withBenefits = [
  'Fund once, set policy, forget.',
  'Keepers monitor expiry around the clock.',
  'Permissionless — anyone can renew.',
  'Full transparency on-chain.',
]

export default function ComparisonSection() {
  return (
    <section className="border-y border-border bg-card/30">
      <div className="mx-auto max-w-7xl px-5 py-16 sm:py-20 lg:px-8">
        <div className="mb-10 text-center">
          <p className="text-sm font-semibold text-primary">Why Walwatch</p>
          <h2 className="mt-3 text-balance text-2xl font-semibold tracking-tight sm:text-3xl">The difference is automation you can trust.</h2>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-3xl border border-border bg-card p-6 sm:p-8 lg:p-10">
            <div className="flex items-center gap-3">
              <span className="flex size-8 items-center justify-center rounded-full bg-muted text-lg">&times;</span>
              <p className="text-xs font-semibold uppercase tracking-[.18em] text-muted-foreground">Without Walwatch</p>
            </div>
            <h2 className="mt-4 text-xl font-semibold sm:text-2xl">Manual renewal is a hidden reliability risk.</h2>
            <ul className="mt-6 flex flex-col gap-4 sm:mt-8">
              {withoutPains.map((item) => (
                <li key={item} className="flex items-start gap-3 text-sm text-muted-foreground">
                  <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-muted text-xs text-muted-foreground">&times;</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-3xl border border-primary/30 bg-primary/[0.08] p-6 sm:p-8 lg:p-10">
            <div className="flex items-center gap-3">
              <span className="flex size-8 items-center justify-center rounded-full bg-primary/20 text-primary">&check;</span>
              <p className="text-xs font-semibold uppercase tracking-[.18em] text-primary">With Walwatch</p>
            </div>
            <h2 className="mt-4 text-xl font-semibold sm:text-2xl">Policy-driven renewals, executed in public.</h2>
            <ul className="mt-6 flex flex-col gap-4 sm:mt-8">
              {withBenefits.map((item) => (
                <li key={item} className="flex items-start gap-3 text-sm text-muted-foreground">
                  <Check size={14} className="mt-0.5 shrink-0 text-primary" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  )
}
