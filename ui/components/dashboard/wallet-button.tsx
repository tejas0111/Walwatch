'use client'

import {
  useCurrentAccount,
  useConnectWallet,
  useDisconnectWallet,
  useWallets,
} from '@mysten/dapp-kit'
import { Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

function truncateAddress(addr: string, chars = 4): string {
  return `${addr.slice(0, chars + 2)}...${addr.slice(-chars)}`
}

export function WalletButton({ className }: { className?: string }) {
  const account = useCurrentAccount()
  const { mutate: connect, isPending: isConnecting } = useConnectWallet()
  const { mutate: disconnect } = useDisconnectWallet()
  const wallets = useWallets()
  const suiWallet = wallets.find((w) => w.name === 'Sui Wallet')

  if (isConnecting) {
    return (
      <Button disabled variant="outline" className={cn('w-full', className)}>
        <Spinner size={14} />
        Connecting…
      </Button>
    )
  }

  if (!account) {
    return (
      <Button variant="outline" onClick={() => suiWallet && connect({ wallet: suiWallet })} className={cn('w-full', className)}>
        <Wallet />
        <span>Connect Wallet</span>
      </Button>
    )
  }

  return (
    <div className={cn('relative', className)}>
      <Button variant="outline" onClick={() => disconnect()} className="w-full">
        <Wallet className="text-primary" />
        <span className="font-mono">{truncateAddress(account.address)}</span>
      </Button>

      <div className="mt-2 rounded-xl border border-border bg-card p-3 shadow-xl">
        <div className="space-y-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              Address
            </p>
            <p className="mt-0.5 break-all font-mono text-xs text-foreground">
              {account.address}
            </p>
            <Button variant="link" size="xs" onClick={() => navigator.clipboard.writeText(account.address)} className="mt-1">
              Copy
            </Button>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              Network
            </p>
            <p className="mt-0.5 text-xs text-foreground">unknown</p>
          </div>
        </div>
      </div>
    </div>
  )
}
