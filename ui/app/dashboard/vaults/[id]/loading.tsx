import { Skeleton } from '@/components/ui/skeleton'

export default function VaultDetailLoading() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-4 w-48" />
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-4 w-96" />
      <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
        <div className="flex flex-col gap-6">
          <Skeleton className="h-64 rounded-3xl" />
          <div className="grid gap-4 sm:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24 rounded-2xl" />
            ))}
          </div>
          <Skeleton className="h-48 rounded-3xl" />
        </div>
        <div className="flex flex-col gap-6">
          <Skeleton className="h-56 rounded-3xl" />
          <Skeleton className="h-48 rounded-3xl" />
        </div>
      </div>
    </div>
  )
}
