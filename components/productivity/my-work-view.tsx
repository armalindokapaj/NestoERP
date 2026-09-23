"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Boxes, CalendarClock, History, Loader2, Star, X } from "lucide-react";

import { announcementApi, failureMessage } from "@/components/announcements/announcement-api";
import { useTranslations } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { CompanyTag } from "@/components/workspace/company-tag";
import { useOpenRecord } from "@/components/workspace/use-open-record";
import type { ModuleKey } from "@/config/modules";
import type { MyWorkItemDTO, MyWorkPageDTO, MyWorkTab } from "@/lib/modules/productivity/my-work.service";
import type { NavigableType } from "@/lib/modules/productivity/navigable.types";
import { publishMyWorkChange, subscribeMyWork } from "@/lib/productivity/client";
import { cn } from "@/lib/utils/cn";
import { ENTITY_ICON, relativeTime } from "./record-icons";

export type MyWorkQuery = { companyId?: string; module?: string; projectId?: string; q?: string; range?: string; from?: string; to?: string };

const RANGES = [
  ["all", "Any time"],
  ["today", "Today"],
  ["7d", "7 days"],
  ["30d", "30 days"],
  ["custom", "Custom"],
] as const;

const selectClass = "h-9 rounded-md border border-line bg-surface px-2.5 text-table text-fg outline-none focus:border-accent";

/**
 * My Work (Fast Re-entry §10-§12, §59-§67, §77-§79, §135-§142, §160-§169).
 *
 * The longer history behind the search panel: Recent and Favorites, each with
 * company, module, project and date filters and a search, paged by cursor.
 * Filters live in the URL and narrow the person's own list only — choosing a
 * company here never changes the workspace (§165, §166). Every row names its
 * company, and opening one enters that company first when it is not the one the
 * session is in.
 */
export function MyWorkView({ tab, query, initial, favoritesEnabled, recentEnabled }: { tab: MyWorkTab; query: MyWorkQuery; initial: MyWorkPageDTO; favoritesEnabled: boolean; recentEnabled: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const tModules = useTranslations("modules");
  const [items, setItems] = React.useState<MyWorkItemDTO[]>(initial.items);
  const [cursor, setCursor] = React.useState(initial.nextCursor);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [confirmClear, setConfirmClear] = React.useState(false);
  const [clearing, setClearing] = React.useState(false);
  const [now, setNow] = React.useState<number | null>(null);
  const { open, pending } = useOpenRecord(initial.workspace);

  React.useEffect(() => setNow(Date.now()), []);
  React.useEffect(() => {
    setItems(initial.items);
    setCursor(initial.nextCursor);
  }, [initial]);
  // A change in another tab reloads this list from the server (§88, §89).
  React.useEffect(() => subscribeMyWork(() => router.refresh()), [router]);

  const moduleLabel = (key: string) => {
    const label = tModules(`${key as ModuleKey}.label`);
    return label.endsWith(".label") ? key : label;
  };

  const href = (next: Partial<MyWorkQuery> & { tab?: MyWorkTab }) => {
    const params = new URLSearchParams();
    const merged = { ...query, ...next, tab: next.tab ?? tab };
    for (const [key, value] of Object.entries(merged)) if (value && !(key === "range" && value === "all")) params.set(key, value);
    return `/my-work?${params}`;
  };

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams(href({}).split("?")[1]);
      params.set("cursor", cursor);
      const response = await fetch(`/api/my-work?${params}`);
      if (!response.ok) throw new Error(String(response.status));
      const page = ((await response.json()) as { data: MyWorkPageDTO }).data;
      setItems((current) => [...current, ...page.items]);
      setCursor(page.nextCursor);
    } catch {
      toast({ title: "More records could not be loaded.", tone: "danger" });
    } finally {
      setLoadingMore(false);
    }
  }

  async function remove(item: MyWorkItemDTO) {
    setItems((current) => current.filter((row) => !(row.entityType === item.entityType && row.entityId === item.entityId)));
    try {
      await announcementApi(`/api/my-work/${tab === "favorites" ? "favorites" : "recent"}/${item.entityType}/${item.entityId}`, { method: "DELETE" });
      publishMyWorkChange(tab === "favorites" ? { kind: "favorite", entityType: item.entityType, entityId: item.entityId, favorite: false } : { kind: "recent" });
    } catch (error) {
      toast({ title: failureMessage(error, tab === "favorites" ? "Could not update Favorite." : "Could not update Recent Work."), tone: "danger" });
      router.refresh();
    }
  }

  async function clearRecent() {
    setClearing(true);
    try {
      await announcementApi("/api/my-work/recent", { method: "DELETE" });
      setItems([]);
      setCursor(null);
      publishMyWorkChange({ kind: "recent" });
      toast({ title: "Recent work cleared", tone: "success" });
    } catch (error) {
      toast({ title: failureMessage(error), tone: "danger" });
    } finally {
      setClearing(false);
      setConfirmClear(false);
    }
  }

  const enabled = tab === "favorites" ? favoritesEnabled : recentEnabled;
  const filtered = Boolean(query.companyId || query.module || query.projectId || query.q || (query.range && query.range !== "all"));

  return (
    <div className="space-y-4">
      <nav aria-label="My Work" className="flex items-center gap-1 border-b border-line">
        {([
          ["recent", "Recent", History],
          ["favorites", "Favorites", Star],
        ] as const).map(([key, label, Icon]) => (
          <Link key={key} href={href({ tab: key })} aria-current={tab === key ? "page" : undefined} className={cn("-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-table font-medium", tab === key ? "border-accent text-fg" : "border-transparent text-fg-muted hover:text-fg")} data-testid={`my-work-tab-${key}`}>
            <Icon aria-hidden="true" className="size-4" />
            {label}
          </Link>
        ))}
      </nav>

      {/* A plain GET form: every filter is URL state, and submitting never touches the workspace (§165-§167). */}
      <form action="/my-work" method="get" className="flex flex-wrap items-end gap-2" aria-label="Filter my work" data-testid="my-work-filters">
        <input type="hidden" name="tab" value={tab} />
        <label className="flex min-w-[12rem] flex-1 flex-col gap-1 sm:max-w-xs">
          <span className="text-meta text-fg-muted">Search</span>
          <input name="q" defaultValue={query.q ?? ""} maxLength={200} placeholder={tab === "favorites" ? "Search favorites" : "Search recent work"} className={cn(selectClass, "w-full")} />
        </label>
        {initial.facets.companies.length > 1 ? (
          <label className="flex flex-col gap-1">
            <span className="text-meta text-fg-muted">Company</span>
            <select name="companyId" defaultValue={query.companyId ?? ""} className={selectClass} data-testid="my-work-company-filter">
              <option value="">All companies</option>
              {initial.facets.companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="flex flex-col gap-1">
          <span className="text-meta text-fg-muted">Module</span>
          <select name="module" defaultValue={query.module ?? ""} className={selectClass}>
            <option value="">All modules</option>
            {initial.facets.modules.map((key) => (
              <option key={key} value={key}>
                {moduleLabel(key)}
              </option>
            ))}
          </select>
        </label>
        {initial.facets.projects.length > 0 ? (
          <label className="flex flex-col gap-1">
            <span className="text-meta text-fg-muted">Project</span>
            <select name="projectId" defaultValue={query.projectId ?? ""} className={cn(selectClass, "max-w-[14rem]")}>
              <option value="">All projects</option>
              {initial.facets.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {tab === "recent" ? (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-meta text-fg-muted">Last opened</span>
              <select name="range" defaultValue={query.range ?? "all"} className={selectClass}>
                {RANGES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {query.range === "custom" ? (
              <>
                <label className="flex flex-col gap-1">
                  <span className="text-meta text-fg-muted">From</span>
                  <input type="date" name="from" defaultValue={query.from ?? ""} className={selectClass} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-meta text-fg-muted">To</span>
                  <input type="date" name="to" defaultValue={query.to ?? ""} className={selectClass} />
                </label>
              </>
            ) : null}
          </>
        ) : null}
        <Button type="submit" variant="secondary" size="sm">
          Apply
        </Button>
        {filtered ? (
          <Link href={href({ companyId: undefined, module: undefined, projectId: undefined, q: undefined, range: undefined, from: undefined, to: undefined })} className="pb-2 text-meta font-medium text-accent-strong hover:underline">
            Reset
          </Link>
        ) : null}
      </form>

      {!enabled ? (
        <EmptyState icon={tab === "favorites" ? <Star /> : <History />} title={tab === "favorites" ? "Favorites are switched off." : "Recent work is switched off."} description="Your companies have turned this off." />
      ) : items.length === 0 ? (
        filtered ? (
          <EmptyState icon={<Boxes />} title="Nothing matches these filters." description="Try another company, module or date." />
        ) : tab === "favorites" ? (
          <EmptyState icon={<Star />} title="No favorites yet." description="Star a record from its header to keep it close. Only you can see your favorites." />
        ) : (
          <EmptyState icon={<CalendarClock />} title="Your recently opened records will appear here." description="Projects, tasks, invoices, documents and other records you open are listed here. Only you can see this list." />
        )
      ) : (
        <section className="nesto-card overflow-hidden" aria-label={tab === "favorites" ? "Favorites" : "Recent work"}>
          {tab === "recent" ? (
            <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2">
              <p className="text-meta text-fg-muted">Only you can see this. It is not an activity record.</p>
              <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmClear(true)} data-testid="clear-recent-work">
                Clear recent work
              </Button>
            </div>
          ) : null}
          <div className="hidden grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_7rem_2.25rem] gap-3 border-b border-line px-4 py-2 text-micro font-semibold uppercase tracking-[0.08em] text-fg-subtle md:grid" aria-hidden="true">
            <span>Record</span>
            <span>Company</span>
            <span>Module</span>
            <span>Project</span>
            <span>{tab === "favorites" ? "Favorited on" : "Last opened"}</span>
            <span />
          </div>
          <ul className="divide-y divide-line" data-testid={tab === "favorites" ? "favorites-list" : "recent-list"}>
            {items.map((item) => {
              const Icon = ENTITY_ICON[item.entityType as NavigableType] ?? Boxes;
              return (
                <li key={`${item.entityType}:${item.entityId}`} className="grid grid-cols-[minmax(0,1fr)_2.25rem] items-center gap-3 px-4 py-2.5 md:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_7rem_2.25rem]" data-testid={tab === "favorites" ? "favorite-row" : "recent-row"}>
                  <a
                    href={item.href}
                    onClick={(event) => {
                      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                      event.preventDefault();
                      void open({ href: item.href, company: item.company });
                    }}
                    aria-busy={pending || undefined}
                    className="flex min-w-0 items-center gap-3"
                  >
                    <Icon aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
                    <span className="min-w-0">
                      <span className="block truncate text-table font-medium text-fg hover:text-accent-strong">{item.title}</span>
                      <span className="block truncate text-meta text-fg-muted md:hidden">{[item.company?.name, moduleLabel(item.moduleKey), item.project?.name].filter(Boolean).join(" · ")}</span>
                      {item.subtitle ? <span className="hidden truncate text-meta text-fg-muted md:block">{item.subtitle}</span> : null}
                    </span>
                  </a>
                  <span className="hidden min-w-0 md:block">{item.company ? <CompanyTag name={item.company.name} /> : null}</span>
                  <span className="hidden truncate text-table text-fg-muted md:block">{moduleLabel(item.moduleKey)}</span>
                  <span className="hidden truncate text-table text-fg-muted md:block">{item.project?.name ?? "—"}</span>
                  <span className="hidden text-meta tabular-nums text-fg-subtle md:block" title={item.at}>
                    {now ? (tab === "favorites" ? new Date(item.at).toLocaleDateString() : relativeTime(item.at, now)) : ""}
                  </span>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={tab === "favorites" ? `Remove ${item.title} from favorites` : `Remove ${item.title} from recent work`} onClick={() => void remove(item)}>
                    {tab === "favorites" ? <Star className="fill-warning text-warning" /> : <X />}
                  </Button>
                </li>
              );
            })}
          </ul>
          {cursor ? (
            <div className="border-t border-line p-2 text-center">
              <Button type="button" variant="ghost" size="sm" onClick={() => void loadMore()} disabled={loadingMore}>
                {loadingMore ? <Loader2 className="animate-spin" /> : null}
                Load more
              </Button>
            </div>
          ) : null}
        </section>
      )}

      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Clear recent work?"
        description="This removes every record from your Recent Work. Your favorites stay as they are."
        confirmLabel="Clear recent work"
        destructive
        pending={clearing}
        onConfirm={() => void clearRecent()}
      />
    </div>
  );
}
