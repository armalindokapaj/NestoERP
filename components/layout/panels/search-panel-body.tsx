"use client";

import * as React from "react";
import {
  Boxes,
  Building2,
  CalendarDays,
  ClipboardCheck,
  FileSignal,
  FileText,
  Flag,
  FolderKanban,
  HardHat,
  History,
  type LucideIcon,
  Megaphone,
  NotebookPen,
  Package,
  Presentation,
  ReceiptText,
  ShoppingCart,
  SquareCheckBig,
  Star,
  Target,
  Truck,
  UserRound,
} from "lucide-react";

import Link from "@/components/navigation/nav-link";
import { useTranslations } from "@/components/i18n/i18n-provider";
import { DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { CompanyTag } from "@/components/workspace/company-tag";
import { useOpenRecord } from "@/components/workspace/use-open-record";
import type { ModuleKey } from "@/config/modules";
import type { GlobalSearchResultDTO } from "@/lib/core/search/search.types";
import { isNavigableType, type NavigableType } from "@/lib/modules/productivity/navigable.types";
import { publishMyWorkChange } from "@/lib/productivity/client";
import { cn } from "@/lib/utils/cn";
import type { SearchHome, SearchShortcut, SearchState } from "@/components/layout/global-search";

/**
 * Global search's results and Search Home, loaded when the palette first
 * opens (design spec §16, §63; PRD #38 §87-§90; NAV-03 PANEL-01, PANEL-04).
 *
 * It only shows what the server returned: the providers behind `/api/search`
 * already apply company, module, permission and record scope. The palette's
 * frame, input and reads live in the shell, so typing is never lost while
 * this arrives.
 */

/** Search names a few record types differently from the navigable registry. */
const SEARCH_TO_NAVIGABLE: Record<string, NavigableType | undefined> = { ncr: "non_conformance_report", hse_incident: "incident" };

const ENTITY_ICONS: Record<string, LucideIcon> = {
  calendar_event: CalendarDays,
  meeting: Presentation,
  project: FolderKanban,
  task: SquareCheckBig,
  client: Building2,
  document: FileText,
  member: UserRound,
  invoice: ReceiptText,
  opportunity: Target,
  contract: FileSignal,
  purchase_order: ShoppingCart,
  purchase_request: ShoppingCart,
  supplier: Truck,
  inventory_item: Package,
  quality_inspection: ClipboardCheck,
  ncr: ClipboardCheck,
  hse_incident: HardHat,
  hse_permit: HardHat,
  project_milestone: Flag,
  daily_log: NotebookPen,
  announcement: Megaphone,
};

type Option = { key: string; kind: "favorite" | "recent" | "result"; entityType: string; title: string; subtitle?: string; href: string; status?: string; moduleKey?: string; company?: SearchShortcut["company"] };

export type SearchBodyProps = {
  query: string;
  state: SearchState;
  shortcuts: SearchHome | null;
  homeFailed: boolean;
  listId: string;
  active: number;
  setActive: (index: number | ((index: number) => number)) => void;
  /** The input's arrow and Enter keys, handled against this body's options. */
  keyHandler: React.MutableRefObject<((event: React.KeyboardEvent<HTMLInputElement>) => void) | null>;
  onOptions: (count: number) => void;
  onClose: () => void;
};

export function SearchPanelBody({ query, state, shortcuts, homeFailed, listId, active, setActive, keyHandler, onOptions, onClose }: SearchBodyProps) {
  const t = useTranslations("search");
  const tModules = useTranslations("modules");
  const toast = useToast();
  const [toggled, setToggled] = React.useState<Record<string, boolean>>({});
  const { open: openRecord, pending: entering } = useOpenRecord(shortcuts?.workspace);

  const moduleLabel = React.useCallback(
    (key: string) => {
      const label = tModules(`${key as ModuleKey}.label`);
      return label.endsWith(".label") ? key : label;
    },
    [tModules],
  );

  React.useEffect(() => setToggled({}), [shortcuts]);

  const results = React.useMemo(() => (state.status === "done" ? state.response.results : []), [state]);

  // Grouped by module, keeping the server's ranking inside each group and the
  // order in which groups first appear.
  const groups = React.useMemo(() => {
    const byModule = new Map<string, GlobalSearchResultDTO[]>();
    for (const result of results) {
      const rows = byModule.get(result.moduleKey) ?? [];
      rows.push(result);
      byModule.set(result.moduleKey, rows);
    }
    return [...byModule.entries()];
  }, [results]);

  // Stars toggled here win over the last server answer until it refreshes (Fast Re-entry §75, §132).
  const favoriteKeys = React.useMemo(() => {
    const keys = new Set(shortcuts?.favoriteKeys ?? (shortcuts?.favorites ?? []).map((item) => `${item.entityType}:${item.entityId}`));
    for (const [key, on] of Object.entries(toggled)) if (on) keys.add(key);
    else keys.delete(key);
    return keys;
  }, [shortcuts, toggled]);

  async function toggleStar(entityType: string, entityId: string) {
    const key = `${entityType}:${entityId}`;
    const next = !favoriteKeys.has(key);
    setToggled((current) => ({ ...current, [key]: next }));
    try {
      const response = next
        ? await fetch("/api/my-work/favorites", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ entityType, entityId }) })
        : await fetch(`/api/my-work/favorites/${entityType}/${entityId}`, { method: "DELETE" });
      if (!response.ok) throw new Error(String(response.status));
      publishMyWorkChange({ kind: "favorite", entityType, entityId, favorite: next });
    } catch {
      setToggled((current) => ({ ...current, [key]: !next }));
      toast({ title: "Could not update Favorite.", tone: "danger" });
    }
  }

  // Empty query: Favorites, then Recent Work (§8, §157). A query: search results only (§46, §201).
  const home = query.trim().length === 0;
  const sections = React.useMemo(() => {
    const shortcut = (items: SearchShortcut[], kind: "favorite" | "recent") =>
      items.map((item): Option => ({ key: `${kind}:${item.entityType}:${item.entityId}`, kind, entityType: item.entityType, title: item.title, subtitle: [item.moduleKey ? moduleLabel(item.moduleKey) : null, item.project?.name].filter(Boolean).join(" · ") || item.subtitle, href: item.href, company: item.company }));
    const favorites = home ? shortcut(shortcuts?.favorites ?? [], "favorite") : [];
    const recent = home ? shortcut(shortcuts?.recent ?? [], "recent") : [];
    const searched = home
      ? []
      : groups.map(([moduleKey, rows]) => ({
          moduleKey,
          rows: rows.map((result): Option => ({ key: `result:${result.entityType}:${result.entityId}`, kind: "result", entityType: result.entityType, title: result.title, subtitle: [result.subtitle, result.meta].filter(Boolean).join(" · ") || undefined, href: result.href, status: result.status ?? undefined, moduleKey, company: result.company })),
        }));
    return { favorites, recent, searched: searched.filter((group) => group.rows.length) };
  }, [home, shortcuts, groups, moduleLabel]);

  const ordered = React.useMemo(() => [...sections.favorites, ...sections.recent, ...sections.searched.flatMap((group) => group.rows)], [sections]);
  React.useEffect(() => onOptions(ordered.length), [ordered.length, onOptions]);

  /**
   * Opens a record (§39, §125-§127). Already in the record's company: go.
   * Anywhere else: the server checks the person may enter that company, commits
   * the workspace, and re-validates the record there.
   */
  async function openResult(result: Option | undefined) {
    if (!result || entering) return;
    if (await openRecord({ href: result.href, company: result.company })) onClose();
  }

  keyHandler.current = (event) => {
    if (ordered.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => (index + 1) % ordered.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => (index - 1 + ordered.length) % ordered.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      void openResult(ordered[active]);
    }
  };
  React.useEffect(() => () => void (keyHandler.current = null), [keyHandler]);

  React.useEffect(() => {
    document.getElementById(`${listId}-option-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, listId]);

  let index = -1;

  return (
    <>
      {ordered.length > 0 ? (
        <div id={listId} role="listbox" aria-label={t("resultsLabel")}>
          {[
            { key: "favorites", label: t("favorites"), rows: sections.favorites },
            { key: "recent", label: t("recentWork"), rows: sections.recent },
            ...sections.searched.map((group) => ({ key: group.moduleKey, label: moduleLabel(group.moduleKey), rows: group.rows })),
          ]
            .filter((group) => group.rows.length)
            .map((group) => (
              <div key={group.key} role="group" aria-label={group.label} className="mb-1" data-testid={`palette-${group.key}`}>
                <p className="px-2 pb-1 pt-2 text-micro font-semibold uppercase tracking-[0.1em] text-fg-subtle">{group.label}</p>
                {group.rows.map((option) => {
                  index += 1;
                  const position = index;
                  const Icon = option.kind === "favorite" ? Star : option.kind === "recent" ? History : (ENTITY_ICONS[option.entityType] ?? Boxes);
                  const selected = position === active;
                  const navigable = option.kind === "result" ? (SEARCH_TO_NAVIGABLE[option.entityType] ?? (isNavigableType(option.entityType) ? option.entityType : null)) : null;
                  const recordId = option.key.slice(`result:${option.entityType}:`.length);
                  const starred = navigable ? favoriteKeys.has(`${navigable}:${recordId}`) : false;
                  return (
                    <div
                      key={option.key}
                      id={`${listId}-option-${position}`}
                      role="option"
                      aria-selected={selected}
                      onMouseMove={() => setActive(position)}
                      onClick={() => void openResult(option)}
                      className={cn("group flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 touch:min-h-11", selected ? "bg-hover" : "hover:bg-hover")}
                    >
                      <Icon aria-hidden="true" className={cn("size-4 shrink-0", option.kind === "favorite" ? "fill-warning text-warning" : "text-fg-subtle")} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-table text-fg">{option.title}</span>
                        {option.subtitle ? <span className="block truncate text-meta text-fg-subtle">{option.subtitle}</span> : null}
                      </span>
                      {option.company ? <CompanyTag name={option.company.name} className="shrink-0" /> : null}
                      {navigable ? (
                        <button
                          type="button"
                          tabIndex={-1}
                          onClick={(event) => {
                            event.stopPropagation();
                            void toggleStar(navigable, recordId);
                          }}
                          aria-label={starred ? "Remove from favorites" : "Add to favorites"}
                          aria-pressed={starred}
                          className={cn("grid size-6 shrink-0 place-items-center rounded hover:bg-surface touch:size-11", starred ? "" : "opacity-0 group-hover:opacity-100 focus:opacity-100 touch:opacity-100")}
                          data-testid="search-result-star"
                        >
                          <Star aria-hidden="true" className={cn("size-3.5", starred ? "fill-warning text-warning" : "text-fg-subtle")} />
                        </button>
                      ) : null}
                      {option.status ? <span className="shrink-0 text-micro text-fg-subtle">{option.status.replaceAll("_", " ").toLowerCase()}</span> : null}
                    </div>
                  );
                })}
              </div>
            ))}
        </div>
      ) : home ? (
        <DialogDescription className="mt-0 px-2 py-3 text-table text-fg-subtle">{shortcuts ? t("bothEmpty") : t("hint")}</DialogDescription>
      ) : state.status === "idle" ? (
        <DialogDescription className="mt-0 px-2 py-3 text-table text-fg-subtle">{t("hint")}</DialogDescription>
      ) : state.status === "loading" ? (
        <p className="px-2 py-3 text-table text-fg-subtle">{t("searching")}</p>
      ) : state.status === "error" ? (
        <p role="alert" className="px-2 py-3 text-table text-danger-strong">
          {t("error")}
        </p>
      ) : (
        <p className="px-2 py-3 text-table text-fg-muted">{t("noResults", { query: query.trim() })}</p>
      )}
      {home && homeFailed && shortcuts ? (
        <p className="px-2 pb-1 text-meta text-fg-subtle" data-testid="search-home-stale">
          {t("homeStale")}
        </p>
      ) : null}
      {home && shortcuts && ordered.length > 0 ? (
        <div className="px-2 pb-1 text-meta text-fg-subtle" data-testid="search-home-empty-hints">
          {sections.favorites.length === 0 ? (
            <p role="group" aria-label={t("favorites")} className="py-1">
              <span className="font-medium text-fg-muted">{t("favorites")}</span> — {t("noFavorites")} {t("noFavoritesHint")}
            </p>
          ) : null}
          {sections.recent.length === 0 ? (
            <p role="group" aria-label={t("recentWork")} className="py-1">
              <span className="font-medium text-fg-muted">{t("recentWork")}</span> — {t("noRecent")}
            </p>
          ) : null}
        </div>
      ) : null}
      {home ? (
        <div className="flex flex-wrap justify-end gap-x-4 gap-y-1 border-t border-line px-2 pb-1 pt-2">
          <Link href="/my-work?tab=favorites" onClick={onClose} className="text-meta font-medium text-accent-strong hover:underline">
            {t("viewAllFavorites")}
          </Link>
          <Link href="/my-work?tab=recent" onClick={onClose} className="text-meta font-medium text-accent-strong hover:underline" data-testid="search-view-all-recent">
            {t("viewAllRecent")} →
          </Link>
        </div>
      ) : null}
      {state.status === "loading" && ordered.length > 0 ? <p className="px-2 pt-1 text-meta text-fg-subtle">{t("searching")}</p> : null}
      {state.status === "done" && state.response.partial ? <p className="px-2 pt-2 text-meta text-fg-subtle">{t("partial")}</p> : null}
    </>
  );
}
