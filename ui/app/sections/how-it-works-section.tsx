import { Bot, Database, Eye, ShieldCheck } from 'lucide-react'

const steps = [
  { num: '01', title: 'Deposit WAL', desc: 'Fund a dedicated on-chain vault. Your tokens never enter our custody.', icon: Database },
  { num: '02', title: 'Set your policy', desc: 'Choose your renewal threshold, extension, and maximum spend.', icon: ShieldCheck },
  { num: '03', title: 'Keepers execute', desc: 'Any keeper can call the public renewal function before expiry.', icon: Bot },
  { num: '04', title: 'Stay online', desc: 'Your Walrus blobs renew without repeated signatures or calendar reminders.', icon: Eye },
]

export default function HowItWorksSection() {
  return (
    <section id="how" className="mx-auto max-w-7xl px-5 py-20 sm:py-24 lg:px-8">
      <div className="max-w-2xl">
        <p className="text-sm font-semibold text-primary">How it works</p>
        <h2 className="mt-3 text-balance text-2xl font-semibold tracking-tight sm:text-4xl">Four steps between you and permanent peace of mind.</h2>
      </div>
      <div className="mt-10 grid gap-4 sm:mt-12 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step, i) => (
          <article key={step.num} className="group relative rounded-2xl border border-border bg-card p-6 transition-all duration-300 hover:-translate-y-1 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5">
            <div className="flex items-center gap-3 sm:flex-col sm:items-start sm:gap-0">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-primary transition-colors group-hover:bg-primary/20 sm:mb-4">
                <step.icon size={18} />
              </span>
              <span className="font-mono text-xs text-primary sm:mt-12">{step.num}</span>
            </div>
            <h3 className="mt-3 font-semibold sm:mt-1">{step.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.desc}</p>
            {i < steps.length - 1 && (
              <div className="hidden h-px w-8 bg-border lg:absolute lg:-right-2 lg:top-1/2 lg:block" />
            )}
          </article>
        ))}
      </div>
    </section>
  )
}
