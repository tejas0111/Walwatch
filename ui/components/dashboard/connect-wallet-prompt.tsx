'use client'

import { useCurrentAccount } from '@mysten/dapp-kit'
import { Wallet } from 'lucide-react'
import { WalletButton } from './wallet-button'

export function ConnectWalletPrompt() {
  const account = useCurrentAccount()

  if (account) return null

  return (
    <div className="rounded-3xl border border-dashed border-border bg-card px-6 py-20 text-center">
      <Wallet className="mx-auto text-muted-foreground" size={32} />
      <h2 className="mt-5 font-semibold">Connect your Sui wallet to continue</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
        This page requires a wallet connection. Connect your Sui wallet to access
        Walrus vault data and manage your auto-renewals.
      </p>
      <div className="mt-6 flex justify-center">
        <WalletButton className="w-auto px-5 py-2.5 text-sm font-semibold" />
      </div>
    </div>
  )
}
