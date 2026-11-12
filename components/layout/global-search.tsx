"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { usePathname } from "next/navigation";
import { Loader2, Search } from "@/components/icons";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { PanelFailure, PanelLoading } from "@/components/layout/panels/panel-frame";
import { SEARCH_SCOPES, stepScope, type SearchScope } from "@/lib/core/search/palette";
import type { GlobalSearchCompany, GlobalSearchResponseDTO } from "@/lib/core/search/search.types";
import { fetchMenu, menuPathname, QUICK_CREATE_PICK_EVENT } from "@/lib/modules/quick-create/menu-cache";
import { createPanelLoader, usePanelModule, usePanelOpen, useWarmIntent } from "@/lib/navigation/panel-host";
import { readSearchHomeCache, removeLegacySearchHomeCache, subscribeMyWork, writeSearchHomeCache } from "@/lib/productivity/client";
import { DialogScrim } from "@/components/ui/dialog";
import { cn } from "@/lib/utils/cn";

/**
 * Global search (design spec §16, §63; PRD #38 §87-§90; NAV-03 PANEL-01,
 * PANEL-04; docs/ui/UI-08-search.md).
 *
 * One box for records, pages and actions. A palette in the upper third of the
 * page, which dims behind it, from 640px; the whole screen on a phone. Under
 * the field its filters by kind — All, Projects, Units, Tasks, People,
 * Clients, Documents, Pages — which Tab and Shift+Tab step through.
 *
 * Records come from the one search backend, `/api/search`: the providers
 * behind it apply company, module, permission and record scope, so this never
 * decides what a person may find. Pages are the person's own navigation, as
 * the server resolved it for them; actions the create actions Quick Create
 * offers here, read when the palette opens. An action is handed to Quick
 * Create, which runs it as its own + would.
 *
 * The trigger, the Ctrl/Cmd+K shortcut, the palette's frame, field and filters
 * and the reads live here; the results and Search Home render in a separate
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
/** A page the person may open: an entry of their navigation, its label in their language and the name of the place it is in. */
export type SearchPage = { key: string; label: string; href: string; icon: string; place: string };
/** A create action Quick Create offers here. */
export type SearchAction = { key: string; label: string; icon: string; keywords: string[] };

const body = createPanelLoader("search", () => import("@/components/layout/panels/search-panel-body"));

/** The records search for what was typed, within a filter. */
function searchUrl(text: string, scope: SearchScope): string {
  const types = SEARCH_SCOPES.find((entry) => entry.key === scope)?.types ?? null;
  // One kind asks its providers for more, since nothing else shares the list.
  return types ? `/api/search?q=${encodeURIComponent(text)}&limit=30&limitPerProvider=20${types.map((type) => `&type=${type}`).join("")}` : `/api/search?q=${encodeURIComponent(text)}&limit=20`;
}

export function GlobalSearch({ contextKey, pages = [] }: { contextKey: string; pages?: SearchPage[] }) {
  const t = useTranslations("search");
  const tu = useTranslations("ui");
  const pathname = usePathname();
  const [open, setOpenState] = usePanelOpen("search");
  const [shortcut, setShortcut] = React.useState("Ctrl K");
  const [query, setQuery] = React.useState("");
  const [scope, setScope] = React.useState<SearchScope>("all");
  const [state, setState] = React.useState<SearchState>({ status: "idle" });
  const [active, setActive] = React.useState(0);
  const [options, setOptions] = React.useState(0);
  const [shortcuts, setShortcuts] = React.useState<SearchHome | null>(null);
  const [homeFailed, setHomeFailed] = React.useState(false);
  const [actions, setActions] = React.useState<SearchAction[]>([]);
  const keyHandler = React.useRef<((event: React.KeyboardEvent<HTMLInputElement>) => void) | null>(null);
  /** Bumped on every open and close: an answer for an older opening never shows (P11). */
  const generation = React.useRef(0);
  const listId = React.useId();
  const warm = useWarmIntent(body);
  const { state: code, retry: retryCode } = usePanelModule(body, open);

  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const setOpen = React.useCallback(
    (next: boolean) => {
      generation.current += 1;
      setOpenState(next);
      if (!next) {
        setQuery("");
        setScope("all");
        setState({ status: "idle" });
        setActive(0);
      }
    },
    [setOpenState],
  );
  const close = React.useCallback(() => setOpen(false), [setOpen]);

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
    setActions([]);
    setOpen(false);
  }, [contextKey, setOpen]);

  // Each keystroke waits for typing to pause; a newer query or filter cancels the
  // one in flight, and only an answer for the current query and opening shows.
  // Pages are the palette's own list: nothing to ask the server.
  React.useEffect(() => {
    const text = query.trim();
    if (!open || text.length < MIN_QUERY || scope === "pages") {
      setState({ status: "idle" });
      return;
    }
    const asked = generation.current;
    const controller = new AbortController();
    setState({ status: "loading" });
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(searchUrl(text, scope), { signal: controller.signal, cache: "no-store" });
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
  }, [query, scope, open, contextKey]);

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

  // What can be created here, as Quick Create's + offers it on this page; none when it cannot be read.
  React.useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void fetchMenu(menuPathname(pathname), controller.signal).then((result) => {
      if (result.ok) setActions(result.menu.actions.map((action) => ({ key: action.key, label: action.label, icon: action.icon, keywords: action.keywords })));
    });
    return () => controller.abort();
  }, [open, pathname]);

  /** An action is Quick Create's to run, with its company or project step when it has one. */
  const runAction = React.useCallback(
    (key: string) => {
      close();
      window.dispatchEvent(new CustomEvent(QUICK_CREATE_PICK_EVENT, { detail: { key } }));
    },
    [close],
  );

  const chooseScope = React.useCallback((next: SearchScope) => {
    setScope(next);
    setActive(0);
    inputRef.current?.focus();
  }, []);

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    // Tab and Shift+Tab step through the filters; the arrows and Enter are the results'.
    if (event.key === "Tab" && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      chooseScope(stepScope(scope, event.shiftKey ? -1 : 1));
      return;
    }
    keyHandler.current?.(event);
  }

  const Body = code.status === "ready" ? code.module.SearchPanelBody : null;

  return (
    <>
      {/* The first control of the universal cluster: an icon, and from lg a field-shaped button that takes what the bar's right side leaves, with its shortcut from xl (UI-01 §8.1). */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("dialogTitle")}
        aria-keyshortcuts="Meta+K Control+K"
        title={`${t("dialogTitle")} (${shortcut.replace(" ", "")})`}
        className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-none text-fg-muted transition-colors hover:bg-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch:size-11 lg:flex lg:h-10 lg:w-auto lg:min-w-0 lg:flex-1 lg:justify-start lg:gap-2 lg:border lg:border-line lg:bg-surface lg:pl-3.5 lg:pr-2 lg:hover:border-line-strong lg:hover:bg-surface"
        data-testid="search-trigger"
        {...warm}
      >
        <Search aria-hidden="true" className="size-[18px] shrink-0 lg:size-4" />
        <span aria-hidden="true" className="hidden min-w-0 flex-1 truncate text-left text-body text-fg-subtle lg:inline">{t("trigger")}</span>
        <kbd aria-hidden="true" className="hidden shrink-0 rounded-none border border-line px-1.5 py-px font-mono text-[0.625rem] tracking-[0.06em] text-fg-subtle xl:inline">{shortcut.replace("Ctrl ", "Ctrl+")}</kbd>
      </button>

      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Portal>
          {/* From 640px the page dims behind the palette; a phone's palette is the whole screen. */}
          <DialogScrim className="max-sm:hidden" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              inputRef.current?.focus();
            }}
            onCloseAutoFocus={(event) => {
              // Back to the control that opened it, without scrolling the page to it.
              event.preventDefault();
              if (triggerRef.current?.isConnected && triggerRef.current.getClientRects().length > 0) triggerRef.current.focus({ preventScroll: true });
            }}
            className={cn(
              "fixed z-[60] flex flex-col bg-surface text-fg outline-none data-[state=open]:animate-[nesto-fade-in_140ms_var(--nesto-ease)]",
              "max-sm:inset-0 max-sm:pt-[var(--nesto-safe-top)]",
              "sm:left-1/2 sm:top-[max(4.5rem,12vh)] sm:max-h-[min(40rem,calc(100dvh-max(4.5rem,12vh)-2rem))] sm:w-[min(45rem,calc(100vw-2rem))] sm:-translate-x-1/2 sm:border sm:border-line-strong sm:shadow-dialog",
            )}
            data-testid="search-palette"
          >
            <DialogPrimitive.Title className="sr-only">{t("dialogTitle")}</DialogPrimitive.Title>

            {/* The field: large, the whole width; Esc from 640px, Cancel on a phone. */}
            <div className="flex items-center gap-3 border-b border-line px-4 max-sm:gap-2 max-sm:py-2 max-sm:pr-2 sm:h-14">
              <div className="relative flex min-w-0 flex-1 items-center max-sm:h-11 max-sm:border max-sm:border-line-strong max-sm:bg-surface-muted max-sm:pl-3">
                {state.status === "loading" ? (
                  <Loader2 aria-hidden="true" className="size-[18px] shrink-0 animate-spin text-fg-subtle" />
                ) : (
                  <Search aria-hidden="true" className="size-[18px] shrink-0 text-fg-subtle" />
                )}
                <input
                  ref={inputRef}
                  data-autofocus
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
                  autoComplete="off"
                  spellCheck={false}
                  enterKeyHint="search"
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={onKeyDown}
                  className="h-full w-full min-w-0 bg-transparent pl-3 pr-2 text-[1.0625rem] text-fg outline-none placeholder:text-fg-subtle sm:h-14 [&::-webkit-search-cancel-button]:hidden"
                  data-testid="search-input"
                />
              </div>
              <DialogPrimitive.Close
                className="grid h-9 shrink-0 place-items-center border border-line px-2 font-mono text-micro font-medium uppercase tracking-[0.1em] text-fg-subtle transition-colors hover:border-line-strong hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:hidden touch:h-11"
                aria-label={tu("close")}
              >
                <span aria-hidden="true">Esc</span>
              </DialogPrimitive.Close>
              <DialogPrimitive.Close className="h-11 shrink-0 px-2 text-body font-medium text-accent-strong sm:hidden">{tu("cancel")}</DialogPrimitive.Close>
            </div>

            {/* The filters: one kind at a time; Tab and Shift+Tab in the field step through them. */}
            <div role="radiogroup" aria-label={t("filtersLabel")} className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-line px-4 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-testid="search-scopes">
              {SEARCH_SCOPES.map((entry) => {
                const on = entry.key === scope;
                return (
                  <button
                    key={entry.key}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    tabIndex={-1}
                    onClick={() => chooseScope(entry.key)}
                    className={cn(
                      "h-7 shrink-0 border px-2.5 font-mono text-micro font-medium uppercase tracking-[0.1em] transition-colors touch:h-9",
                      on ? "border-fg bg-fg text-canvas" : "border-line text-fg-muted hover:border-line-strong hover:text-fg",
                    )}
                    data-testid={`search-scope-${entry.key}`}
                  >
                    {t(`scopes.${entry.key}`)}
                  </button>
                );
              })}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[max(0.5rem,var(--nesto-safe-bottom))] sm:pb-2" aria-live="polite">
              {Body ? (
                <Body
                  query={query}
                  scope={scope}
                  state={state}
                  shortcuts={shortcuts}
                  homeFailed={homeFailed}
                  pages={pages}
                  actions={actions}
                  listId={listId}
                  active={active}
                  setActive={setActive}
                  keyHandler={keyHandler}
                  onOptions={setOptions}
                  onClose={close}
                  onAction={runAction}
                />
              ) : code.status === "failed" ? (
                <PanelFailure kind="code" reloadAdvised={code.reloadAdvised} onRetry={retryCode} onClose={close} />
              ) : (
                <PanelLoading label={t("searching")} />
              )}
            </div>

            {/* The keys, from 640px. */}
            <p className="hidden shrink-0 items-center gap-x-4 border-t border-line px-4 py-2 font-mono text-micro uppercase tracking-[0.08em] text-fg-subtle sm:flex" data-testid="search-keys">
              <span><Key>↑</Key><Key>↓</Key> {t("keysMove")}</span>
              <span><Key>↵</Key> {t("keysOpen")}</span>
              <span><Key>Tab</Key> {t("keysFilter")}</span>
              <span><Key>Esc</Key> {t("keysClose")}</span>
            </p>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return <kbd className="mr-1 inline-grid min-w-5 place-items-center border border-line px-1 py-px font-mono text-[0.625rem] normal-case tracking-normal text-fg-muted">{children}</kbd>;
}
