import { Bot, CircleDollarSign, Code2, KeyRound, ShieldCheck, Wallet } from 'lucide-react'

const features = [
  { icon: KeyRound, title: 'Non-custodial by design', text: 'Your vault stays under your control. Withdraw unused WAL or reclaim the vault at any time.' },
  { icon: Code2, title: 'Permissionless execution', text: 'The renewal function is public. Our keeper is convenient—not a point of trust or failure.' },
  { icon: CircleDollarSign, title: 'On-chain, predictable fees', text: 'Every fee is enforced by the contract and visible before you fund a renewal.' },
  { icon: Wallet, title: 'Exit whenever you want', text: 'Pause, update policy, withdraw, or reclaim without asking us for permission.' },
  { icon: Bot, title: 'Keeper redundancy', text: 'Multiple independent callers can compete to keep every eligible blob renewed.' },
  { icon: ShieldCheck, title: 'Policy guardrails', text: 'Thresholds and spending caps put automation inside boundaries you define.' },
]

export default function FeaturesSection() {
  return (
    <section className="border-y border-border bg-card/30">
      <div className="mx-auto max-w-7xl px-5 py-20 sm:py-24 lg:px-8">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold text-primary">Control without overhead</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-4xl">Automation you can verify.</h2>
        </div>
        <div className="mt-10 grid gap-4 sm:mt-12 sm:grid-cols-2 lg:grid-cols-3">
          {features.map(({ icon: Icon, title, text }) => (
            <article
              key={title}
              className="group rounded-2xl border border-border bg-card p-6 transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/20 hover:shadow-md hover:shadow-primary/5"
            >
              <span className="grid size-10 place-items-center rounded-xl bg-secondary text-primary transition-colors group-hover:bg-primary/20 sm:size-11">
                <Icon size={18} className="sm:size-[19px]" />
              </span>
              <h3 className="mt-5 font-semibold sm:mt-6">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{text}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
