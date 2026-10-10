"use client";

import * as React from "react";
import { Loader2, Search, X } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { PanelFailure, PanelLoading } from "@/components/layout/panels/panel-frame";
import { GlassPanel, type GlassPanelControl } from "@/components/ui/glass-panel";
import type { GlobalSearchCompany, GlobalSearchResponseDTO } from "@/lib/core/search/search.types";
import { createPanelLoader, usePanelModule, usePanelOpen, useWarmIntent } from "@/lib/navigation/panel-host";
import { readSearchHomeCache, removeLegacySearchHomeCache, subscribeMyWork, writeSearchHomeCache } from "@/lib/productivity/client";

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
  const tu = useTranslations("ui");
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

  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const controlRef = React.useRef<GlassPanelControl | null>(null);

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

  const requestClose = React.useCallback(() => (controlRef.current ? controlRef.current.close() : setOpen(false)), [setOpen]);

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
        if (openRef.current) requestClose();
        else setOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setOpen, requestClose]);

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
  const close = requestClose;

  return (
    <>
      {/* The first control of the universal cluster, an icon at every width (UI-01 §8.1). */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("dialogTitle")}
        aria-keyshortcuts="Meta+K Control+K"
        title={`${t("dialogTitle")} (${shortcut.replace(" ", "")})`}
        className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-md text-fg-muted transition-colors hover:bg-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-testid="search-trigger"
        {...warm}
      >
        <Search aria-hidden="true" className="size-5" strokeWidth={1.6} />
      </button>

      <GlassPanel
        open={open}
        onOpenChange={setOpen}
        triggerRef={triggerRef}
        controlRef={controlRef}
        title={t("dialogTitle")}
        header={
          <div className="flex items-center gap-2 border-b border-line/70 p-2">
            <div className="relative min-w-0 flex-1">
              {state.status === "loading" ? (
                <Loader2 aria-hidden="true" className="absolute left-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-fg-subtle" />
              ) : (
                <Search aria-hidden="true" className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
              )}
              <input
                data-autofocus
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
                className="h-10 w-full rounded-lg border border-transparent bg-transparent pl-9 pr-3 text-body text-fg outline-none placeholder:text-fg-subtle focus:border-accent focus-visible:ring-2 focus-visible:ring-ring touch:h-11 [&::-webkit-search-cancel-button]:hidden"
                data-testid="search-input"
              />
            </div>
            <button type="button" onClick={requestClose} className="grid size-9 shrink-0 place-items-center rounded-md text-fg-subtle transition-colors hover:bg-hover hover:text-fg touch:size-11" aria-label={tu("close")}>
              <X aria-hidden="true" className="size-4" />
            </button>
          </div>
        }
      >
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2" aria-live="polite">
          {Body ? (
            <Body query={query} state={state} shortcuts={shortcuts} homeFailed={homeFailed} listId={listId} active={active} setActive={setActive} keyHandler={keyHandler} onOptions={setOptions} onClose={close} />
          ) : code.status === "failed" ? (
            <PanelFailure kind="code" reloadAdvised={code.reloadAdvised} onRetry={retryCode} onClose={close} />
          ) : (
            <PanelLoading label={t("searching")} />
          )}
        </div>

        <p className="hidden border-t border-line/70 px-4 py-2 text-micro text-fg-subtle sm:block">{t("keys")}</p>
      </GlassPanel>
    </>
  );
}
