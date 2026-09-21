"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
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
import { useToast } from "@/components/ui/toast";
import { CompanyTag } from "@/components/workspace/company-tag";
import type { ModuleKey } from "@/config/modules";
import type { GlobalSearchCompany, GlobalSearchResponseDTO, GlobalSearchResultDTO } from "@/lib/core/search/search.types";
import { requestWorkspaceSwitch } from "@/lib/workspace/client";
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
type Shortcut = { entityType: string; entityId: string; title: string; subtitle?: string; href: string; company?: GlobalSearchCompany };
type Option = { key: string; kind: "favorite" | "recent" | "result"; entityType: string; title: string; subtitle?: string; href: string; status?: string; moduleKey?: string; company?: GlobalSearchCompany };

const SHORTCUT_LIMIT = 6;

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "done"; response: GlobalSearchResponseDTO };

export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [shortcut, setShortcut] = React.useState("Ctrl K");
  const [query, setQuery] = React.useState("");
  const [state, setState] = React.useState<State>({ status: "idle" });
  const [active, setActive] = React.useState(0);
  const [shortcuts, setShortcuts] = React.useState<{ favorites: Shortcut[]; recent: Shortcut[] } | null>(null);
  const [entering, setEntering] = React.useState(false);
  const t = useTranslations("search");
  const tModules = useTranslations("modules");
  const tWorkspace = useTranslations("workspace");
  const toast = useToast();
  const listId = React.useId();

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

  // Favorites and recent records load when the palette opens, fresh each time: a record
  // somebody lost access to since is simply not in the answer (PRD #45 §120, §319).
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void fetch("/api/productivity/palette")
      .then(async (response) => (response.ok ? ((await response.json()) as { data: { favorites: Shortcut[]; recent: Shortcut[] } }).data : null))
      .then((data) => !cancelled && setShortcuts(data))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open]);

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
  const favoriteKeys = React.useMemo(() => new Set((shortcuts?.favorites ?? []).map((item) => `${item.entityType}:${item.entityId}`)), [shortcuts]);

  // Favorites, then recent, then search — a record appears once, in its first section (§119, §275).
  const sections = React.useMemo(() => {
    const text = query.trim().toLowerCase();
    const matches = (item: Shortcut) => !text || item.title.toLowerCase().includes(text) || (item.subtitle ?? "").toLowerCase().includes(text);
    const seen = new Set<string>();
    const take = (items: Shortcut[], kind: "favorite" | "recent") =>
      items
        .filter(matches)
        .filter((item) => {
          const key = `${item.entityType}:${item.entityId}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, text ? 4 : SHORTCUT_LIMIT)
        .map((item): Option => ({ key: `${kind}:${item.entityType}:${item.entityId}`, kind, entityType: item.entityType, title: item.title, subtitle: item.subtitle, href: item.href, company: item.company }));
    const favorites = take(shortcuts?.favorites ?? [], "favorite");
    const recent = take(shortcuts?.recent ?? [], "recent");
    const searched = groups.map(([moduleKey, rows]) => ({
      moduleKey,
      rows: rows
        .filter((result) => !seen.has(`${result.entityType}:${result.entityId}`))
        .map((result): Option => ({ key: `result:${result.entityType}:${result.entityId}`, kind: "result", entityType: result.entityType, title: result.title, subtitle: [result.subtitle, result.meta].filter(Boolean).join(" · ") || undefined, href: result.href, status: result.status ?? undefined, moduleKey, company: result.company })),
    }));
    return { favorites, recent, searched: searched.filter((group) => group.rows.length) };
  }, [query, shortcuts, groups]);

  const ordered = React.useMemo(() => [...sections.favorites, ...sections.recent, ...sections.searched.flatMap((group) => group.rows)], [sections]);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setQuery("");
      setState({ status: "idle" });
    }
  }

  async function openResult(result: Option | undefined) {
    if (!result || entering) return;
    if (!result.company) {
      onOpenChange(false);
      router.push(result.href);
      return;
    }
    // A company's record is a company page: enter that company's workspace, then go on (§31).
    setEntering(true);
    const entered = await requestWorkspaceSwitch({ scopeType: "COMPANY", companyId: result.company.id });
    if (!entered.ok) {
      setEntering(false);
      toast({ title: tWorkspace("switchFailed", { name: result.company.name }), tone: "danger" });
      return;
    }
    window.location.assign(result.href);
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

  const moduleLabel = (key: string) => {
    const label = tModules(`${key as ModuleKey}.label`);
    return label.endsWith(".label") ? key : label;
  };

  let index = -1;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "flex h-10 w-full items-center gap-2.5 rounded-lg border border-line bg-surface-muted pl-3.5 pr-2 text-left transition-colors",
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
        <DialogContent className="top-[12%] max-w-xl translate-y-0 p-0">
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

          <div className="max-h-[min(26rem,60vh)] overflow-y-auto p-2" aria-live="polite">
            {ordered.length > 0 ? (
              <div id={listId} role="listbox" aria-label={t("resultsLabel")}>
                {[
                  { key: "favorites", label: t("favorites"), rows: sections.favorites },
                  { key: "recent", label: t("recent"), rows: sections.recent },
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
                        const starred = option.kind === "result" && favoriteKeys.has(option.key.slice("result:".length));
                        return (
                          <div
                            key={option.key}
                            id={`${listId}-option-${position}`}
                            role="option"
                            aria-selected={selected}
                            onMouseMove={() => setActive(position)}
                            onClick={() => void openResult(option)}
                            className={cn("flex cursor-pointer items-center gap-3 rounded-md px-2 py-2", selected ? "bg-hover" : "hover:bg-hover")}
                          >
                            <Icon aria-hidden="true" className={cn("size-4 shrink-0", option.kind === "favorite" ? "fill-warning text-warning" : "text-fg-subtle")} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-table text-fg">{option.title}</span>
                              {option.subtitle ? <span className="block truncate text-meta text-fg-subtle">{option.subtitle}</span> : null}
                            </span>
                            {option.company ? <CompanyTag name={option.company.name} className="shrink-0" /> : null}
                            {starred ? <Star aria-label="Favorite" className="size-3.5 shrink-0 fill-warning text-warning" /> : null}
                            {option.status ? <span className="shrink-0 text-micro text-fg-subtle">{option.status.replaceAll("_", " ").toLowerCase()}</span> : null}
                          </div>
                        );
                      })}
                    </div>
                  ))}
              </div>
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
