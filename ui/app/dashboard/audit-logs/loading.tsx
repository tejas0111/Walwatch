import { SkeletonTable } from '@/components/ui/skeleton'

export default function AuditLogsLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <SkeletonTable rows={5} />
      </div>
    </div>
  )
}
