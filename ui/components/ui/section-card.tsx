import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'

function SectionCard({
  title,
  description,
  children,
  action,
}: {
  title: string
  description?: string
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
        {action && <div className="col-start-2 row-span-2 row-start-1 self-start justify-self-end">{action}</div>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

export { SectionCard }
export default SectionCard
