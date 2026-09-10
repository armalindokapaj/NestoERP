import { SkeletonCards, SkeletonTable } from "@/components/ui/loading-state";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Dashboard loading state (PRD #4 §75).
 *
 * Deliberately the only `loading.tsx` in the authenticated app. A loading file
 * opens a Suspense boundary, and once the shell has flushed, a `redirect()`
 * thrown by a module guard below it can no longer be an HTTP redirect — it
 * arrives as a client-side navigation inside a 200 response. Every other route
 * therefore renders its guard before anything is sent, so an unauthorised
 * request is refused by the response itself and no restricted markup is ever
 * produced (PRD #5 §128).
 *
 * The dashboard is safe: every authenticated role may open it, so there is no
 * guard beneath this boundary to defeat.
 */
export default function DashboardLoading() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-3 w-32" />
        <Skeleton className="mt-3 h-8 w-56" />
        <Skeleton className="mt-2 h-3 w-80" />
      </div>
      <SkeletonCards />
      <SkeletonTable rows={5} />
    </div>
  );
}
