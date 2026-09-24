import { Skeleton } from "@/components/ui/skeleton";

/**
 * Data-free placeholders for page sections still on their way (NAV-03
 * STREAM-07). Each keeps its section's footprint, so nothing moves under the
 * pointer when the data arrives. A title is shown only where the reader is
 * already known to see that section; placeholders never carry a number.
 */

export function StatCardsSkeleton({ count }: { count: number }) {
  return (
    <div aria-hidden="true" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="section-skeleton">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="nesto-card space-y-3 p-4">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-7 w-14" />
        </div>
      ))}
    </div>
  );
}

export function ListSectionSkeleton({ title, rows = 5 }: { title?: string; rows?: number }) {
  return (
    <section className="nesto-card p-5" aria-busy="true" data-testid="section-skeleton">
      {title ? <h2 className="text-card font-semibold text-fg">{title}</h2> : <Skeleton className="h-4 w-32" />}
      <div aria-hidden="true" className="mt-4 space-y-3">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="flex items-center justify-between gap-3">
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        ))}
      </div>
    </section>
  );
}

export function BlockSkeleton({ className = "h-40" }: { className?: string }) {
  return (
    <div aria-hidden="true" className={`nesto-card p-5 ${className}`} data-testid="section-skeleton">
      <Skeleton className="h-4 w-32" />
      <div className="mt-4 space-y-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
        <Skeleton className="h-3 w-4/6" />
      </div>
    </div>
  );
}
