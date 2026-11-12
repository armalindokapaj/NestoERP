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
  type IconComponent,
  Layers3,
  Megaphone,
  NotebookPen,
  Package,
  Plus,
  Presentation,
  ReceiptText,
  ShoppingCart,
  SquareCheckBig,
  Star,
  Target,
  Truck,
  UserRound,
} from "@/components/icons";

import Link from "@/components/navigation/nav-link";
import { useTranslations } from "@/components/i18n/i18n-provider";
import { useCommonTranslations } from "@/components/i18n/common-text";
import { CREATE_ICONS } from "@/components/layout/create-icons";
import { getIcon } from "@/components/layout/nav-icon";
import { StatusBadge } from "@/components/modules/status-badge";
import { DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { CompanyTag } from "@/components/workspace/company-tag";
import { useOpenRecord } from "@/components/workspace/use-open-record";
import type { ModuleKey } from "@/config/modules";
import { groupOfType, markMatch, matchScore, SEARCH_SCOPES, type SearchScope } from "@/lib/core/search/palette";
import type { GlobalSearchResultDTO } from "@/lib/core/search/search.types";
import { isNavigableType, type NavigableType } from "@/lib/modules/productivity/navigable.types";
import { publishMyWorkChange } from "@/lib/productivity/client";
import { cn } from "@/lib/utils/cn";
import { MIN_QUERY, type SearchAction, type SearchHome, type SearchPage, type SearchShortcut, type SearchState } from "@/components/layout/global-search";

/**
 * Global search's results and Search Home, loaded when the palette first
 * opens (design spec §16, §63; PRD #38 §87-§90; NAV-03 PANEL-01, PANEL-04;
 * docs/ui/UI-08-search.md).
 *
 * Records show only what the server returned: the providers behind
 * `/api/search` already apply company, module, permission and record scope.
 * Pages and actions are matched here, as the person types, against their own
 * navigation and the create actions offered to them.
 *
 * Every row is one line of the drawing set: a lined square with its icon, the
 * name with the typed text marked, what it belongs to under it, and at the
 * right its company, status and star. The row the arrows are on carries a gold
 * rule at its left, and ↵ from 640px.
 */

/** Search names a few record types differently from the navigable registry. */
const SEARCH_TO_NAVIGABLE: Record<string, NavigableType | undefined> = { ncr: "non_conformance_report", hse_incident: "incident" };

const ENTITY_ICONS: Record<string, IconComponent> = {
  calendar_event: CalendarDays,
  meeting: Presentation,
  project: FolderKanban,
  project_unit: Layers3,
  task: SquareCheckBig,
  client: Building2,
  document: FileText,
  member: UserRound,
  person: UserRound,
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

/** At most this many pages and actions among the records; the Pages filter lists all that match. */
const PAGES_AMONG_RECORDS = 4;
const ACTIONS_AMONG_RECORDS = 3;

type Option = {
  key: string;
  kind: "favorite" | "recent" | "result" | "page" | "action";
  entityType: string;
  title: string;
  subtitle?: string;
  href: string;
  status?: string;
  company?: SearchShortcut["company"];
  icon: IconComponent;
};

type Group = { key: string; label: string; rows: Option[] };

export type SearchBodyProps = {
  query: string;
  scope: SearchScope;
  state: SearchState;
  shortcuts: SearchHome | null;
  homeFailed: boolean;
  pages: SearchPage[];
  actions: SearchAction[];
  listId: string;
  active: number;
  setActive: (index: number | ((index: number) => number)) => void;
  /** The input's arrow and Enter keys, handled against this body's options. */
  keyHandler: React.MutableRefObject<((event: React.KeyboardEvent<HTMLInputElement>) => void) | null>;
  onOptions: (count: number) => void;
  onClose: () => void;
  /** Runs a create action (Quick Create's). */
  onAction: (key: string) => void;
};

export function SearchPanelBody({ query, scope, state, shortcuts, homeFailed, pages, actions, listId, active, setActive, keyHandler, onOptions, onClose, onAction }: SearchBodyProps) {
  const t = useTranslations("search");
  const tModules = useTranslations("modules");
  const tc = useCommonTranslations();
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

  const text = query.trim();
  const home = text.length === 0;
  const results = React.useMemo(() => (state.status === "done" ? state.response.results : []), [state]);

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
      toast({ title: tc("favorite.updateFailed"), tone: "danger" });
    }
  }

  /*
   * What is listed, in order:
   * - nothing typed: Favorites, then Recent Work (§8, §157); under Pages, every page and action;
   * - something typed: the records by kind, each kind in the server's ranking, with the pages and
   *   actions that match — first when one starts with what was typed ("Sales…" for "sal"), else after.
   */
  const groups = React.useMemo((): Group[] => {
    const shortcut = (items: SearchShortcut[], kind: "favorite" | "recent") =>
      items.map(
        (item): Option => ({
          key: `${kind}:${item.entityType}:${item.entityId}`,
          kind,
          entityType: item.entityType,
          title: item.title,
          subtitle: [item.moduleKey ? moduleLabel(item.moduleKey) : null, item.project?.name].filter(Boolean).join(" · ") || item.subtitle,
          href: item.href,
          company: item.company,
          icon: kind === "favorite" ? Star : History,
        }),
      );
    const pageRow = (page: SearchPage): Option => ({ key: `page:${page.key}`, kind: "page", entityType: "page", title: page.label, subtitle: page.place, href: page.href, icon: getIcon(page.icon) });
    const actionRow = (action: SearchAction): Option => ({ key: `action:${action.key}`, kind: "action", entityType: "action", title: action.label, href: "", icon: CREATE_ICONS[action.icon] ?? Plus });

    if (scope === "all" && home) {
      return [
        { key: "favorites", label: t("favorites"), rows: shortcut(shortcuts?.favorites ?? [], "favorite") },
        { key: "recent", label: t("recentWork"), rows: shortcut(shortcuts?.recent ?? [], "recent") },
      ];
    }

    // Pages and actions: all of them under Pages with nothing typed; else those that match, best first.
    const pagesShown = scope === "all" || scope === "pages";
    const ranked = <T,>(items: T[], score: (item: T) => number) =>
      items
        .map((item) => ({ item, score: score(item) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((entry) => entry.item);
    const matchedPages = !pagesShown ? [] : home ? pages : ranked(pages, (page) => matchScore(text, page.label, [page.place]));
    const matchedActions = !pagesShown ? [] : home ? actions : ranked(actions, (action) => matchScore(text, action.label, action.keywords));
    const pageGroups: Group[] = [
      { key: "pages", label: t("goTo"), rows: (scope === "pages" ? matchedPages : matchedPages.slice(0, PAGES_AMONG_RECORDS)).map(pageRow) },
      { key: "actions", label: t("create"), rows: (scope === "pages" ? matchedActions : matchedActions.slice(0, ACTIONS_AMONG_RECORDS)).map(actionRow) },
    ];
    if (scope === "pages") return pageGroups;

    // Records by kind: a unit is a Unit, not a Project; a kind without a filter keeps its module's name.
    // Under a filter only its kinds, as the server was asked (an answer for another filter never shows).
    const kinds: readonly string[] | null = SEARCH_SCOPES.find((entry) => entry.key === scope)?.types ?? null;
    const byKind = new Map<string, Group>();
    for (const result of results as GlobalSearchResultDTO[]) {
      if (kinds && !kinds.includes(result.entityType)) continue;
      const kind = groupOfType(result.entityType) ?? result.moduleKey;
      const group = byKind.get(kind) ?? { key: kind, label: groupOfType(result.entityType) ? t(`scopes.${kind as SearchScope}`) : moduleLabel(result.moduleKey), rows: [] };
      group.rows.push({
        key: `result:${result.entityType}:${result.entityId}`,
        kind: "result",
        entityType: result.entityType,
        title: result.title,
        subtitle: [result.subtitle, result.meta].filter(Boolean).join(" · ") || undefined,
        href: result.href,
        status: result.status ?? undefined,
        company: result.company,
        icon: ENTITY_ICONS[result.entityType] ?? Boxes,
      });
      byKind.set(kind, group);
    }
    const records = [...byKind.values()];
    const leads = [...pages, ...actions].some((item) => matchScore(text, item.label) >= 3);
    return leads ? [...pageGroups, ...records] : [...records, ...pageGroups];
  }, [scope, home, text, shortcuts, pages, actions, results, moduleLabel, t]);

  const shown = groups.filter((group) => group.rows.length);
  const ordered = shown.flatMap((group) => group.rows);
  React.useEffect(() => onOptions(ordered.length), [ordered.length, onOptions]);
  // A changed list starts again at its first row.
  const listKey = ordered.map((option) => option.key).join("|");
  React.useEffect(() => setActive(0), [listKey, setActive]);

  /**
   * Opens a row (§39, §125-§127). An action is Quick Create's to run. A record
   * or a page in the company already open: go. Anywhere else: the server checks
   * the person may enter that company, commits the workspace, and re-validates
   * the record there.
   */
  async function openOption(option: Option | undefined) {
    if (!option || entering) return;
    if (option.kind === "action") return onAction(option.key.slice("action:".length));
    if (await openRecord({ href: option.href, company: option.company })) onClose();
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
      void openOption(ordered[active]);
    }
  };
  React.useEffect(() => () => void (keyHandler.current = null), [keyHandler]);

  React.useEffect(() => {
    document.getElementById(`${listId}-option-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, listId]);

  let index = -1;
  const scopeName = t(`scopes.${scope}`);
  const waiting = text.length < MIN_QUERY && scope !== "pages";

  return (
    <>
      {ordered.length > 0 ? (
        <div id={listId} role="listbox" aria-label={t("resultsLabel")}>
          {shown.map((group) => (
            <div key={group.key} role="group" aria-label={group.label} data-testid={`palette-${group.key}`}>
              <p className="flex items-center justify-between px-4 pb-1.5 pt-3 font-mono text-micro font-medium uppercase tracking-[0.1em] text-fg-subtle">
                <span>{group.label}</span>
                <span className="tabular-nums">{group.rows.length}</span>
              </p>
              <div className="max-sm:border-y max-sm:border-line">
                {group.rows.map((option) => {
                  index += 1;
                  const position = index;
                  const selected = position === active;
                  const navigable = option.kind === "result" ? (SEARCH_TO_NAVIGABLE[option.entityType] ?? (isNavigableType(option.entityType) ? option.entityType : null)) : null;
                  const recordId = option.key.slice(`result:${option.entityType}:`.length);
                  const starred = navigable ? favoriteKeys.has(`${navigable}:${recordId}`) : false;
                  const Icon = option.icon;
                  const marked = home ? [option.title] : markMatch(option.title, text);
                  return (
                    <div
                      key={option.key}
                      id={`${listId}-option-${position}`}
                      role="option"
                      aria-selected={selected}
                      onMouseMove={() => setActive(position)}
                      onClick={() => void openOption(option)}
                      className={cn(
                        "group flex min-h-13 cursor-pointer items-center gap-3 px-4 py-2 max-sm:min-h-14 max-sm:border-b max-sm:border-line max-sm:last:border-b-0",
                        selected ? "bg-hover shadow-[inset_2px_0_0_var(--nesto-accent)]" : "hover:bg-hover",
                      )}
                      data-kind={option.kind}
                    >
                      <span className={cn("grid size-8 shrink-0 place-items-center border bg-surface", selected ? "border-line-strong text-fg" : "border-line text-fg-muted")}>
                        <Icon aria-hidden="true" className={cn("size-4", option.kind === "favorite" && "fill-warning text-warning")} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body font-medium text-fg">
                          {marked.length === 3 ? (
                            <>
                              {marked[0]}
                              <mark className="bg-transparent text-fg underline decoration-accent decoration-2 underline-offset-[3px]">{marked[1]}</mark>
                              {marked[2]}
                            </>
                          ) : (
                            marked[0]
                          )}
                        </span>
                        {option.subtitle ? <span className="block truncate text-meta text-fg-subtle">{option.subtitle}</span> : null}
                      </span>
                      {option.company ? <CompanyTag name={option.company.name} className="shrink-0 max-sm:hidden" /> : null}
                      {option.status ? <StatusBadge status={option.status} className="shrink-0" /> : null}
                      {navigable ? (
                        <button
                          type="button"
                          tabIndex={-1}
                          onClick={(event) => {
                            event.stopPropagation();
                            void toggleStar(navigable, recordId);
                          }}
                          aria-label={starred ? tc("favorite.remove") : tc("favorite.add")}
                          aria-pressed={starred}
                          // A phone keeps its room for the name: only a starred row shows its star there.
                          className={cn("grid size-7 shrink-0 place-items-center hover:bg-surface touch:size-11", starred ? "" : "opacity-0 group-hover:opacity-100 focus:opacity-100 touch:opacity-100 max-sm:hidden")}
                          data-testid="search-result-star"
                        >
                          <Star aria-hidden="true" className={cn("size-3.5", starred ? "fill-warning text-warning" : "text-fg-subtle")} />
                        </button>
                      ) : null}
                      <kbd aria-hidden="true" className={cn("grid h-5 min-w-5 shrink-0 place-items-center border border-line px-1 font-mono text-[0.625rem] text-fg-muted max-sm:hidden", selected ? "visible" : "invisible")}>↵</kbd>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : scope === "all" && home ? (
        <DialogDescription className="mt-0 px-4 py-4 text-table text-fg-subtle">{shortcuts ? t("bothEmpty") : t("hint")}</DialogDescription>
      ) : waiting ? (
        <DialogDescription className="mt-0 px-4 py-4 text-table text-fg-subtle">{scope === "all" ? t("hint") : t("scopeHint", { scope: scopeName.toLowerCase() })}</DialogDescription>
      ) : state.status === "loading" ? (
        <p className="px-4 py-4 text-table text-fg-subtle">{t("searching")}</p>
      ) : state.status === "error" ? (
        <p role="alert" className="px-4 py-4 text-table text-danger-strong">
          {t("error")}
        </p>
      ) : (
        <p className="px-4 py-4 text-table text-fg-muted">{scope === "all" ? t("noResults", { query: text }) : t("noResultsIn", { query: text, scope: scopeName.toLowerCase() })}</p>
      )}
      {scope === "all" && home && homeFailed && shortcuts ? (
        <p className="px-4 pb-1 text-meta text-fg-subtle" data-testid="search-home-stale">
          {t("homeStale")}
        </p>
      ) : null}
      {scope === "all" && home && shortcuts && ordered.length > 0 ? (
        <div className="px-4 pb-1 pt-2 text-meta text-fg-subtle" data-testid="search-home-empty-hints">
          {(shortcuts.favorites ?? []).length === 0 ? (
            <p role="group" aria-label={t("favorites")} className="py-1">
              <span className="font-medium text-fg-muted">{t("favorites")}</span> — {t("noFavorites")} {t("noFavoritesHint")}
            </p>
          ) : null}
          {(shortcuts.recent ?? []).length === 0 ? (
            <p role="group" aria-label={t("recentWork")} className="py-1">
              <span className="font-medium text-fg-muted">{t("recentWork")}</span> — {t("noRecent")}
            </p>
          ) : null}
        </div>
      ) : null}
      {scope === "all" && home ? (
        <div className="mt-1 flex flex-wrap justify-end gap-x-4 gap-y-1 px-4 pb-1 pt-2">
          <Link href="/my-work?tab=favorites" onClick={onClose} className="text-meta font-medium text-accent-strong hover:underline">
            {t("viewAllFavorites")}
          </Link>
          <Link href="/my-work?tab=recent" onClick={onClose} className="text-meta font-medium text-accent-strong hover:underline" data-testid="search-view-all-recent">
            {t("viewAllRecent")} →
          </Link>
        </div>
      ) : null}
      {state.status === "loading" && ordered.length > 0 ? <p className="px-4 pt-1 text-meta text-fg-subtle">{t("searching")}</p> : null}
      {state.status === "done" && state.response.partial ? <p className="px-4 pt-2 text-meta text-fg-subtle">{t("partial")}</p> : null}
    </>
  );
}
