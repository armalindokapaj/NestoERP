"use client";

import * as React from "react";
import { Loader2, Search } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { PanelFailure, PanelLoading } from "@/components/layout/panels/panel-frame";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { GlobalSearchCompany, GlobalSearchResponseDTO } from "@/lib/core/search/search.types";
import { createPanelLoader, usePanelModule, usePanelOpen, useWarmIntent } from "@/lib/navigation/panel-host";
import { readSearchHomeCache, removeLegacySearchHomeCache, subscribeMyWork, writeSearchHomeCache } from "@/lib/productivity/client";
import { cn } from "@/lib/utils/cn";

/**
 * Global search (design spec §16, §63; PRD #38 §87-§90; NAV-03 PANEL-01,
 * PANEL-04).
 *
 * A front end for the one search backend, `/api/search`: the providers behind
 * it apply company, module, permission and record scope, so this never
 * decides what a person may find.
 *
 * The trigger, the Ctrl/Cmd+K shortcut, the palette's frame and input, and
 * the two reads live here; the results and Search Home render in a separate
 * chunk loaded on open. Code and data start together, and typing is kept while
 * the body arrives. In the Group workspace a row in a company opens that
 * company's workspace first (Workspace Context §31, §40, §99).
 */

export const MIN_QUERY = 2;
const DEBOUNCE_MS = 200;

/** A favorite or recent record, already resolved against access by the server (PRD #45 §119, §319). */
export type SearchShortcut = { entityType: string; entityId: string; title: string; subtitle?: string; href: string; moduleKey?: string; project?: { id: string; name: string }; company?: GlobalSearchCompany };
/** `/api/search/home` (Fast Re-entry §91, §195). */
export type SearchHome = { favorites: SearchShortcut[]; recent: SearchShortcut[]; favoriteKeys?: string[]; workspace: { scopeType: "GROUP" | "COMPANY"; companyId: string | null } };
export type SearchState = { status: "idle" } | { status: "loading" } | { status: "error" } | { status: "done"; response: GlobalSearchResponseDTO };

const body = createPanelLoader("search", () => import("@/components/layout/panels/search-panel-body"));

export function GlobalSearch({ contextKey }: { contextKey: string }) {
  const t = useTranslations("search");
  const [open, setOpenState] = usePanelOpen("search");
  const [shortcut, setShortcut] = React.useState("Ctrl K");
  const [query, setQuery] = React.useState("");
  const [state, setState] = React.useState<SearchState>({ status: "idle" });
  const [active, setActive] = React.useState(0);
  const [options, setOptions] = React.useState(0);
  const [shortcuts, setShortcuts] = React.useState<SearchHome | null>(null);
  const [homeFailed, setHomeFailed] = React.useState(false);
  const keyHandler = React.useRef<((event: React.KeyboardEvent<HTMLInputElement>) => void) | null>(null);
  /** Bumped on every open and close: an answer for an older opening never shows (P11). */
  const generation = React.useRef(0);
  const listId = React.useId();
  const warm = useWarmIntent(body);
  const { state: code, retry: retryCode } = usePanelModule(body, open);

  const setOpen = React.useCallback(
    (next: boolean) => {
      generation.current += 1;
      setOpenState(next);
      if (!next) {
        setQuery("");
        setState({ status: "idle" });
        setActive(0);
      }
    },
    [setOpenState],
  );

  // One listener for the page's life; the body need not be loaded for the shortcut to work (PANEL-02).
  const openRef = React.useRef(open);
  openRef.current = open;
  React.useEffect(() => {
    removeLegacySearchHomeCache();
    if (navigator.platform.toLowerCase().includes("mac")) setShortcut("⌘ K");
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.isComposing) return;
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen(!openRef.current);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setOpen]);

  // A changed identity or workspace forgets what was shown.
  React.useEffect(() => {
    setShortcuts(null);
    setOpen(false);
  }, [contextKey, setOpen]);

  // Each keystroke waits for typing to pause; a newer query cancels the one in
  // flight, and only an answer for the current query and opening shows.
  React.useEffect(() => {
    const text = query.trim();
    if (!open || text.length < MIN_QUERY) {
      setState({ status: "idle" });
      return;
    }
    const asked = generation.current;
    const controller = new AbortController();
    setState({ status: "loading" });
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(text)}&limit=20`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error(String(response.status));
        const json = (await response.json()) as GlobalSearchResponseDTO & { data?: GlobalSearchResponseDTO; meta?: { contextKey?: string } };
        if (controller.signal.aborted || asked !== generation.current) return;
        if (json.meta?.contextKey && json.meta.contextKey !== contextKey) return setState({ status: "error" });
        setState({ status: "done", response: json.data ?? json });
        setActive(0);
      } catch (error) {
        if ((error as Error).name !== "AbortError" && asked === generation.current) setState({ status: "error" });
      }
    }, DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query, open, contextKey]);

  // Search Home: a same-context answer under 30 s old paints at once; one fresh
  // read, resolved against access now, replaces it (Fast Re-entry §6, §128).
  React.useEffect(() => {
    if (!open) return;
    const asked = generation.current;
    const cached = readSearchHomeCache<SearchHome>(contextKey);
    setShortcuts(cached);
    setHomeFailed(false);
    let inFlight: AbortController | null = null;
    const load = () => {
      inFlight?.abort();
      const controller = new AbortController();
      inFlight = controller;
      fetch("/api/search/home", { signal: controller.signal, cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) throw new Error(String(response.status));
          const json = (await response.json()) as { data: SearchHome; meta?: { contextKey?: string } };
          if (asked !== generation.current) return;
          if (json.meta?.contextKey && json.meta.contextKey !== contextKey) throw new Error("context");
          writeSearchHomeCache(contextKey, json.data);
          setShortcuts(json.data);
          setHomeFailed(false);
        })
        .catch((error: Error) => {
          if (error.name !== "AbortError" && asked === generation.current) setHomeFailed(true);
        });
    };
    load();
    // A star or an open in another tab refreshes this panel (§88, §89).
    const unsubscribe = subscribeMyWork(load);
    return () => {
      inFlight?.abort();
      unsubscribe();
    };
  }, [open, contextKey]);

  const Body = code.status === "ready" ? code.module.SearchPanelBody : null;
  const close = React.useCallback(() => setOpen(false), [setOpen]);

  return (
    <>
      {/* A phone has room for an icon only; it opens the same panel, full screen (Fast Re-entry §148). */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("dialogTitle")}
        className="grid size-9 place-items-center rounded-md text-fg-muted transition-colors hover:bg-hover hover:text-fg md:hidden touch:size-11"
        data-testid="mobile-search-trigger"
      >
        <Search aria-hidden="true" className="size-5" />
      </button>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn("hidden h-10 w-full items-center gap-2.5 rounded-lg border border-line bg-surface-muted pl-3.5 pr-2 text-left transition-colors md:flex", "hover:border-line-strong hover:bg-surface")}
        data-testid="search-trigger"
        {...warm}
      >
        <Search aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
        <span className="min-w-0 flex-1 truncate text-table text-fg-subtle">{t("placeholder")}</span>
        <kbd aria-hidden="true" className="hidden shrink-0 rounded border border-line bg-surface px-1.5 py-0.5 font-sans text-micro font-medium text-fg-subtle lg:block">
          {shortcut}
        </kbd>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        {/* Full screen on a phone: the dialog's viewport cap does not apply there, and the
            header keeps clear of the 44px close control (AUD-04 §6). */}
        <DialogContent className="top-[12%] max-w-xl translate-y-0 p-0 max-sm:inset-0 max-sm:left-0 max-sm:top-0 max-sm:flex max-sm:h-dvh max-sm:max-h-none max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:flex-col max-sm:overflow-hidden max-sm:rounded-none max-sm:pt-[env(safe-area-inset-top)] max-sm:pb-[env(safe-area-inset-bottom)]" closeClassName="touch:top-[calc(env(safe-area-inset-top)+0.375rem)]">
          <div className="border-b border-line p-3 touch:pr-14">
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
                aria-expanded={options > 0}
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={Body && options > 0 ? `${listId}-option-${active}` : undefined}
                aria-label={t("dialogTitle")}
                placeholder={t("placeholder")}
                value={query}
                maxLength={200}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => keyHandler.current?.(event)}
                className="h-10 w-full rounded-md border border-line bg-surface pl-9 pr-3 text-body text-fg outline-none placeholder:text-fg-subtle focus:border-accent touch:h-11"
                data-testid="search-input"
              />
            </div>
          </div>

          <div className="max-h-[min(26rem,60vh)] overflow-y-auto p-2 max-sm:max-h-none max-sm:flex-1" aria-live="polite">
            {Body ? (
              <Body query={query} state={state} shortcuts={shortcuts} homeFailed={homeFailed} listId={listId} active={active} setActive={setActive} keyHandler={keyHandler} onOptions={setOptions} onClose={close} />
            ) : code.status === "failed" ? (
              <PanelFailure kind="code" reloadAdvised={code.reloadAdvised} onRetry={retryCode} onClose={close} />
            ) : (
              <PanelLoading label={t("searching")} />
            )}
          </div>

          <p className="hidden border-t border-line px-4 py-2 text-micro text-fg-subtle sm:block">{t("keys")}</p>
        </DialogContent>
      </Dialog>
    </>
  );
}
