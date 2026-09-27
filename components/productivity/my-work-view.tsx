"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "@/components/navigation/guarded-router";
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
import { useCommonTranslations } from "@/components/i18n/common-text";
import { planFocusAfterRemoval } from "@/components/modules/focus-after-removal";

export type MyWorkQuery = { companyId?: string; module?: string; projectId?: string; q?: string; range?: string; from?: string; to?: string };

const RANGES = [
  ["all", "myWork.anyTime"],
  ["today", "myWork.today"],
  ["7d", "myWork.days7"],
  ["30d", "myWork.days30"],
  ["custom", "myWork.custom"],
] as const;

// 44px under touch; the 16px phone font comes from globals.css (AUD-04 §3, D-01-15, MW-06).
const selectClass = "h-9 max-w-full rounded-md border border-line bg-surface px-2.5 text-table text-fg outline-none focus:border-accent touch:h-11";

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
  const t = useCommonTranslations();
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
      toast({ title: t("myWork.loadMoreFailed"), tone: "danger" });
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
      toast({ title: failureMessage(error, tab === "favorites" ? t("favorite.updateFailed") : t("myWork.recentUpdateFailed")), tone: "danger" });
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
      toast({ title: t("myWork.cleared"), tone: "success" });
    } catch (error) {
      toast({ title: failureMessage(error), tone: "danger" });
    } finally {
      setClearing(false);
      setConfirmClear(false);
    }
  }

  const enabled = tab === "favorites" ? favoritesEnabled : recentEnabled;
  const filtered = Boolean(query.companyId || query.module || query.projectId || query.q || (query.range && query.range !== "all"));
  const moreFilters = [query.companyId, query.module, query.projectId, query.range && query.range !== "all" ? query.range : null].filter(Boolean).length;

  return (
    <div className="space-y-4">
      <nav aria-label={t("myWork.nav")} className="flex items-center gap-1 border-b border-line">
        {([
          ["recent", "myWork.recent", History],
          ["favorites", "myWork.favorites", Star],
        ] as const).map(([key, label, Icon]) => (
          <Link key={key} href={href({ tab: key })} aria-current={tab === key ? "page" : undefined} className={cn("-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-table font-medium", tab === key ? "border-accent text-fg" : "border-transparent text-fg-muted hover:text-fg")} data-testid={`my-work-tab-${key}`}>
            <Icon aria-hidden="true" className="size-4" />
            {t(label)}
          </Link>
        ))}
      </nav>

      {/* A plain GET form: every filter is URL state, and submitting never touches the workspace (§165-§167). */}
      <form action="/my-work" method="get" className="flex flex-wrap items-end gap-2" aria-label={t("myWork.filter")} data-testid="my-work-filters">
        <input type="hidden" name="tab" value={tab} />
        <label className="flex min-w-[12rem] flex-1 flex-col gap-1 sm:max-w-xs">
          <span className="text-meta text-fg-muted">{t("myWork.search")}</span>
          <input name="q" defaultValue={query.q ?? ""} maxLength={200} placeholder={tab === "favorites" ? t("myWork.searchFavorites") : t("myWork.searchRecent")} className={cn(selectClass, "w-full")} />
        </label>
        {/*
          Below sm the narrowing filters fold behind "More filters (N)", open
          when one is set. CSS only: they stay in this GET form either way, and
          from sm up the wrapper is display: contents (AUD-04 §5, D-01-15, MW-06).
        */}
        <input id="my-work-more-filters" type="checkbox" className="peer sr-only" defaultChecked={moreFilters > 0} />
        <label
          htmlFor="my-work-more-filters"
          className="inline-flex h-11 cursor-pointer items-center justify-center rounded-md border border-line-strong bg-surface px-4 text-body font-medium text-fg peer-focus-visible:ring-2 peer-focus-visible:ring-ring sm:hidden"
        >
          {t("myWork.moreFilters")}{moreFilters > 0 ? ` (${moreFilters})` : ""}
        </label>
        <div className="max-sm:hidden max-sm:w-full max-sm:peer-checked:grid max-sm:peer-checked:gap-2 sm:contents [&_select]:max-sm:w-full [&_input]:max-sm:w-full">
        {initial.facets.companies.length > 1 ? (
          <label className="flex flex-col gap-1">
            <span className="text-meta text-fg-muted">{t("myWork.company")}</span>
            <select name="companyId" defaultValue={query.companyId ?? ""} className={selectClass} data-testid="my-work-company-filter">
              <option value="">{t("myWork.allCompanies")}</option>
              {initial.facets.companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="flex flex-col gap-1">
          <span className="text-meta text-fg-muted">{t("myWork.module")}</span>
          <select name="module" defaultValue={query.module ?? ""} className={selectClass}>
            <option value="">{t("myWork.allModules")}</option>
            {initial.facets.modules.map((key) => (
              <option key={key} value={key}>
                {moduleLabel(key)}
              </option>
            ))}
          </select>
        </label>
        {initial.facets.projects.length > 0 ? (
          <label className="flex flex-col gap-1">
            <span className="text-meta text-fg-muted">{t("myWork.project")}</span>
            <select name="projectId" defaultValue={query.projectId ?? ""} className={cn(selectClass, "sm:max-w-[14rem]")}>
              <option value="">{t("myWork.allProjects")}</option>
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
              <span className="text-meta text-fg-muted">{t("myWork.lastOpened")}</span>
              <select name="range" defaultValue={query.range ?? "all"} className={selectClass}>
                {RANGES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {t(label)}
                  </option>
                ))}
              </select>
            </label>
            {query.range === "custom" ? (
              <>
                <label className="flex flex-col gap-1">
                  <span className="text-meta text-fg-muted">{t("myWork.from")}</span>
                  <input type="date" name="from" defaultValue={query.from ?? ""} className={selectClass} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-meta text-fg-muted">{t("myWork.to")}</span>
                  <input type="date" name="to" defaultValue={query.to ?? ""} className={selectClass} />
                </label>
              </>
            ) : null}
          </>
        ) : null}
        </div>
        <Button type="submit" variant="secondary" size="sm">
          {t("myWork.apply")}
        </Button>
        {filtered ? (
          <Link href={href({ companyId: undefined, module: undefined, projectId: undefined, q: undefined, range: undefined, from: undefined, to: undefined })} className="inline-flex items-center pb-2 text-meta font-medium text-accent-strong hover:underline touch:min-h-11 touch:pb-0">
            {t("myWork.reset")}
          </Link>
        ) : null}
      </form>

      {!enabled ? (
        <EmptyState icon={tab === "favorites" ? <Star /> : <History />} title={tab === "favorites" ? t("myWork.favoritesOff") : t("myWork.recentOff")} description={t("myWork.turnedOff")} />
      ) : items.length === 0 ? (
        filtered ? (
          <EmptyState icon={<Boxes />} title={t("myWork.noMatch")} description={t("myWork.noMatchBody")} />
        ) : tab === "favorites" ? (
          <EmptyState icon={<Star />} title={t("myWork.noFavorites")} description={t("myWork.noFavoritesBody")} />
        ) : (
          <EmptyState icon={<CalendarClock />} title={t("myWork.noRecent")} description={t("myWork.noRecentBody")} />
        )
      ) : (
        <section className="nesto-card overflow-hidden" aria-label={tab === "favorites" ? t("myWork.favorites") : t("myWork.recentWork")}>
          {tab === "recent" ? (
            <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2">
              <p className="text-meta text-fg-muted">{t("myWork.privateNote")}</p>
              <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmClear(true)} data-testid="clear-recent-work">
                {t("myWork.clearRecent")}
              </Button>
            </div>
          ) : null}
          <div className="hidden grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_7rem_2.25rem] gap-3 border-b border-line px-4 py-2 text-micro font-semibold uppercase tracking-[0.08em] text-fg-subtle md:grid" aria-hidden="true">
            <span>{t("myWork.record")}</span>
            <span>{t("myWork.company")}</span>
            <span>{t("myWork.module")}</span>
            <span>{t("myWork.project")}</span>
            <span>{tab === "favorites" ? t("myWork.favoritedOn") : t("myWork.lastOpened")}</span>
            <span />
          </div>
          <ul className="divide-y divide-line" data-testid={tab === "favorites" ? "favorites-list" : "recent-list"}>
            {items.map((item) => {
              const Icon = ENTITY_ICON[item.entityType as NavigableType] ?? Boxes;
              return (
                <li key={`${item.entityType}:${item.entityId}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 md:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_7rem_auto]" data-testid={tab === "favorites" ? "favorite-row" : "recent-row"}>
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
                      {/* Phones keep the subtitle and the when, not only company · module · project (AUD-04 §5, D-01-14, MW-05). */}
                      {item.subtitle ? <span className="block truncate text-meta text-fg-muted">{item.subtitle}</span> : null}
                      <span className="block truncate text-meta text-fg-muted md:hidden">
                        {[item.company?.name, moduleLabel(item.moduleKey), item.project?.name, now ? (tab === "favorites" ? new Date(item.at).toLocaleDateString() : relativeTime(item.at, now, t)) : null].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                  </a>
                  <span className="hidden min-w-0 md:block">{item.company ? <CompanyTag name={item.company.name} /> : null}</span>
                  <span className="hidden truncate text-table text-fg-muted md:block">{moduleLabel(item.moduleKey)}</span>
                  <span className="hidden truncate text-table text-fg-muted md:block">{item.project?.name ?? "—"}</span>
                  <span className="hidden text-meta tabular-nums text-fg-subtle md:block" title={item.at}>
                    {now ? (tab === "favorites" ? new Date(item.at).toLocaleDateString() : relativeTime(item.at, now, t)) : ""}
                  </span>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={tab === "favorites" ? t("myWork.removeFavorite", { title: item.title }) : t("myWork.removeRecent", { title: item.title })} onClick={(event) => {
                    // The row leaves at once; focus the next one, not <body> (AUD-11 §4, AV-04).
                    planFocusAfterRemoval(event.currentTarget)();
                    void remove(item);
                  }}>
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
                {t("myWork.loadMore")}
              </Button>
            </div>
          ) : null}
        </section>
      )}

      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title={t("myWork.clearTitle")}
        description={t("myWork.clearBody")}
        confirmLabel={t("myWork.clearRecent")}
        destructive
        pending={clearing}
        onConfirm={() => void clearRecent()}
      />
    </div>
  );
}
