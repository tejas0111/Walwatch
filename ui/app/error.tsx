'use client'

import { useEffect } from 'react'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { Brand } from '@/components/marketing/site-header'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Global error:', error)
  }, [error])

  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col items-center justify-center bg-background p-8 text-center">
        <Brand />
        <div className="mt-10 rounded-3xl border border-destructive/30 bg-destructive/5 px-8 py-12">
          <AlertCircle className="mx-auto text-destructive" size={40} />
          <h1 className="mt-5 text-2xl font-semibold text-destructive">Something went wrong</h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            An unexpected error occurred. Our team has been notified.
          </p>
          {error.digest && (
            <p className="mt-2 font-mono text-xs text-muted-foreground/60">
              Error ID: {error.digest}
            </p>
          )}
          <button
            onClick={reset}
            className="mt-8 inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            <RefreshCw size={16} />
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
