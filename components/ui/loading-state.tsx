import { Loader2 } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils/cn";
import { UiText } from "@/components/i18n/ui-text";

/**
 * Structured loading placeholders (spec §60) — skeletons that mirror the shape
 * of the content, never a bare spinner.
 *
 * Each announces itself once to assistive technology and hides its shapes
 * (AUD-05 §6, §8, UX-11, UX-17): a screen reader hears "Loading…", never a
 * run of empty cells, a fake total or an empty-list message. `label` names
 * what is loading; `announce={false}` silences a skeleton nested inside a
 * region that already announces.
 */
type Announce = { label?: string; announce?: boolean };

function LoadingStatus({ label, announce = true }: Announce) {
  return announce ? (
    <p role="status" className="sr-only">
      {label ?? <UiText k="loading" />}
    </p>
  ) : null;
}

export function SkeletonCards({
  count = 4,
  className,
  label,
  announce,
}: { count?: number; className?: string } & Announce) {
  return (
    <>
      <LoadingStatus label={label} announce={announce} />
      <div
        aria-hidden="true"
        data-testid="skeleton-cards"
        className={cn("grid gap-4 sm:grid-cols-2 xl:grid-cols-4", className)}
      >
        {Array.from({ length: count }).map((_, index) => (
          <div key={index} className="nesto-card p-5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-4 h-7 w-16" />
            <Skeleton className="mt-3 h-3 w-32" />
          </div>
        ))}
      </div>
    </>
  );
}

export function SkeletonTable({
  rows = 6,
  className,
  label,
  announce,
}: { rows?: number; className?: string } & Announce) {
  return (
    <>
      <LoadingStatus label={label} announce={announce} />
      <div
        aria-hidden="true"
        data-testid="skeleton-table"
        className={cn("nesto-card overflow-hidden", className)}
      >
        <div className="border-b border-line px-4 py-3">
          <Skeleton className="h-3 w-40" />
        </div>
        <div className="divide-y divide-line">
          {Array.from({ length: rows }).map((_, index) => (
            <div key={index} className="flex items-center gap-4 px-4 py-3.5">
              <Skeleton className="size-8 rounded-full" />
              <Skeleton className="h-3 flex-1 max-w-56" />
              <Skeleton className="hidden h-3 w-32 sm:block" />
              <Skeleton className="hidden h-3 w-20 md:block" />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

export function SkeletonNavigation({ items = 6 }: { items?: number }) {
  return (
    <div className="space-y-1.5 p-3">
      {Array.from({ length: items }).map((_, index) => (
        <Skeleton key={index} className="h-8 w-full" />
      ))}
    </div>
  );
}

export function SkeletonPage({ label }: { label?: string }) {
  return (
    <div className="space-y-6">
      <LoadingStatus label={label} />
      <div aria-hidden="true">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="mt-2 h-3 w-80" />
      </div>
      <SkeletonCards announce={false} />
      <SkeletonTable announce={false} />
    </div>
  );
}

/** One card-shaped placeholder; reserves the height so nothing shifts when content arrives (MOB-01 §31). */
export function SkeletonCard({ lines = 3, className, label, announce }: { lines?: number; className?: string } & Announce) {
  return (
    <>
      <LoadingStatus label={label} announce={announce} />
      <div aria-hidden="true" data-testid="skeleton-card" className={cn("nesto-card p-[var(--nesto-space-card)]", className)}>
        <Skeleton className="h-4 w-1/3 max-w-40" />
        <div className="mt-4 space-y-2.5">
          {Array.from({ length: lines }).map((_, index) => (
            <Skeleton key={index} className={cn("h-3", index === lines - 1 ? "w-2/3" : "w-full")} />
          ))}
        </div>
      </div>
    </>
  );
}

/** A stack of list rows: an avatar, two lines and a trailing value. */
export function SkeletonList({ rows = 5, className, label, announce }: { rows?: number; className?: string } & Announce) {
  return (
    <>
      <LoadingStatus label={label} announce={announce} />
      <div aria-hidden="true" data-testid="skeleton-list" className={cn("nesto-card divide-y divide-line", className)}>
        {Array.from({ length: rows }).map((_, index) => (
          <div key={index} className="flex items-center gap-3 px-4 py-3">
            <Skeleton className="size-10 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-3 w-3/5" />
              <Skeleton className="h-3 w-2/5" />
            </div>
            <Skeleton className="h-3 w-12 shrink-0" />
          </div>
        ))}
      </div>
    </>
  );
}

/** Label-over-input fields, one column, matching the phone form layout. */
export function SkeletonForm({ fields = 4, className, label, announce }: { fields?: number; className?: string } & Announce) {
  return (
    <>
      <LoadingStatus label={label} announce={announce} />
      <div aria-hidden="true" data-testid="skeleton-form" className={cn("space-y-5", className)}>
        {Array.from({ length: fields }).map((_, index) => (
          <div key={index} className="space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-10 w-full touch:h-11" />
          </div>
        ))}
      </div>
    </>
  );
}

/** A small spinner with a name, for a region that is reloading in place (MOB-01 §31). */
export function InlineLoader({ label, className }: { label?: string; className?: string }) {
  return (
    <span role="status" className={cn("inline-flex items-center gap-2 text-table text-fg-muted", className)}>
      <Loader2 aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
      <span>{label ?? <UiText k="loading" />}</span>
    </span>
  );
}
