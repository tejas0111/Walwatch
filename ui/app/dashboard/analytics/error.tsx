'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { AlertCircle, RefreshCw } from 'lucide-react'

export default function AnalyticsError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Analytics error:', error)
  }, [error])

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-8">
      <div className="rounded-3xl border border-destructive/30 bg-destructive/5 px-8 py-12 text-center">
        <AlertCircle className="mx-auto text-destructive" size={36} />
        <h1 className="mt-5 text-xl font-semibold text-destructive">Analytics error</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
          Something went wrong loading analytics. Please try again.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            onClick={reset}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            <RefreshCw size={16} />
            Try again
          </button>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 rounded-xl border border-border px-5 py-2.5 text-sm font-medium transition-colors hover:bg-muted"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  )
}
