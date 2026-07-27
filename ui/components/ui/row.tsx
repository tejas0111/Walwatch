export interface RowProps {
  label: string
  value: string
}

export function Row({ label, value }: RowProps) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  )
}
