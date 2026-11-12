"use client";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { Skeleton } from "@/components/ui/skeleton";

export function ListSkeleton({ rows = 5, label }: { rows?: number; label: string }) {
  const t = useTranslations("admin");
  return (
    <div className="border border-line-strong bg-surface" role="status" aria-busy="true" aria-label={t("loading.list", { label })}>
      <div className="flex h-11 items-center border-b border-line-strong px-4"><Skeleton className="h-3.5 w-40 rounded-none" /></div>
      <div className="divide-y divide-line">{Array.from({ length: rows }, (_, index) => <div key={index} className="flex gap-4 px-4 py-3"><Skeleton className="size-9 shrink-0 rounded-none" /><Skeleton className="h-9 w-1/2 rounded-none" /><Skeleton className="ml-auto h-4 w-16 rounded-none" /></div>)}</div>
    </div>
  );
}
