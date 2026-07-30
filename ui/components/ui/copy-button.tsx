'use client'

import { Copy } from 'lucide-react'
import { useToast } from '@/lib/toast-context'

export function CopyButton({ text }: { text: string }) {
  const { addToast } = useToast()
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text)
        addToast({ type: 'success', title: 'Copied to clipboard' })
      }}
      className="rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
      aria-label="Copy"
    >
      <Copy size={14} />
    </button>
  )
}


