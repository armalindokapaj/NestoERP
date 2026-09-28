import { Skeleton } from "@/components/ui/skeleton";

import { ListSkeleton, SummarySkeleton } from "./_dashboard/sections";

export default function PlatformAdminLoading() {
  return (
    <div className="space-y-5" role="status" aria-busy="true" aria-label="Loading dashboard">
      <div className="space-y-2"><Skeleton className="h-8 w-40" /><Skeleton className="h-4 w-72" /></div>
      <SummarySkeleton />
      <div className="grid gap-5 xl:grid-cols-[3fr_2fr]"><ListSkeleton rows={3} label="attention" /><ListSkeleton rows={6} label="recent activity" /></div>
    </div>
  );
}
