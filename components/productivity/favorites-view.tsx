"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Boxes, Building2, CalendarClock, FileSignal, FileText, Flag, FolderKanban, History, NotebookPen, Presentation, ReceiptText, Search, ShoppingCart, SquareCheckBig, Star, X, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { announcementApi, failureMessage } from "@/components/announcements/announcement-api";
import type { FavoriteItemDTO } from "@/lib/modules/productivity/favorites.service";
import { NAVIGABLE_LABELS, NAVIGABLE_TYPES, type NavigableType } from "@/lib/modules/productivity/navigable.types";
import type { RecentWorkItemDTO } from "@/lib/modules/productivity/recent-work.service";
import { cn } from "@/lib/utils/cn";

/**
 * Favorites and Recent Work (PRD #45 §87-§90, §110, §202, §203, §208-§210).
 *
 * Quiet rows: an icon for the kind of record, its title and context, and the
 * star or the time it was last opened. Everything listed has already been
 * resolved against what this person can open right now.
 */

export const ENTITY_ICON: Record<NavigableType, LucideIcon> = {
  project: FolderKanban,
  project_milestone: Flag,
  task: SquareCheckBig,
  meeting: Presentation,
  daily_log: NotebookPen,
  client: Building2,
  document: FileText,
  contract: FileSignal,
  purchase_order: ShoppingCart,
  invoice: ReceiptText,
};

export function relativeTime(iso: string, now = Date.now()): string {
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "Yesterday" : `${days} days ago`;
}

type Sort = "recent" | "alphabetical" | "type";

function Row({ icon: Icon, title, subtitle, href, trailing, testId }: { icon: LucideIcon; title: string; subtitle?: string; href: string; trailing: React.ReactNode; testId: string }) {
  return (
    <li className="flex items-center gap-3 px-4 py-2.5" data-testid={testId}>
      <Icon aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
      <Link href={href} className="min-w-0 flex-1">
        <span className="block truncate text-table font-medium text-fg hover:text-accent-strong">{title}</span>
        {subtitle ? <span className="block truncate text-meta text-fg-muted">{subtitle}</span> : null}
      </Link>
      {trailing}
    </li>
  );
}

export function FavoritesView({ initialFavorites, initialRecent, tab: initialTab, favoritesEnabled, recentEnabled }: { initialFavorites: FavoriteItemDTO[]; initialRecent: RecentWorkItemDTO[]; tab: "favorites" | "recent"; favoritesEnabled: boolean; recentEnabled: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = React.useState(initialTab);
  const [favorites, setFavorites] = React.useState(initialFavorites);
  const [recent, setRecent] = React.useState(initialRecent);
  const [search, setSearch] = React.useState("");
  const [sort, setSort] = React.useState<Sort>("recent");
  const [now, setNow] = React.useState<number | null>(null);

  React.useEffect(() => setNow(Date.now()), []);

  function choose(next: "favorites" | "recent") {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === "recent") url.searchParams.set("tab", "recent");
    else url.searchParams.delete("tab");
    window.history.replaceState(window.history.state, "", url.toString());
  }

  async function unfavorite(item: FavoriteItemDTO) {
    setFavorites((current) => current.filter((row) => !(row.entityType === item.entityType && row.entityId === item.entityId)));
    try {
      await announcementApi(`/api/favorites/${item.entityType}/${item.entityId}`, { method: "DELETE" });
    } catch (error) {
      toast({ title: failureMessage(error), tone: "danger" });
      router.refresh();
    }
  }

  async function forget(item: RecentWorkItemDTO | null) {
    try {
      if (item) {
        setRecent((current) => current.filter((row) => !(row.entityType === item.entityType && row.entityId === item.entityId)));
        await announcementApi(`/api/recent-work/${item.entityType}/${item.entityId}`, { method: "DELETE" });
      } else {
        setRecent([]);
        await announcementApi("/api/recent-work", { method: "DELETE" });
        toast({ title: "Recent work cleared", tone: "success" });
      }
    } catch (error) {
      toast({ title: failureMessage(error), tone: "danger" });
      router.refresh();
    }
  }

  const term = search.trim().toLowerCase();
  const matches = (item: { title: string; subtitle?: string }) => !term || item.title.toLowerCase().includes(term) || (item.subtitle ?? "").toLowerCase().includes(term);
  const shownFavorites = favorites.filter(matches);
  const groups =
    sort === "type"
      ? NAVIGABLE_TYPES.map((type) => ({ key: type, label: NAVIGABLE_LABELS[type].plural, rows: shownFavorites.filter((item) => item.entityType === type) })).filter((group) => group.rows.length)
      : [{ key: "all", label: "", rows: sort === "alphabetical" ? [...shownFavorites].sort((a, b) => a.title.localeCompare(b.title)) : shownFavorites }];

  return (
    <div className="space-y-4">
      <nav aria-label="Favorites and recent work" className="flex items-center gap-1 border-b border-line">
        {([
          ["favorites", "Favorites", Star, favorites.length],
          ["recent", "Recent Work", History, recent.length],
        ] as const).map(([key, label, Icon, count]) => (
          <button key={key} type="button" onClick={() => choose(key)} aria-current={tab === key ? "page" : undefined} className={cn("-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-table font-medium", tab === key ? "border-accent text-fg" : "border-transparent text-fg-muted hover:text-fg")}>
            <Icon aria-hidden="true" className="size-4" />
            {label}
            <span className="text-meta tabular-nums text-fg-subtle">{count}</span>
          </button>
        ))}
      </nav>

      {tab === "favorites" ? (
        !favoritesEnabled ? (
          <EmptyState icon={<Star />} title="Favorites are switched off." description="Your company has turned favorites off." />
        ) : !favorites.length ? (
          <EmptyState icon={<Star />} title="No favorites yet." description="Star a project, task, meeting or document from its page to keep it here." />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <label className="relative min-w-[12rem] flex-1 sm:max-w-xs">
                <span className="sr-only">Search favorites</span>
                <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
                <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search favorites" className="pl-8" />
              </label>
              <div role="group" aria-label="Sort favorites" className="flex rounded-md border border-line p-0.5">
                {(["recent", "alphabetical", "type"] as const).map((key) => (
                  <button key={key} type="button" aria-pressed={sort === key} onClick={() => setSort(key)} className={cn("rounded px-2.5 py-1 text-meta font-medium", sort === key ? "bg-accent-soft text-accent-strong" : "text-fg-muted hover:text-fg")}>
                    {key === "recent" ? "Recently favorited" : key === "alphabetical" ? "A–Z" : "Type"}
                  </button>
                ))}
              </div>
            </div>
            {groups.map((group) => (
              <section key={group.key} className="nesto-card overflow-hidden" aria-label={group.label || "Favorites"}>
                {group.label ? <h2 className="border-b border-line px-4 py-2 text-meta font-semibold uppercase tracking-[0.08em] text-fg-subtle">{group.label}</h2> : null}
                <ul className="divide-y divide-line" data-testid="favorites-list">
                  {group.rows.map((item) => (
                    <Row
                      key={`${item.entityType}:${item.entityId}`}
                      icon={ENTITY_ICON[item.entityType] ?? Boxes}
                      title={item.title}
                      subtitle={item.subtitle}
                      href={item.href}
                      testId="favorite-row"
                      trailing={
                        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${item.title} from favorites`} onClick={() => void unfavorite(item)}>
                          <Star className="fill-warning text-warning" />
                        </Button>
                      }
                    />
                  ))}
                  {!group.rows.length ? <li className="px-4 py-3 text-table text-fg-subtle">Nothing matches.</li> : null}
                </ul>
              </section>
            ))}
          </>
        )
      ) : !recentEnabled ? (
        <EmptyState icon={<History />} title="Recent work is switched off." description="Your company has turned recent work off." />
      ) : !recent.length ? (
        <EmptyState icon={<CalendarClock />} title="Nothing recent." description="Projects, tasks, meetings and documents you open appear here. Only you can see this list." />
      ) : (
        <section className="nesto-card overflow-hidden" aria-label="Recent work">
          <div className="flex items-center justify-between border-b border-line px-4 py-2">
            <p className="text-meta text-fg-muted">Only you can see this. It is not an activity record.</p>
            <Button type="button" variant="ghost" size="sm" onClick={() => void forget(null)}>
              Clear recent work
            </Button>
          </div>
          <ul className="divide-y divide-line" data-testid="recent-list">
            {recent.map((item) => (
              <Row
                key={`${item.entityType}:${item.entityId}`}
                icon={ENTITY_ICON[item.entityType] ?? Boxes}
                title={item.title}
                subtitle={item.subtitle}
                href={item.href}
                testId="recent-row"
                trailing={
                  <span className="flex shrink-0 items-center gap-1">
                    <span className="text-meta tabular-nums text-fg-subtle" title={new Date(item.lastAccessedAt).toISOString()}>
                      {now ? relativeTime(item.lastAccessedAt, now) : ""}
                    </span>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={`Forget ${item.title}`} onClick={() => void forget(item)}>
                      <X />
                    </Button>
                  </span>
                }
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
