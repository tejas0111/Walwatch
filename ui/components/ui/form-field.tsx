'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { Children, cloneElement, isValidElement, useId } from 'react'
import { cn } from '@/lib/utils'

export function FormField({
  label,
  error,
  helperText,
  children,
  className,
}: {
  label: React.ReactNode
  error?: string
  helperText?: string
  children: React.ReactNode
  className?: string
}) {
  const id = useId()
  const errorId = `${id}-error`
  const helperId = `${id}-helper`

  const child = Children.only(children)
  const input = isValidElement<{ id?: string; error?: string }>(child)
    ? cloneElement(child, { id, error: error ?? child.props.error })
    : children

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="relative">
        {input}
      </div>
      <AnimatePresence>
        {error && (
          <motion.span
            id={errorId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden text-xs text-destructive"
            role="alert"
          >
            {error}
          </motion.span>
        )}
      </AnimatePresence>
      {helperText && !error && (
        <p id={helperId} className="text-xs text-muted-foreground">{helperText}</p>
      )}
    </div>
  )
}

export function FormInput({
  error,
  mono,
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  error?: string
  mono?: boolean
}) {
  const errorId = props.id ? `${props.id}-error` : undefined

  return (
    <input
      aria-invalid={!!error}
      aria-describedby={error ? errorId : undefined}
      className={cn(
        'h-11 rounded-xl border bg-background px-3.5 text-sm outline-none transition-colors focus:ring-2 focus:ring-ring/40',
        mono && 'font-mono text-xs',
        error ? 'border-destructive' : 'border-input hover:border-ring/50',
        className,
      )}
      {...props}
    />
  )
}

export function FormSelect({
  error,
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { error?: string }) {
  const errorId = props.id ? `${props.id}-error` : undefined

  return (
    <select
      aria-invalid={!!error}
      aria-describedby={error ? errorId : undefined}
      className={cn(
        'h-9 rounded-lg border border-input bg-card px-3 text-xs outline-none focus:ring-2 focus:ring-ring/40',
        error && 'border-destructive',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  )
}
