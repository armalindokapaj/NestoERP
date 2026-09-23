"use client";

import * as React from "react";
import Link from "next/link";
import {
  Boxes,
  Building2,
  CalendarDays,
  ClipboardCheck,
  FileSignal,
  FileText,
  FolderKanban,
  HardHat,
  Loader2,
  type LucideIcon,
  Package,
  Presentation,
  ReceiptText,
  Flag,
  History,
  NotebookPen,
  Megaphone,
  Search,
  ShoppingCart,
  SquareCheckBig,
  Star,
  Target,
  Truck,
  UserRound,
} from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { CompanyTag } from "@/components/workspace/company-tag";
import { useOpenRecord } from "@/components/workspace/use-open-record";
import type { ModuleKey } from "@/config/modules";
import type { GlobalSearchCompany, GlobalSearchResponseDTO, GlobalSearchResultDTO } from "@/lib/core/search/search.types";
import { isNavigableType, type NavigableType } from "@/lib/modules/productivity/navigable.types";
import { publishMyWorkChange, readSearchHomeCache, subscribeMyWork, writeSearchHomeCache } from "@/lib/productivity/client";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils/cn";

/**
 * Global search (design spec §16, §63; PRD #38 §87-§90).
 *
 * A front end for the one search backend, `/api/search`, and nothing more: the
 * providers behind it already apply company, module, permission and record
 * scope, so this component never decides what a person may find — it only
 * shows what the server returned. Results the server did not return leave no
 * trace here, not even a count.
 *
 * In the Group workspace the same palette searches every company the person
 * may use (Workspace Context §40, §99). A row whose record lives in a company
 * says which, and opening it enters that company's workspace first — a
 * record's page is a company page (§31) — the way a link from a group list
 * does. A row without a company (a person, who belongs to the group) opens as
 * it is.
 */

const MIN_QUERY = 2;

/** Search names a few record types differently from the navigable registry. */
const SEARCH_TO_NAVIGABLE: Record<string, NavigableType | undefined> = { ncr: "non_conformance_report", hse_incident: "incident" };
const DEBOUNCE_MS = 200;

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

/** A favorite or recent record, already resolved against access by the server (PRD #45 §119, §319). `company` is set in the Group workspace. */
type Shortcut = { entityType: string; entityId: string; title: string; subtitle?: string; href: string; moduleKey?: string; project?: { id: string; name: string }; company?: GlobalSearchCompany };
/** `/api/search/home` (Fast Re-entry §91, §195). */
type SearchHome = { favorites: Shortcut[]; recent: Shortcut[]; favoriteKeys?: string[]; workspace: { scopeType: "GROUP" | "COMPANY"; companyId: string | null } };
type Option = { key: string; kind: "favorite" | "recent" | "result"; entityType: string; title: string; subtitle?: string; href: string; status?: string; moduleKey?: string; company?: GlobalSearchCompany };


type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "done"; response: GlobalSearchResponseDTO };

export function GlobalSearch({ userKey }: { userKey: string }) {
  const [open, setOpen] = React.useState(false);
  const [shortcut, setShortcut] = React.useState("Ctrl K");
  const [query, setQuery] = React.useState("");
  const [state, setState] = React.useState<State>({ status: "idle" });
  const [active, setActive] = React.useState(0);
  const [shortcuts, setShortcuts] = React.useState<SearchHome | null>(null);
  const [toggled, setToggled] = React.useState<Record<string, boolean>>({});
  const t = useTranslations("search");
  const toast = useToast();
  const tModules = useTranslations("modules");
  const { open: openRecord, pending: entering } = useOpenRecord(shortcuts?.workspace);
  const listId = React.useId();
  function moduleLabel(key: string) {
    const label = tModules(`${key as ModuleKey}.label`);
    return label.endsWith(".label") ? key : label;
  }

  React.useEffect(() => {
    if (navigator.platform.toLowerCase().includes("mac")) setShortcut("⌘ K");

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Each keystroke waits for the typing to pause, and a newer query cancels the
  // one still in flight, so results never arrive out of order.
  React.useEffect(() => {
    const text = query.trim();
    if (!open || text.length < MIN_QUERY) {
      setState({ status: "idle" });
      return;
    }
    const controller = new AbortController();
    setState({ status: "loading" });
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(text)}&limit=20`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(String(response.status));
        const json = (await response.json()) as GlobalSearchResponseDTO & { data?: GlobalSearchResponseDTO };
        setState({ status: "done", response: json.data ?? json });
        setActive(0);
      } catch (error) {
        if ((error as Error).name !== "AbortError") setState({ status: "error" });
      }
    }, DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query, open]);

  // Search Home (Fast Re-entry §6, §128): the last answer paints at once from
  // this tab's cache, and a fresh one — resolved against access now, so a record
  // somebody lost access to is simply absent (§35, §106) — replaces it behind.
  const loadHome = React.useCallback(async () => {
    try {
      const response = await fetch("/api/search/home");
      if (!response.ok) return;
      const data = ((await response.json()) as { data: SearchHome }).data;
      setShortcuts(data);
      setToggled({});
      writeSearchHomeCache(userKey, data);
    } catch {
      // The cached answer, if any, stays.
    }
  }, [userKey]);

  React.useEffect(() => {
    if (!open) return;
    const cached = readSearchHomeCache<SearchHome>(userKey);
    if (cached) setShortcuts(cached);
    void loadHome();
    // A star or an open in another tab refreshes this panel (§88, §89).
    return subscribeMyWork(() => void loadHome());
  }, [open, userKey, loadHome]);

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

  // Empty query: Favorites, then Recent Work (§8, §157). A query: search results only — favorites
  // and recent work neither lead nor reorder them in V0.1 (§46, §201); a starred result carries its star.
  const home = query.trim().length === 0;
  const sections = React.useMemo(() => {
    const shortcut = (items: Shortcut[], kind: "favorite" | "recent") =>
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
  }, [home, shortcuts, groups]); // eslint-disable-line react-hooks/exhaustive-deps

  const ordered = React.useMemo(() => [...sections.favorites, ...sections.recent, ...sections.searched.flatMap((group) => group.rows)], [sections]);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setQuery("");
      setState({ status: "idle" });
    }
  }

  /**
   * Opens a record (§39, §125-§127). Already in the record's company: go. Anywhere
   * else: the server checks the person may enter that company, commits the
   * workspace, and re-validates the record there — its answer is where to go, the
   * record itself or its list when the record is no longer theirs (§106).
   */
  async function openResult(result: Option | undefined) {
    if (!result || entering) return;
    if (await openRecord({ href: result.href, company: result.company })) onOpenChange(false);
  }

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
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
  }

  React.useEffect(() => {
    document.getElementById(`${listId}-option-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, listId]);


  let index = -1;

  return (
    <>
      {/* A phone has room for an icon only; it opens the same panel, full screen (Fast Re-entry §148). */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("dialogTitle")}
        className="grid size-9 place-items-center rounded-md text-fg-muted transition-colors hover:bg-hover hover:text-fg md:hidden"
        data-testid="mobile-search-trigger"
      >
        <Search aria-hidden="true" className="size-5" />
      </button>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "hidden h-10 w-full items-center md:flex gap-2.5 rounded-lg border border-line bg-surface-muted pl-3.5 pr-2 text-left transition-colors",
          "hover:border-line-strong hover:bg-surface",
        )}
      >
        <Search aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
        <span className="min-w-0 flex-1 truncate text-table text-fg-subtle">
          {t("placeholder")}
        </span>
        <kbd
          aria-hidden="true"
          className="hidden shrink-0 rounded border border-line bg-surface px-1.5 py-0.5 font-sans text-micro font-medium text-fg-subtle lg:block"
        >
          {shortcut}
        </kbd>
      </button>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-sm:inset-0 max-sm:top-0 max-sm:left-0 max-sm:h-dvh max-sm:max-w-none max-sm:translate-x-0 max-sm:rounded-none top-[12%] max-w-xl translate-y-0 p-0 max-sm:flex max-sm:flex-col">
          <div className="border-b border-line p-3">
            <DialogTitle className="sr-only">{t("dialogTitle")}</DialogTitle>
            <div className="relative">
              {state.status === "loading" ? (
                <Loader2 aria-hidden="true" className="absolute left-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-fg-subtle" />
              ) : (
                <Search aria-hidden="true" className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
              )}
              <input
                autoFocus
                type="search"
                role="combobox"
                aria-expanded={ordered.length > 0}
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={ordered.length > 0 ? `${listId}-option-${active}` : undefined}
                aria-label={t("dialogTitle")}
                placeholder={t("placeholder")}
                value={query}
                maxLength={200}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onInputKeyDown}
                className="h-10 w-full rounded-md border border-line bg-surface pl-9 pr-3 text-body text-fg outline-none placeholder:text-fg-subtle focus:border-accent"
              />
            </div>
          </div>

          <div className="max-h-[min(26rem,60vh)] overflow-y-auto p-2 max-sm:max-h-none max-sm:flex-1" aria-live="polite">
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
                        const navigable = option.kind === "result" ? SEARCH_TO_NAVIGABLE[option.entityType] ?? (isNavigableType(option.entityType) ? option.entityType : null) : null;
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
                            className={cn("group flex cursor-pointer items-center gap-3 rounded-md px-2 py-2", selected ? "bg-hover" : "hover:bg-hover")}
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
                                className={cn("grid size-6 shrink-0 place-items-center rounded hover:bg-surface", starred ? "" : "opacity-0 group-hover:opacity-100 focus:opacity-100")}
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
                <Link href="/my-work?tab=favorites" onClick={() => onOpenChange(false)} className="text-meta font-medium text-accent-strong hover:underline">
                  {t("viewAllFavorites")}
                </Link>
                <Link href="/my-work?tab=recent" onClick={() => onOpenChange(false)} className="text-meta font-medium text-accent-strong hover:underline" data-testid="search-view-all-recent">
                  {t("viewAllRecent")} →
                </Link>
              </div>
            ) : null}
            {state.status === "loading" && ordered.length > 0 ? <p className="px-2 pt-1 text-meta text-fg-subtle">{t("searching")}</p> : null}
            {state.status === "done" && state.response.partial ? (
              <p className="px-2 pt-2 text-meta text-fg-subtle">{t("partial")}</p>
            ) : null}
          </div>

          <p className="hidden border-t border-line px-4 py-2 text-micro text-fg-subtle sm:block">{t("keys")}</p>
        </DialogContent>
      </Dialog>
    </>
  );
}
