import { RevealWatchdog } from "@/components/navigation/reveal-watchdog";
import { SkeletonCards, SkeletonTable } from "@/components/ui/loading-state";
import { Skeleton } from "@/components/ui/skeleton";
import { getTranslations } from "@/lib/i18n/server";
import { cn } from "@/lib/utils/cn";

/**
 * Route loading surfaces (NAV-01 §5.2, LOAD-01..03).
 *
 * One shared set of page shapes, imported by every `loading.tsx` under
 * `app/(nesto)`. They render inside `#nesto-main`, so they never draw a
 * second sidebar or top bar, and they are data-free: no request, no query,
 * no guessed name or total. A route's own guard still decides what it shows
 * once it resolves (§2.1).
 *
 * One polite status line names the wait; the shapes themselves are hidden
 * from assistive technology and sit in their own busy region, outside which
 * the announcement stays so it is not deferred (§5.3).
 */

export type PageSkeletonVariant =
  | "neutral"
  | "overview"
  | "list"
  | "gallery"
  | "schedule"
  | "settings"
  | "feed"
  | "detail"
  | "form"
  | "viewport";

async function LoadingRegion({ variant, children, className }: { variant: PageSkeletonVariant; children: React.ReactNode; className?: string }) {
  const t = await getTranslations("shell");
  return (
    <div data-testid="page-skeleton" data-variant={variant} className="max-w-full">
      <p role="status" className="sr-only">
        {t("loadingPage")}
      </p>
      {/* Content that has arrived is shown within a beat, not held behind this surface (vercel/next.js#86151). */}
      <RevealWatchdog />
      <div aria-hidden="true" aria-busy="true" className={cn("space-y-6", className)}>
        {children}
      </div>
    </div>
  );
}

function Heading({ eyebrow = false, action = false }: { eyebrow?: boolean; action?: boolean }) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div className="min-w-0 flex-1">
        {eyebrow ? <Skeleton className="mb-3 h-3 w-28" /> : null}
        <Skeleton className="h-7 w-48 max-w-full sm:w-64" />
        <Skeleton className="mt-2 h-3 w-72 max-w-full" />
      </div>
      {action ? <Skeleton className="hidden h-9 w-28 shrink-0 sm:block" /> : null}
    </div>
  );
}

function Toolbar({ filters = 2 }: { filters?: number }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Skeleton className="h-9 w-full max-w-72" />
      {Array.from({ length: filters }, (_, index) => (
        <Skeleton key={index} className="hidden h-9 w-28 sm:block" />
      ))}
    </div>
  );
}

function Tabs({ count = 4 }: { count?: number }) {
  return (
    <div className="flex gap-3 overflow-hidden border-b border-line pb-2.5">
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} className="h-4 w-20 shrink-0" />
      ))}
    </div>
  );
}

function Panel({ lines = 4, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("nesto-card space-y-3 p-5", className)}>
      <Skeleton className="h-4 w-32" />
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className={cn("h-3", index % 3 === 2 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}

/** Anything without a closer shape: a heading and one content region (LOAD-01). */
export function NeutralPageSkeleton() {
  return (
    <LoadingRegion variant="neutral">
      <Heading />
      <SkeletonTable rows={6} />
    </LoadingRegion>
  );
}

/** Finance, Sales, Procurement, Inventory, HR, HSE, QA/QC — summary cards over a primary list. */
export function OverviewPageSkeleton() {
  return (
    <LoadingRegion variant="overview">
      <Heading eyebrow action />
      <SkeletonCards count={4} />
      <SkeletonTable rows={6} />
    </LoadingRegion>
  );
}

/** Clients, Contracts, Documents, Tasks, … — heading, toolbar, rows. */
export function ListPageSkeleton() {
  return (
    <LoadingRegion variant="list">
      <Heading action />
      <Tabs />
      <Toolbar />
      <SkeletonTable rows={6} />
    </LoadingRegion>
  );
}

/** The Projects gallery — heading, filters, image cards. */
export function GalleryPageSkeleton() {
  return (
    <LoadingRegion variant="gallery">
      <Heading action />
      <Toolbar filters={3} />
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="nesto-card overflow-hidden">
            <Skeleton className="aspect-[16/10] w-full rounded-none" />
            <div className="space-y-2 p-4">
              <Skeleton className="h-4 w-40 max-w-full" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
        ))}
      </div>
    </LoadingRegion>
  );
}

/** Calendar, Timesheets, Daily logs — period controls over a bounded grid. */
export function SchedulePageSkeleton() {
  return (
    <LoadingRegion variant="schedule">
      <Heading action />
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="size-9" />
        <Skeleton className="h-9 w-40" />
        <Skeleton className="size-9" />
        <Skeleton className="ml-auto hidden h-9 w-48 sm:block" />
      </div>
      <div className="nesto-card grid grid-cols-7 gap-px overflow-hidden bg-line p-0">
        {Array.from({ length: 35 }, (_, index) => (
          <div key={index} className="h-14 bg-surface p-2 sm:h-20">
            <Skeleton className="h-3 w-5" />
          </div>
        ))}
      </div>
    </LoadingRegion>
  );
}

/** Engineering, Organization, Company, Settings, Support — tabs and content panels. */
export function SettingsPageSkeleton() {
  return (
    <LoadingRegion variant="settings">
      <Heading />
      <Tabs count={5} />
      <div className="grid gap-5 lg:grid-cols-3">
        <Panel lines={5} className="lg:col-span-2" />
        <Panel lines={3} />
      </div>
    </LoadingRegion>
  );
}

/** Approvals, Activity, My Work, Search — filters over a feed of rows. */
export function FeedPageSkeleton() {
  return (
    <LoadingRegion variant="feed">
      <Heading />
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-8 w-24 rounded-full" />
        ))}
      </div>
      <div className="nesto-card divide-y divide-line">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="flex items-start gap-3 p-4">
            <Skeleton className="size-9 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-3.5 w-3/5" />
              <Skeleton className="h-3 w-2/5" />
            </div>
            <Skeleton className="hidden h-3 w-16 sm:block" />
          </div>
        ))}
      </div>
    </LoadingRegion>
  );
}

/**
 * One record — the record bar, a title, the tab strip, and panels. It never
 * assumes which sections the person may see (LOAD-03).
 */
export function DetailPageSkeleton() {
  return (
    <LoadingRegion variant="detail">
      <div className="flex items-center gap-2">
        <Skeleton className="size-8" />
        <Skeleton className="size-8" />
        <Skeleton className="h-3 w-56 max-w-full" />
      </div>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Skeleton className="h-7 w-64 max-w-full" />
          <Skeleton className="mt-2 h-3 w-40" />
        </div>
        <Skeleton className="h-6 w-20 shrink-0 rounded-full" />
      </div>
      <Tabs />
      <div className="grid gap-5 lg:grid-cols-3">
        <Panel lines={6} className="lg:col-span-2" />
        <Panel lines={4} />
      </div>
    </LoadingRegion>
  );
}

/** A create or edit page — the record bar, a heading and a card of fields. */
export function FormPageSkeleton() {
  return (
    <LoadingRegion variant="form">
      <Skeleton className="h-3 w-56 max-w-full" />
      <Heading />
      <div className="nesto-card max-w-3xl space-y-5 p-5 sm:p-6">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
        <div className="flex justify-end gap-2 pt-2">
          <Skeleton className="h-9 w-20" />
          <Skeleton className="h-9 w-28" />
        </div>
      </div>
    </LoadingRegion>
  );
}

/**
 * The published 3D viewer's frame. A neutral viewport only: nothing here
 * imports the renderer or any authoring code (LOAD-03).
 */
export function ViewportPageSkeleton() {
  return (
    <LoadingRegion variant="viewport">
      <Skeleton className="h-3 w-56 max-w-full" />
      <Skeleton className="h-[min(70dvh,640px)] w-full rounded-2xl" />
    </LoadingRegion>
  );
}

/** A project's workspace — its hero, summary and cards (kept from PRD #12's own loader). */
export function ProjectWorkspaceSkeleton() {
  return (
    <LoadingRegion variant="detail" className="space-y-7">
      <Skeleton className="h-5 w-72 max-w-full" />
      <div className="grid min-h-[430px] overflow-hidden rounded-3xl border border-line lg:grid-cols-2">
        <Skeleton className="min-h-56 rounded-none" />
        <div className="grid grid-cols-2 gap-px bg-line">
          <div className="col-span-2 bg-surface" />
          <div className="bg-surface" />
          <div className="bg-surface" />
        </div>
      </div>
      <div className="nesto-card grid gap-6 p-6 lg:grid-cols-3">
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-28 rounded-xl lg:col-span-2" />
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-56 rounded-xl" />
        ))}
      </div>
    </LoadingRegion>
  );
}

/** The dashboard's own shape (PRD #4 §75). */
export function DashboardSkeleton() {
  return (
    <LoadingRegion variant="overview">
      <div>
        <Skeleton className="h-3 w-32" />
        <Skeleton className="mt-3 h-8 w-56 max-w-full" />
        <Skeleton className="mt-2 h-3 w-80 max-w-full" />
      </div>
      <SkeletonCards />
      <SkeletonTable rows={5} />
    </LoadingRegion>
  );
}
