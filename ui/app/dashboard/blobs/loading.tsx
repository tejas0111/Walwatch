import { SkeletonTable } from '@/components/ui/skeleton'

export default function BlobsLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <SkeletonTable />
      </div>
    </div>
  )
}
