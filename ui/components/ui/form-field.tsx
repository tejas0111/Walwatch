'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { Children, cloneElement, isValidElement, useId } from 'react'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectTrigger, SelectValue } from '@/components/ui/select'
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
    <Input
      aria-invalid={!!error}
      aria-describedby={error ? errorId : undefined}
      className={cn(
        mono && 'font-mono text-xs',
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
  value,
  onValueChange,
  placeholder,
}: {
  error?: string
  className?: string
  children: React.ReactNode
  value?: string
  onValueChange?: (value: string | null) => void
  placeholder?: string
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className={cn(error && 'border-destructive', className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>{children}</SelectContent>
    </Select>
  )
}
