import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading shapes for Platform Admin routes (Admin IA §30): close to what
 * arrives, inside the shell, never a full-page spinner.
 */
export function AdminDirectorySkeleton({ label = "Loading" }: { label?: string }) {
  return (
    <div className="space-y-5" role="status" aria-busy="true" aria-label={label}>
      <div className="space-y-2"><Skeleton className="h-8 w-56" /><Skeleton className="h-4 w-80 max-w-full" /></div>
      <Skeleton className="h-10 w-full max-w-md" />
      <div className="nesto-card divide-y divide-line">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="flex items-center gap-4 px-5 py-3.5"><Skeleton className="h-4 w-1/4" /><Skeleton className="h-4 w-1/6" /><Skeleton className="h-4 w-1/6" /><Skeleton className="ml-auto h-6 w-16" /></div>
        ))}
      </div>
    </div>
  );
}

export function AdminDetailSkeleton({ label = "Loading" }: { label?: string }) {
  return (
    <div className="space-y-5" role="status" aria-busy="true" aria-label={label}>
      <Skeleton className="h-4 w-48" />
      <div className="space-y-2"><Skeleton className="h-8 w-72 max-w-full" /><Skeleton className="h-4 w-96 max-w-full" /></div>
      <div className="flex gap-2">{Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-9 w-24" />)}</div>
      <div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-48 rounded-xl" /><Skeleton className="h-48 rounded-xl" /></div>
    </div>
  );
}
