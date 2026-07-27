'use client'

export interface TextFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  error?: string
  placeholder?: string
  type?: string
  mono?: boolean
}

export function TextField({
  label,
  value,
  onChange,
  error,
  placeholder,
  type = 'text',
  mono,
}: TextFieldProps) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-sm font-medium">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-invalid={!!error}
        className={`h-11 rounded-xl border bg-background px-3.5 text-sm outline-none focus:ring-2 focus:ring-ring/40 ${mono ? 'font-mono' : ''} ${error ? 'border-destructive' : 'border-input'}`}
      />
      {error && <span className="text-xs text-destructive">{error}</span>}
    </label>
  )
}
