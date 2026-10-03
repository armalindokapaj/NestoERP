"use client";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { Skeleton } from "@/components/ui/skeleton";

export function ListSkeleton({ rows = 5, label }: { rows?: number; label: string }) {
  const t = useTranslations("admin");
  return (
    <div className="nesto-card p-5" role="status" aria-busy="true" aria-label={t("loading.list", { label })}>
      <Skeleton className="h-5 w-40" />
      <div className="mt-4 divide-y divide-line">{Array.from({ length: rows }, (_, index) => <div key={index} className="flex gap-4 py-3.5"><Skeleton className="size-10 shrink-0 rounded-full" /><Skeleton className="h-10 w-1/2" /><Skeleton className="ml-auto h-5 w-16" /></div>)}</div>
    </div>
  );
}
