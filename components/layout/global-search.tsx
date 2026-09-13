"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Boxes,
  Building2,
  ClipboardCheck,
  FileSignal,
  FileText,
  FolderKanban,
  HardHat,
  Loader2,
  type LucideIcon,
  Package,
  ReceiptText,
  Search,
  ShoppingCart,
  SquareCheckBig,
  Target,
  Truck,
  UserRound,
} from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { ModuleKey } from "@/config/modules";
import type { GlobalSearchResponseDTO, GlobalSearchResultDTO } from "@/lib/core/search/search.types";
import { cn } from "@/lib/utils/cn";

/**
 * Global search (design spec §16, §63; PRD #38 §87-§90).
 *
 * A front end for the one search backend, `/api/search`, and nothing more: the
 * providers behind it already apply company, module, permission and record
 * scope, so this component never decides what a person may find — it only
 * shows what the server returned. Results the server did not return leave no
 * trace here, not even a count.
 */

const MIN_QUERY = 2;
const DEBOUNCE_MS = 200;

const ENTITY_ICONS: Record<string, LucideIcon> = {
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
};

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
  const t = useTranslations("search");
  const tModules = useTranslations("modules");
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
  const ordered = React.useMemo(() => groups.flatMap(([, rows]) => rows), [groups]);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setQuery("");
      setState({ status: "idle" });
    }
  }

  function openResult(result: GlobalSearchResultDTO | undefined) {
    if (!result) return;
    onOpenChange(false);
    router.push(result.href);
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
      openResult(ordered[active]);
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
            {state.status === "idle" ? (
              <DialogDescription className="mt-0 px-2 py-3 text-table text-fg-subtle">{t("hint")}</DialogDescription>
            ) : state.status === "loading" && ordered.length === 0 ? (
              <p className="px-2 py-3 text-table text-fg-subtle">{t("searching")}</p>
            ) : state.status === "error" ? (
              <p role="alert" className="px-2 py-3 text-table text-danger-strong">
                {t("error")}
              </p>
            ) : ordered.length === 0 ? (
              <p className="px-2 py-3 text-table text-fg-muted">{t("noResults", { query: query.trim() })}</p>
            ) : (
              <div id={listId} role="listbox" aria-label={t("resultsLabel")}>
                {groups.map(([moduleKey, rows]) => (
                  <div key={moduleKey} role="group" aria-label={moduleLabel(moduleKey)} className="mb-1">
                    <p className="px-2 pb-1 pt-2 text-micro font-semibold uppercase tracking-[0.1em] text-fg-subtle">
                      {moduleLabel(moduleKey)}
                    </p>
                    {rows.map((result) => {
                      index += 1;
                      const position = index;
                      const Icon = ENTITY_ICONS[result.entityType] ?? Boxes;
                      const selected = position === active;
                      return (
                        <div
                          key={`${result.entityType}:${result.entityId}`}
                          id={`${listId}-option-${position}`}
                          role="option"
                          aria-selected={selected}
                          onMouseMove={() => setActive(position)}
                          onClick={() => openResult(result)}
                          className={cn(
                            "flex cursor-pointer items-center gap-3 rounded-md px-2 py-2",
                            selected ? "bg-hover" : "hover:bg-hover",
                          )}
                        >
                          <Icon aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-table text-fg">{result.title}</span>
                            {result.subtitle || result.meta ? (
                              <span className="block truncate text-meta text-fg-subtle">
                                {[result.subtitle, result.meta].filter(Boolean).join(" · ")}
                              </span>
                            ) : null}
                          </span>
                          {result.status ? (
                            <span className="shrink-0 text-micro text-fg-subtle">{result.status.replaceAll("_", " ").toLowerCase()}</span>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
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
