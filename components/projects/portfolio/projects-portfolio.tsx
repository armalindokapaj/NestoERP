"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { useNavigationFeedback } from "@/components/navigation/navigation-feedback";
import { FolderKanban, SearchX } from "lucide-react";

import { announcementApi, failureMessage } from "@/components/announcements/announcement-api";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchField } from "@/components/ui/search-field";
import { useToast } from "@/components/ui/toast";
import type { PortfolioListDTO, ProjectCardDTO } from "@/lib/modules/projects/project.types";
import { cn } from "@/lib/utils/cn";
import { GALLERY_GRID, projectCountLabel } from "./gallery";
import { ProjectCard, ProjectCardSkeleton } from "./project-card";

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
  const [navigating, startNavigation] = React.useTransition();

  const [items, setItems] = React.useState(initial.items);
  const [cursor, setCursor] = React.useState(initial.pageInfo.nextCursor);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [pendingFavorites, setPendingFavorites] = React.useState<ReadonlySet<string>>(new Set());

  React.useEffect(() => {
    setItems(initial.items);
    setCursor(initial.pageInfo.nextCursor);
    setLoadError(null);
  }, [initial]);

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
    setLoadingMore(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams({ cursor });
      if (q) params.set("q", q);
      const page = await announcementApi<PortfolioListDTO>(`/api/projects?${params.toString()}`);
      setItems((current) => {
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...page.items.filter((item) => !seen.has(item.id))];
      });
      setCursor(page.pageInfo.nextCursor);
    } catch {
      setLoadError("Projects could not be loaded.");
    } finally {
      setLoadingMore(false);
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
      toast({ title: failureMessage(error, "Favorites could not be updated."), tone: "danger" });
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
        title="No projects available in this workspace."
        action={canCreate ? { label: "Create project", href: "/projects/new" } : undefined}
      />
    );
  }

  const shown = items.length;
  const total = initial.meta.matchingCount;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        <ProjectsSearch value={q} onSearch={search} />
        {/* The count of what the search found, only while there is one (§148). */}
        <p className="text-table text-fg-muted" aria-live="polite" data-testid="projects-result-count">
          {navigating ? <span className="sr-only">Loading projects</span> : q && total > 0 ? `${projectCountLabel(total)} found` : null}
        </p>
      </div>

      <div className={cn("transition-opacity", navigating && "pointer-events-none opacity-60")} aria-busy={navigating}>
        {shown === 0 ? (
          <EmptyState icon={<SearchX />} title="No projects found." className="py-12" />
        ) : (
          <div className={GALLERY_GRID} data-testid="project-gallery">
            {items.map((project) => (
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
              Showing {shown} of {total}
            </p>
          )}
          <Button type="button" variant="secondary" onClick={() => void loadMore()} disabled={loadingMore} data-testid="projects-load-more">
            {loadError ? "Retry" : loadingMore ? "Loading…" : "Load more projects"}
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
      placeholder="Search projects…"
      aria-label="Search projects"
      className="sm:max-w-sm"
      maxLength={200}
      data-testid="projects-search"
    />
  );
}

/** What the page shows while the first page is on its way: the same cards, the same shape (§101-§103). */
export function ProjectsPortfolioSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading projects">
      <div className="h-10 w-full animate-pulse rounded-md bg-surface-muted sm:max-w-sm motion-reduce:animate-none" />
      <div className={GALLERY_GRID}>
        {Array.from({ length: 8 }, (_, index) => (
          <ProjectCardSkeleton key={index} />
        ))}
      </div>
    </div>
  );
}
