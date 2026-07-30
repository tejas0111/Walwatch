import { Skeleton } from '@/components/ui/skeleton'

export default function SettingsLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-2 h-9 w-48" />
        <Skeleton className="mt-1 h-4 w-72" />
      </div>
      <Skeleton className="h-12 w-64 rounded-lg" />
      <Skeleton className="h-96 rounded-2xl" />
    </div>
  )
}
