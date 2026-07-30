'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function SettingsError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Settings error:', error)
  }, [error])

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-8">
      <div className="rounded-3xl border border-destructive/30 bg-destructive/5 px-8 py-12 text-center" role="alert">
        <AlertCircle className="mx-auto text-destructive" size={36} />
        <h1 className="mt-5 text-xl font-semibold text-destructive">Settings error</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
          Something went wrong loading settings. Please try again.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <Button onClick={reset}>
            <RefreshCw />
            Try again
          </Button>
          <Button variant="outline" render={<Link href="/dashboard" />}>
            Back to dashboard
          </Button>
        </div>
      </div>
    </div>
  )
}
