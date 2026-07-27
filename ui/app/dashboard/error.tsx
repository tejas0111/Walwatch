'use client'

import { useEffect } from 'react'
import { AlertCircle, RefreshCw } from 'lucide-react'

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Dashboard error:', error)
  }, [error])

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-8">
      <div className="rounded-3xl border border-destructive/30 bg-destructive/5 px-8 py-12 text-center">
        <AlertCircle className="mx-auto text-destructive" size={36} />
        <h1 className="mt-5 text-xl font-semibold text-destructive">Dashboard error</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
          Something went wrong loading this page. Please try again.
        </p>
        <button
          onClick={reset}
          className="mt-8 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          <RefreshCw size={16} />
          Try again
        </button>
      </div>
    </div>
  )
}
