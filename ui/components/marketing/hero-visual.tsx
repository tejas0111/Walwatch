'use client'

import { motion, useReducedMotion } from 'framer-motion'
import { Check, Database, RefreshCw } from 'lucide-react'

export function HeroVisual() {
  const reduced = useReducedMotion()

  return (
    <div className="relative mx-auto w-full max-w-[620px] overflow-hidden rounded-2xl border border-border bg-card shadow-2xl shadow-primary/5">
      <div className="flex h-11 items-center justify-between border-b border-border bg-background/60 px-4">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-muted-foreground/40" />
          <span className="size-2 rounded-full bg-muted-foreground/20" />
          <span className="ml-2 font-mono text-[11px] text-muted-foreground">vault / 0x7A2...91C</span>
        </div>
        <span className="flex items-center gap-2 text-[11px] text-accent"><span className="size-1.5 rounded-full bg-accent" />Keeper network live</span>
      </div>

      <div className="grid min-h-[420px] grid-cols-[1fr_120px] sm:grid-cols-[1fr_160px]">
        <div className="relative grid place-items-center overflow-hidden border-r border-border p-6">
          <div aria-hidden="true" className="absolute inset-0 grid-pattern opacity-50" />
          <div className="relative grid size-64 place-items-center sm:size-72">
            {[0, 1].map((ring) => (
              <motion.div
                key={ring}
                className="absolute rounded-full border border-primary/20"
                style={{ inset: ring * 38 }}
                animate={reduced ? undefined : { rotate: ring ? -360 : 360 }}
                transition={{ duration: ring ? 20 : 28, repeat: Infinity, ease: 'linear' }}
              >
                <span className="absolute left-1/2 top-0 grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-lg border border-primary/30 bg-secondary text-primary shadow-lg">
                  <Database size={16} />
                </span>
              </motion.div>
            ))}
            <motion.div
              animate={reduced ? undefined : { scale: [1, 1.035, 1] }}
              transition={{ duration: 3, repeat: Infinity }}
              className="relative grid size-24 place-items-center rounded-2xl border border-primary/50 bg-primary text-primary-foreground shadow-xl shadow-primary/20"
            >
              <RefreshCw size={29} />
              <motion.span animate={reduced ? undefined : { opacity: [0, .65, 0], scale: [.85, 1.4] }} transition={{ duration: 2, repeat: Infinity }} className="absolute inset-0 rounded-2xl border border-primary" />
            </motion.div>
          </div>
          <span className="absolute bottom-4 left-4 font-mono text-[10px] text-muted-foreground">MONITORING EPOCH 823</span>
        </div>

        <div className="flex flex-col bg-background/35 p-4 sm:p-5">
          <p className="text-[10px] font-medium uppercase tracking-[.15em] text-muted-foreground">Renewal policy</p>
          <div className="mt-6 flex flex-col gap-5">
            <Stat label="Renews at" value="≤ 3 epochs" />
            <Stat label="Extends by" value="10 epochs" />
            <Stat label="Vault balance" value="42.8 WAL" accent />
          </div>
          <div className="mt-auto border-t border-border pt-4">
            <div className="mb-2 flex items-center justify-between text-[11px]"><span className="text-muted-foreground">Ready for renewal</span><span>72%</span></div>
            <div className="h-1 overflow-hidden rounded-full bg-muted"><motion.div initial={{ width: '12%' }} animate={{ width: reduced ? '72%' : ['12%', '72%'] }} transition={{ duration: 2, ease: 'easeOut' }} className="h-full rounded-full bg-primary" /></div>
            <div className="mt-3 flex items-center gap-1.5 text-[11px] text-accent"><Check size={12} />Funded</div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  accent = false,
}: {
  label: string
  value: string
  accent?: boolean
}) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p
        className={`mt-1 font-mono text-sm font-medium ${accent ? 'text-accent' : 'text-foreground'}`}
      >
        {value}
      </p>
    </div>
  )
}
