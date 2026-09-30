"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { useRouter } from "@/components/navigation/guarded-router";
import { useNavigationFeedback } from "@/components/navigation/navigation-feedback";
import { FolderKanban, LayoutGrid, List, SearchX } from "lucide-react";

import { announcementApi, failureMessage } from "@/components/announcements/announcement-api";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchField } from "@/components/ui/search-field";
import { useToast } from "@/components/ui/toast";
import { useTranslations } from "@/components/i18n/i18n-provider";
import { isAborted } from "@/lib/client/api-request";
import { useLatestRequest } from "@/lib/client/latest-request";
import type { PortfolioListDTO, ProjectCardDTO } from "@/lib/modules/projects/project.types";
import { cn } from "@/lib/utils/cn";
import { GALLERY_GRID } from "./gallery";
import { ProjectCard, ProjectCardSkeleton } from "./project-card";
import { ProjectCompactRow } from "./project-compact-row";

const VIEW_KEY = "nesto:projects-view";

/** Server-side search, so a short pause before asking (Projects Workspace Grid §180). */
const SEARCH_DEBOUNCE_MS = 250;

/**
 * The Projects page body (Projects Workspace Grid §5, §21-§23, §37, §70-§73,
 * §109-§114, §148-§150).
 *
 * A search and the grid — nothing else to choose: the workspace has already
 * chosen the companies, and the person's access the projects. The server
 * renders the first page for the URL; this keeps what the person does next —
 * more cards, a star — without reloading the gallery they are looking at. A new
 * search is a new URL and brings a new first page. A new workspace is a new
 * tree: the shell keys the page by workspace, so nothing here survives into the
 * next one (§83, §86).
 */
export function ProjectsPortfolio({
  initial,
  q,
  canCreate,
}: {
  initial: PortfolioListDTO;
  q: string;
  /** Whether this person may create a project here; only then does the empty workspace offer it (§73). */
  canCreate: boolean;
}) {
  const router = useRouter();
  const feedback = useNavigationFeedback();
  const pathname = usePathname();
  const toast = useToast();
  const t = useTranslations("projects");
  const [navigating, startNavigation] = React.useTransition();

  // Cards or a compact list (MOB-05 §15): a per-viewer convenience, so it lives in the browser and the page renders correctly without it.
  const [view, setView] = React.useState<"cards" | "list">("cards");
  React.useEffect(() => {
    try {
      if (window.localStorage.getItem(VIEW_KEY) === "list") setView("list");
    } catch {}
  }, []);
  const chooseView = (next: "cards" | "list") => {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {}
  };

  const [items, setItems] = React.useState(initial.items);
  const [cursor, setCursor] = React.useState(initial.pageInfo.nextCursor);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [pendingFavorites, setPendingFavorites] = React.useState<ReadonlySet<string>>(new Set());

  // A "Load more" belongs to the search it was asked under: a new search's first
  // page drops it, so a page of the old query is never appended (AUD-07 §6, PS-10).
  const moreRead = useLatestRequest();

  React.useEffect(() => {
    moreRead.cancel();
    setItems(initial.items);
    setCursor(initial.pageInfo.nextCursor);
    setLoadingMore(false);
    setLoadError(null);
  }, [initial, moreRead]);

  const search = React.useCallback(
    (next: string) => {
      const href = next ? `${pathname}?${new URLSearchParams({ q: next }).toString()}` : pathname;
      feedback?.begin(href, "record");
      // Replace: every keystroke is not a place to come Back to.
      startNavigation(() => router.replace(href, { scroll: false }));
    },
    [pathname, router, feedback],
  );

  const patch = (projectId: string, change: Partial<ProjectCardDTO>) =>
    setItems((current) => current.map((item) => (item.id === projectId ? { ...item, ...change } : item)));

  async function loadMore() {
    if (!cursor) return;
    const ticket = moreRead.begin();
    setLoadingMore(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams({ cursor });
      if (q) params.set("q", q);
      const page = await announcementApi<PortfolioListDTO>(`/api/projects?${params.toString()}`, { signal: ticket.signal });
      if (!ticket.current()) return;
      setItems((current) => {
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...page.items.filter((item) => !seen.has(item.id))];
      });
      setCursor(page.pageInfo.nextCursor);
    } catch (failure) {
      if (ticket.current() && !isAborted(failure)) setLoadError(t("portfolio.loadFailed"));
    } finally {
      if (ticket.current()) setLoadingMore(false);
    }
  }

  async function toggleFavorite(project: ProjectCardDTO) {
    if (pendingFavorites.has(project.id)) return;
    const next = !project.isFavorite;
    patch(project.id, { isFavorite: next });
    setPendingFavorites((current) => new Set(current).add(project.id));
    try {
      await announcementApi(`/api/projects/${project.id}/favorite`, { method: next ? "POST" : "DELETE" });
    } catch (error) {
      patch(project.id, { isFavorite: !next });
      toast({ title: failureMessage(error, t("portfolio.favoritesFailed")), tone: "danger" });
    } finally {
      setPendingFavorites((current) => {
        const remaining = new Set(current);
        remaining.delete(project.id);
        return remaining;
      });
    }
  }

  // Nothing to search in: the workspace itself has no project for this person.
  // It does not say whether projects exist that they cannot open (§71, §72).
  if (initial.meta.visibleProjectCount === 0) {
    return (
      <EmptyState
        icon={<FolderKanban />}
        title={t("portfolio.emptyTitle")}
        // Purpose, and "create" only to someone who may (AUD-05 §6, UX-11, UX-15).
        description={
          canCreate
            ? t("portfolio.emptyCreate")
            : t("portfolio.emptyJoin")
        }
        action={canCreate ? { label: t("portfolio.createProject"), href: "/projects/new" } : undefined}
      />
    );
  }

  const shown = items.length;
  const total = initial.meta.matchingCount;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        <ProjectsSearch value={q} onSearch={search} />
        <div role="group" aria-label={t("portfolio.viewLabel")} className="flex shrink-0 gap-1 sm:ml-auto">
          {(["cards", "list"] as const).map((mode) => {
            const Icon = mode === "cards" ? LayoutGrid : List;
            return (
              <button
                key={mode}
                type="button"
                aria-pressed={view === mode}
                aria-label={t(mode === "cards" ? "portfolio.viewCards" : "portfolio.viewList")}
                onClick={() => chooseView(mode)}
                className={cn("grid size-10 place-items-center rounded-md border border-line touch:size-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", view === mode ? "bg-hover text-fg" : "text-fg-muted")}
                data-testid={`projects-view-${mode}`}
              >
                <Icon aria-hidden="true" className="size-4" />
              </button>
            );
          })}
        </div>
        {/* The count of what the search found, only while there is one (§148). */}
        <p className="text-table text-fg-muted" aria-live="polite" data-testid="projects-result-count">
          {navigating ? <span className="sr-only">{t("portfolio.loading")}</span> : q && total > 0 ? t("portfolio.found", { projects: t("portfolio.count", { count: total }) }) : null}
        </p>
      </div>

      <div className={cn("transition-opacity", navigating && "pointer-events-none opacity-60")} aria-busy={navigating}>
        {shown === 0 ? (
          // A search that matches nothing offers the way back, never "create" (AUD-05 §6, UX-11).
          <EmptyState
            icon={<SearchX />}
            title={t("portfolio.noneFound")}
            description={t("portfolio.noneMatch")}
            action={{ label: t("portfolio.clearSearch"), href: pathname }}
            className="py-12"
          />
        ) : (
          <div className={view === "list" ? "divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface" : GALLERY_GRID} data-testid="project-gallery" data-view={view}>
            {items.map((project) => view === "list" ? (
              <ProjectCompactRow key={project.id} project={project} />
            ) : (
              <ProjectCard
                key={project.id}
                project={project}
                favoritePending={pendingFavorites.has(project.id)}
                onToggleFavorite={() => void toggleFavorite(project)}
              />
            ))}
            {loadingMore ? Array.from({ length: 4 }, (_, index) => <ProjectCardSkeleton key={`more-${index}`} />) : null}
          </div>
        )}
      </div>

      {shown > 0 && (cursor || loadError) ? (
        <div className="flex flex-col items-center gap-2 pt-2">
          {loadError ? (
            <p role="alert" className="text-table text-danger-strong">
              {loadError}
            </p>
          ) : (
            <p className="text-meta text-fg-subtle">
              {t("portfolio.showing", { shown, total })}
            </p>
          )}
          <Button type="button" variant="secondary" onClick={() => void loadMore()} disabled={loadingMore} data-testid="projects-load-more">
            {loadError ? t("portfolio.retry") : loadingMore ? t("portfolio.loadingMore") : t("portfolio.loadMore")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The page's own search (§21-§25, §145, §149, §150): the projects already on
 * this page, never the product — the top bar's Search is that. Debounced into
 * the URL, so a search survives a refresh and can be shared; clearable with
 * its button or Escape.
 */
function ProjectsSearch({ value, onSearch }: { value: string; onSearch: (q: string) => void }) {
  const [text, setText] = React.useState(value);
  const lastSent = React.useRef(value);
  const t = useTranslations("projects");

  // A search changed from outside (Back, a link) shows here. The page's answer
  // to this field's own search is not one: resetting the text to it would drop
  // a space typed while the answer was on its way.
  React.useEffect(() => {
    if (value === lastSent.current) return;
    lastSent.current = value;
    setText(value);
  }, [value]);

  React.useEffect(() => {
    const trimmed = text.trim();
    if (trimmed === lastSent.current) return;
    const timer = window.setTimeout(() => {
      lastSent.current = trimmed;
      onSearch(trimmed);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [text, onSearch]);

  return (
    <SearchField
      value={text}
      onChange={(event) => setText(event.target.value)}
      onClear={() => setText("")}
      placeholder={t("portfolio.searchPlaceholder")}
      aria-label={t("portfolio.searchLabel")}
      className="sm:max-w-sm"
      maxLength={200}
      data-testid="projects-search"
    />
  );
}

/** What the page shows while the first page is on its way: the same cards, the same shape (§101-§103). */
export function ProjectsPortfolioSkeleton() {
  const t = useTranslations("projects");
  return (
    <div className="space-y-5" role="status" aria-busy="true" aria-label={t("portfolio.loading")}>
      <div className="h-10 w-full animate-pulse rounded-md bg-surface-muted sm:max-w-sm motion-reduce:animate-none" />
      <div className={GALLERY_GRID}>
        {Array.from({ length: 8 }, (_, index) => (
          <ProjectCardSkeleton key={index} />
        ))}
      </div>
    </div>
  );
}
