import { Skeleton } from '@/components/ui/skeleton'

export default function RootLoading() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <Skeleton className="h-12 w-48" />
      <Skeleton className="h-6 w-72" />
      <Skeleton className="mt-8 h-[400px] w-full max-w-4xl rounded-2xl" />
    </div>
  )
}
