'use client'

import {
  useCurrentAccount,
  useConnectWallet,
  useDisconnectWallet,
} from '@mysten/dapp-kit'
import { Wallet } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

function truncateAddress(addr: string, chars = 4): string {
  return `${addr.slice(0, chars + 2)}...${addr.slice(-chars)}`
}

export function WalletButton({ className }: { className?: string }) {
  const account = useCurrentAccount()
  const { mutate: connect, isPending: isConnecting } = useConnectWallet()
  const { mutate: disconnect } = useDisconnectWallet()
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  if (isConnecting) {
    return (
      <button
        disabled
        className={cn(
          'flex w-full items-center justify-center gap-2 rounded-lg border border-border px-3 py-2.5 text-xs text-muted-foreground',
          className,
        )}
      >
        <svg className="size-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Connecting…
      </button>
    )
  }

  if (!account) {
    return (
      <button
        onClick={() => {
          connect({ wallet: { name: 'Sui Wallet' } as Parameters<typeof connect>[0]['wallet'] })
        }}
        className={cn(
          'flex w-full items-center justify-center gap-2 rounded-lg border border-border px-3 py-2.5 text-xs transition-colors hover:bg-muted/60 hover:text-foreground',
          className,
        )}
      >
        <Wallet size={14} />
        <span>Connect Wallet</span>
      </button>
    )
  }

  return (
    <div ref={menuRef} className={cn('relative', className)}>
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2.5 text-xs transition-colors hover:bg-muted/60"
      >
        <Wallet size={14} className="text-primary" />
        <span className="font-mono">{truncateAddress(account.address)}</span>
      </button>

      {open && (
        <div className="absolute bottom-full left-0 right-0 mb-2 rounded-xl border border-border bg-card p-3 shadow-xl">
          <div className="space-y-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                Address
              </p>
              <p className="mt-0.5 break-all font-mono text-xs text-foreground">
                {account.address}
              </p>
              <button
                onClick={() => navigator.clipboard.writeText(account.address)}
                className="mt-1 text-[10px] text-primary hover:underline"
              >
                Copy
              </button>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                Network
              </p>
              <p className="mt-0.5 text-xs text-foreground">testnet</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                Balance
              </p>
              <p className="mt-0.5 text-xs text-foreground">--- WAL</p>
            </div>
            <button
              onClick={() => {
                disconnect()
                setOpen(false)
              }}
              className="w-full rounded-lg border border-destructive/30 px-3 py-2 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10"
            >
              Disconnect
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
