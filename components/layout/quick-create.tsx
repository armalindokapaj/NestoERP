"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { ArrowLeft, Building2, ClipboardCheck, FileText, FolderKanban, HardHat, Loader2, NotebookPen, Plus, Presentation, ReceiptText, RefreshCw, Search, ShoppingCart, SquareCheckBig, Target, Wallet, WifiOff, X, type LucideIcon } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { useFeedbackRouter, useNavigationFeedback } from "@/components/navigation/navigation-feedback";
import { useToast } from "@/components/ui/toast";
import { QUICK_CREATE_GROUP_LABELS, QUICK_CREATE_GROUPS } from "@/config/quick-create";
import { WORKSPACE_CHANGED, type WorkspaceChange } from "@/config/workspace";
import type { QuickCreateShellDTO } from "@/lib/modules/quick-create/context-key";
import {
  createMenuCache,
  fetchMenu,
  fetchWithDeadline,
  isInternalAppPath,
  menuPathname,
  REQUEST_TIMEOUT_MS,
  type MenuFailure,
} from "@/lib/modules/quick-create/menu-cache";
import type { QuickCreateActionDTO, QuickCreateCompany, QuickCreateLaunchDTO, QuickCreateMenuDTO } from "@/lib/modules/quick-create/quick-create.service";
import { confirmWorkspaceNavigation, openInSwitchedWorkspace, requestWorkspaceSwitch } from "@/lib/workspace/client";
import { cn } from "@/lib/utils/cn";

/**
 * `+ Create` (Quick Create PRD §4-§7, §13-§20, §34, §37-§50, §69-§71, §129, §150-§156;
 * NAV-01 QC-01..QC-12).
 *
 * The button and the `C` shortcut come from the shell's summary — whether this
 * person may create anything here — so nothing is fetched to draw them. The
 * menu is asked for only when the person opens it: never on mount, on a route
 * change or on a workspace event (NAV-01 §1). It is the server's answer, only
 * actions the person may create here, cached for 30 s in this tab under the
 * shell's context key and the exact page path.
 *
 * In a company workspace the company is already known; in the Group workspace
 * the person chooses one the server listed, and a flow that lives under a
 * project asks for the project. Launching asks the server again, so a menu
 * drawn before a permission changed cannot open anything (§95).
 *
 * Every answer is fenced: an open, a close, a route change, a workspace change
 * or a new identity each move a generation on, and an answer from an older one
 * is dropped even when its fetch finished after the abort (QC-09).
 */

const ICONS: Record<string, LucideIcon> = { SquareCheckBig, Presentation, FileText, FolderKanban, NotebookPen, Building2, Target, ReceiptText, Wallet, ShoppingCart, ClipboardCheck, HardHat };
const RECENT_LIMIT = 4;
const SEARCH_FROM = 8;

type Step = { kind: "menu" } | { kind: "company"; action: QuickCreateActionDTO } | { kind: "project"; action: QuickCreateActionDTO; company: QuickCreateCompany | null };

type MenuState =
  | { status: "loading" }
  | { status: "ready"; menu: QuickCreateMenuDTO; stale?: boolean }
  | { status: "failed"; reason: MenuFailure | "unavailable"; message?: string };

type ProjectsState =
  | { status: "loading" }
  | { status: "ready"; items: Array<{ id: string; name: string }> }
  | { status: "failed"; message?: string };

type ErrorBody = { error?: { code?: string; message?: string; details?: { code?: string } } } | null;

function recentKey(userKey: string) {
  return `nesto-quick-create-recent:${userKey}`;
}

/** Recent actions are action keys only, never record details (§38); always intersected with the current menu. */
function readRecent(userKey: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(recentKey(userKey)) ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, RECENT_LIMIT) : [];
  } catch {
    return [];
  }
}

function rememberRecent(userKey: string, key: string) {
  try {
    localStorage.setItem(recentKey(userKey), JSON.stringify([key, ...readRecent(userKey).filter((item) => item !== key)].slice(0, RECENT_LIMIT)));
  } catch {
    // Not remembered; nothing else depends on it.
  }
}

function isProjectList(value: unknown): value is Array<{ id: string; name: string }> {
  return Array.isArray(value) && value.every((item) => item && typeof item.id === "string" && typeof item.name === "string");
}

function isLaunchDTO(value: unknown): value is QuickCreateLaunchDTO {
  const data = value as Partial<QuickCreateLaunchDTO> | null;
  return !!data && isInternalAppPath(data.href) && typeof data.switchWorkspace === "boolean" && !!data.company && typeof data.company.id === "string";
}

/** An element that takes typing, or an open modal: `C` belongs to it, not to Create (§44, QC-03). */
function typingOrModal(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement ? target : null;
  if (element && (element.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName) || element.closest("[role=dialog],[role=alertdialog]"))) return true;
  return Boolean(document.querySelector("[aria-modal='true'],[role=alertdialog]"));
}

export function QuickCreate({ userKey, summary }: { userKey: string; summary: QuickCreateShellDTO }) {
  const nav = useFeedbackRouter();
  const feedback = useNavigationFeedback();
  const pathname = usePathname();
  const toast = useToast();
  const t = useTranslations("shell");
  const panelId = React.useId();
  const headingId = `${panelId}-heading`;
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);

  // One cache per signed-in user; a different user never inherits it (QC-08, Q13).
  const cache = React.useMemo(() => createMenuCache({ fetcher: fetchMenu }), [userKey]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => () => cache.invalidate(), [cache]);

  const [open, setOpen] = React.useState(false);
  const [menuState, setMenuState] = React.useState<MenuState>({ status: "loading" });
  const [step, setStep] = React.useState<Step>({ kind: "menu" });
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const [recent, setRecent] = React.useState<string[]>([]);
  const [launching, setLaunching] = React.useState<string | null>(null);
  const [company, setCompany] = React.useState<string>("");
  const [projects, setProjects] = React.useState<ProjectsState>({ status: "loading" });
  const [project, setProject] = React.useState("");
  const [stepNotice, setStepNotice] = React.useState<string | null>(null);

  /** The open panel's generation: every async answer checks it before it lands (QC-09). */
  const openGeneration = React.useRef(0);
  const openedPath = React.useRef<string | null>(null);
  const projectsRequest = React.useRef<{ id: number; controller: AbortController | null }>({ id: 0, controller: null });
  /** The launch in progress; a newer launch, a close by context change or an unrelated switch moves it on. */
  const launchSeq = React.useRef(0);
  const launchBusy = React.useRef(false);
  /** Set while a launch waits for the workspace switch it asked for: that one WORKSPACE_CHANGED is its own (QC-11). */
  const ownSwitch = React.useRef<{ launch: number; companyId: string } | null>(null);
  /** The context key a shell refresh was already asked for, so a mismatch never loops (QC-02). */
  const refreshedFor = React.useRef<string | null>(null);

  const cancelProjects = React.useCallback(() => {
    projectsRequest.current.controller?.abort();
    projectsRequest.current = { id: projectsRequest.current.id + 1, controller: null };
  }, []);

  /** Closes without pulling focus anywhere: for a navigation, a context change or an identity change (QC-06). */
  const dismiss = React.useCallback(() => {
    openGeneration.current += 1;
    openedPath.current = null;
    cache.cancel();
    cancelProjects();
    setOpen(false);
    setStep({ kind: "menu" });
    setQuery("");
    setActive(0);
    setProject("");
    setStepNotice(null);
  }, [cache, cancelProjects]);

  /** Closes by the person's own hand, handing focus back to the button. */
  const close = React.useCallback(() => {
    dismiss();
    triggerRef.current?.focus();
  }, [dismiss]);

  // The shell says who this is and what they may create; a new answer is a new namespace (QC-02, QC-08).
  const shellKey = React.useRef(summary.contextKey);
  React.useEffect(() => {
    cache.setContext(summary.contextKey);
    if (shellKey.current !== summary.contextKey) {
      shellKey.current = summary.contextKey;
      dismiss();
    }
  }, [summary.contextKey, cache, dismiss]);

  // A route change closes an open panel and cancels its work; with the panel closed it does nothing at all (QC-08).
  React.useEffect(() => {
    if (openedPath.current !== null && openedPath.current !== pathname) dismiss();
  }, [pathname, dismiss]);

  // A workspace change drops every menu. The switch a launch asked for lets that launch finish (QC-11, Q19, Q20).
  React.useEffect(() => {
    const onChange = (event: Event) => {
      const change = (event as CustomEvent<WorkspaceChange | undefined>).detail;
      cache.invalidate();
      const own = ownSwitch.current;
      if (own && own.launch === launchSeq.current && change?.nextScopeType === "COMPANY" && change.nextCompanyId === own.companyId) return;
      launchSeq.current += 1;
      launchBusy.current = false;
      setLaunching(null);
      dismiss();
    };
    window.addEventListener(WORKSPACE_CHANGED, onChange);
    return () => window.removeEventListener(WORKSPACE_CHANGED, onChange);
  }, [cache, dismiss]);

  const loadMenu = React.useCallback(() => {
    const generation = openGeneration.current;
    const path = menuPathname(pathname);
    const cached = cache.peek(path);
    if (cached) {
      setMenuState({ status: "ready", menu: cached });
      return;
    }
    setMenuState({ status: "loading" });
    void cache.load(path).then((result) => {
      if (generation !== openGeneration.current) return;
      if (result.ok) {
        setMenuState({ status: "ready", menu: result.menu });
        return;
      }
      switch (result.reason) {
        case "cancelled":
        case "superseded":
          return;
        case "context-changed":
          // Drawn for another identity or workspace: never shown. The shell is refreshed once; Create is reopened by hand (Q15).
          cache.invalidate();
          dismiss();
          toast({ title: t("quickCreate.contextChanged") });
          if (refreshedFor.current !== summary.contextKey) {
            refreshedFor.current = summary.contextKey;
            nav.refresh();
          }
          return;
        case "unauthenticated":
          cache.invalidate();
          dismiss();
          nav.refresh();
          return;
        default:
          setMenuState({ status: "failed", reason: result.reason });
      }
    });
  }, [cache, pathname, dismiss, toast, t, nav, summary.contextKey]);

  const openPanel = React.useCallback(() => {
    openGeneration.current += 1;
    openedPath.current = pathname;
    setOpen(true);
    setStep({ kind: "menu" });
    setRecent(readRecent(userKey));
    loadMenu();
  }, [pathname, userKey, loadMenu]);

  // "C" opens Create — the same path as the button, before any menu has ever loaded (§44, QC-03).
  React.useEffect(() => {
    if (!summary.canOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat) return;
      if (event.key.toLowerCase() !== "c" || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (typingOrModal(event.target)) return;
      event.preventDefault();
      if (!open) openPanel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [summary.canOpen, open, openPanel]);

  // Escape and a click outside close it (QC-06).
  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && close();
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !triggerRef.current?.contains(target)) close();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [open, close]);

  // Focus: the panel while it loads; then search or the first action — unless the person has already moved (QC-06).
  React.useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const focused = document.activeElement;
    const untouched = !focused || focused === document.body || focused === panel || focused === triggerRef.current;
    if (!untouched) return;
    if (step.kind === "menu" && menuState.status === "ready") {
      (searchRef.current ?? panel.querySelector<HTMLElement>("[data-quick-create-action]") ?? panel).focus();
    } else if (step.kind !== "menu") {
      panel.querySelector<HTMLElement>("select,button[type=submit]")?.focus();
    } else {
      panel.focus();
    }
  }, [open, step.kind, menuState.status]);

  const menu = menuState.status === "ready" ? menuState.menu : null;
  const actions = React.useMemo(() => menu?.actions ?? [], [menu]);
  const text = query.trim().toLowerCase();
  const matches = React.useCallback((action: QuickCreateActionDTO) => !text || [action.label, QUICK_CREATE_GROUP_LABELS[action.group], ...action.keywords].some((value) => value.toLowerCase().includes(text)), [text]);
  const recentActions = text ? [] : recent.map((key) => actions.find((action) => action.key === key)).filter((action): action is QuickCreateActionDTO => Boolean(action));
  const grouped = QUICK_CREATE_GROUPS.map((group) => ({ group, rows: actions.filter((action) => action.group === group && matches(action)).sort((a, b) => a.label.localeCompare(b.label)) })).filter((entry) => entry.rows.length);
  const ordered = [...recentActions, ...grouped.flatMap((entry) => entry.rows)];

  // Nothing this person may create here: no button and no shortcut (§150, §183, QC-03).
  if (!summary.canOpen) return null;

  const contextCompany = menu?.context?.company ?? null;

  /** A menu past its 30 s is not launched from; it is refreshed first (QC-07, Q08). */
  function freshOrStale(): boolean {
    if (menu && cache.isFresh(menuPathname(pathname), menu)) return true;
    if (menu) setMenuState({ status: "ready", menu, stale: true });
    return false;
  }

  async function readErrorBody(response: Response): Promise<{ code: string | null; message: string | null }> {
    const body = (await response.json().catch(() => null)) as ErrorBody;
    return { code: body?.error?.details?.code ?? body?.error?.code ?? null, message: body?.error?.message ?? null };
  }

  function releaseLaunch(id: number) {
    if (launchSeq.current !== id) return;
    launchBusy.current = false;
    setLaunching(null);
  }

  async function launch(action: QuickCreateActionDTO, chosenCompany: QuickCreateCompany | null, chosenProject: string | null) {
    if (launchBusy.current) return; // one POST per launch (Q22)
    // The unsaved-changes question, once for the whole flow (QC-10 step 2, NAV-05).
    if (!confirmWorkspaceNavigation()) return;
    const id = ++launchSeq.current;
    launchBusy.current = true;
    setLaunching(action.key);
    const generation = openGeneration.current;

    const { response, failure } = await fetchWithDeadline("/api/quick-create/launch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ actionKey: action.key, companyId: chosenCompany?.id ?? null, projectId: chosenProject, pathname }),
    });
    if (launchSeq.current !== id || generation !== openGeneration.current) return; // superseded (QC-12)

    if (failure || !response) {
      releaseLaunch(id);
      toast({ title: failure === "offline" ? t("quickCreate.offline") : t("quickCreate.unavailable"), tone: "danger" });
      return;
    }
    if (!response.ok) {
      const { code, message } = await readErrorBody(response);
      if (launchSeq.current !== id) return;
      releaseLaunch(id);
      cache.invalidate();
      if (response.status === 401) {
        dismiss();
        nav.refresh();
        return;
      }
      if (code === "QUICK_CREATE_PROJECT_INVALID" || code === "QUICK_CREATE_PROJECT_REQUIRED") {
        // Back to the project step, the stale choice cleared; the list is fetched again only when asked (QC-12).
        setProject("");
        setStepNotice(message ?? t("quickCreate.unavailable"));
        setProjects({ status: "failed", message: message ?? undefined });
        setStep({ kind: "project", action, company: chosenCompany });
        return;
      }
      if (code === "QUICK_CREATE_UNAVAILABLE") {
        setStep({ kind: "menu" });
        setMenuState({ status: "failed", reason: "unavailable", message: message ?? undefined });
        return;
      }
      // Permission or company refused: the old menu goes, the shell reads the context again (QC-12, Q16).
      toast({ title: message ?? t("quickCreate.unavailable"), tone: "danger" });
      dismiss();
      nav.refresh();
      return;
    }

    const body = (await response.json().catch(() => null)) as { data?: unknown } | null;
    if (launchSeq.current !== id) return;
    if (!isLaunchDTO(body?.data)) {
      releaseLaunch(id);
      toast({ title: t("quickCreate.unavailable"), tone: "danger" });
      return;
    }
    const data = body.data;
    rememberRecent(userKey, action.key);

    if (!data.switchWorkspace) {
      const ticket = feedback?.begin(data.href, "quick-create") ?? null;
      releaseLaunch(id);
      dismiss();
      nav.push(data.href, { source: "quick-create", ticket });
      return;
    }

    // A create page is a company page: enter the company, then open it there (§69, QC-10 step 6).
    const ticket = feedback?.begin(data.href, "quick-create", { ownsWorkspaceSwitch: true }) ?? null;
    const [currentPathname, search = ""] = data.href.split("?");
    ownSwitch.current = { launch: id, companyId: data.company.id };
    const switched = await requestWorkspaceSwitch(
      { scopeType: "COMPANY", companyId: data.company.id, currentPathname, currentSearch: search ? `?${search}` : "" },
      { timeoutMs: REQUEST_TIMEOUT_MS, confirmed: true, echoToThisTab: false },
    );
    if (ownSwitch.current?.launch === id) ownSwitch.current = null;
    if (launchSeq.current !== id) {
      // An unrelated, newer switch took over: this launch opens nothing (Q20).
      feedback?.store.settle(ticket);
      return;
    }
    if (!switched.ok) {
      feedback?.store.settle(ticket);
      releaseLaunch(id);
      if (switched.stale) return;
      toast({ title: `Could not open ${data.company.name}.`, tone: "danger" });
      if (switched.ambiguous) {
        // It may have switched on the server: load the canonical workspace before anything else (QC-11).
        cache.invalidate();
        dismiss();
        window.location.reload();
      }
      return;
    }
    const destination = switched.data.navigation.destination;
    releaseLaunch(id);
    dismiss();
    // The company is entered: the page is loaded again in it, the create form if it is a safe one.
    openInSwitchedWorkspace(isInternalAppPath(destination) ? destination : window.location.pathname + window.location.search);
  }

  async function loadProjects(action: QuickCreateActionDTO, chosenCompany: QuickCreateCompany | null) {
    cancelProjects();
    const controller = new AbortController();
    const id = projectsRequest.current.id;
    projectsRequest.current.controller = controller;
    const generation = openGeneration.current;
    setProjects({ status: "loading" });
    setProject("");
    const params = new URLSearchParams({ actionKey: action.key });
    if (chosenCompany) params.set("companyId", chosenCompany.id);
    const { response, failure } = await fetchWithDeadline(`/api/quick-create/projects?${params}`, { signal: controller.signal });
    // Company A's late answer never overwrites Company B's choices (QC-09, Q21).
    if (id !== projectsRequest.current.id || generation !== openGeneration.current) return;
    if (failure === "cancelled") return;
    if (failure || !response?.ok) {
      setProjects({ status: "failed", message: failure === "offline" ? t("quickCreate.offline") : undefined });
      return;
    }
    const body = (await response.json().catch(() => null)) as { data?: unknown } | null;
    if (id !== projectsRequest.current.id) return;
    setProjects(isProjectList(body?.data) ? { status: "ready", items: body.data } : { status: "failed" });
  }

  function choose(action: QuickCreateActionDTO) {
    if (!freshOrStale()) return;
    setStepNotice(null);
    if (action.companies) {
      // Group workspace: the company comes first; the page's own company is suggested when it is allowed (§16, §20).
      const suggested = contextCompany && action.companies.some((entry) => entry.id === contextCompany.id) ? contextCompany.id : action.companies.length === 1 ? action.companies[0].id : "";
      setCompany(suggested);
      setStep({ kind: "company", action });
      return;
    }
    if (action.needsProject) {
      setStep({ kind: "project", action, company: null });
      void loadProjects(action, null);
      return;
    }
    void launch(action, null, null);
  }

  function continueWithCompany(action: QuickCreateActionDTO) {
    const chosen = action.companies?.find((entry) => entry.id === company) ?? null;
    if (!chosen) {
      toast({ title: "Choose a Company to continue.", tone: "danger" });
      return;
    }
    const projectKnown = menu?.context?.project && menu.context.company.id === chosen.id;
    if (action.ownership === "PROJECT" && !projectKnown) {
      setStep({ kind: "project", action, company: chosen });
      void loadProjects(action, chosen);
      return;
    }
    void launch(action, chosen, null);
  }

  function backToMenu() {
    cancelProjects();
    setStepNotice(null);
    setStep({ kind: "menu" });
  }

  function onListKey(event: React.KeyboardEvent) {
    if (ordered.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => (index + 1) % ordered.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => (index - 1 + ordered.length) % ordered.length);
    } else if (event.key === "Enter" && event.target === searchRef.current) {
      event.preventDefault();
      const action = ordered[active];
      if (action) choose(action);
    }
  }

  let index = -1;
  const row = (action: QuickCreateActionDTO, section: string) => {
    index += 1;
    const position = index;
    const Icon = ICONS[action.icon] ?? Plus;
    return (
      <li key={`${section}:${action.key}`}>
        <button
          type="button"
          id={`${panelId}-${position}`}
          data-quick-create-action=""
          onClick={() => choose(action)}
          onMouseMove={() => setActive(position)}
          disabled={launching !== null}
          aria-busy={launching === action.key || undefined}
          className={cn("flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-table text-fg outline-none", position === active ? "bg-hover" : "hover:bg-hover", "focus-visible:ring-2 focus-visible:ring-accent")}
          data-testid={`quick-create-${action.key}`}
        >
          <Icon aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
          <span className="flex-1">{action.label}</span>
          {launching === action.key ? <Loader2 aria-hidden="true" className="size-4 animate-spin text-fg-subtle" /> : null}
        </button>
      </li>
    );
  };

  const banner = menu?.context ? (
    <p className="border-b border-line bg-surface-muted px-3 py-2 text-meta text-fg-muted" data-testid="quick-create-context">
      Creating in: <span className="font-medium text-fg">{[menu.context.company.name, menu.context.project?.name].filter(Boolean).join(" · ")}</span>
      {menu.context.recordType !== "project" ? <span className="block truncate">From {menu.context.label}</span> : null}
    </p>
  ) : menu?.workspace.company ? (
    <p className="border-b border-line bg-surface-muted px-3 py-2 text-meta text-fg-muted" data-testid="quick-create-context">
      Creating in: <span className="font-medium text-fg">{menu.workspace.company.name}</span>
    </p>
  ) : null;

  const retryButton = (
    <button type="button" onClick={loadMenu} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-3 text-table font-medium text-fg hover:bg-hover" data-testid="quick-create-retry">
      <RefreshCw aria-hidden="true" className="size-3.5" />
      {t("quickCreate.retry")}
    </button>
  );

  function menuBody() {
    if (menuState.status === "loading") {
      return (
        <div className="p-3" data-testid="quick-create-loading">
          <p role="status" className="px-1 pb-2 text-meta text-fg-muted">{t("quickCreate.loadingActions")}</p>
          <div aria-hidden="true" aria-busy="true" className="space-y-2">
            {Array.from({ length: 4 }, (_, row) => (
              <div key={row} className="flex items-center gap-2.5 px-1 py-1.5">
                <span className="nesto-skeleton size-4 shrink-0" />
                <span className={cn("nesto-skeleton h-3", row % 2 ? "w-28" : "w-40")} />
              </div>
            ))}
          </div>
        </div>
      );
    }
    if (menuState.status === "failed") {
      const offline = menuState.reason === "offline";
      return (
        <div role="alert" className="space-y-3 p-4 text-center" data-testid="quick-create-error" data-reason={menuState.reason}>
          {offline ? <WifiOff aria-hidden="true" className="mx-auto size-5 text-fg-subtle" /> : null}
          <p className="text-table text-fg">
            {menuState.reason === "unavailable" ? (menuState.message ?? t("quickCreate.unavailable")) : offline ? t("quickCreate.offline") : t("quickCreate.loadFailed")}
          </p>
          {retryButton}
        </div>
      );
    }
    if (menuState.menu.actions.length === 0) {
      return (
        <p role="status" className="px-4 py-5 text-center text-table text-fg-muted" data-testid="quick-create-empty">
          {t("quickCreate.noActions")}
        </p>
      );
    }
    return (
      <>
        {banner}
        {menuState.stale ? (
          <div role="alert" className="flex items-center justify-between gap-2 border-b border-line bg-surface-muted px-3 py-2 text-meta text-fg-muted" data-testid="quick-create-stale">
            <span>{t("quickCreate.stale")}</span>
            <button type="button" onClick={loadMenu} className="shrink-0 font-medium text-accent-strong hover:underline" data-testid="quick-create-refresh">
              {t("quickCreate.refreshActions")}
            </button>
          </div>
        ) : null}
        {actions.length > SEARCH_FROM ? (
          <div className="border-b border-line p-2">
            <label className="relative block">
              <span className="sr-only">Search actions</span>
              <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(0);
                }}
                placeholder="Search actions…"
                aria-controls={`${panelId}-list`}
                className="h-9 w-full rounded-md border border-line bg-surface pl-8 pr-2 text-table text-fg outline-none focus:border-accent"
              />
            </label>
          </div>
        ) : null}
        <div id={`${panelId}-list`} className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {recentActions.length ? (
            <section aria-label="Recent">
              <p className="px-2 pb-0.5 pt-1.5 text-micro font-semibold uppercase tracking-[0.1em] text-fg-subtle">Recent</p>
              <ul>{recentActions.map((action) => row(action, "recent"))}</ul>
            </section>
          ) : null}
          {grouped.map((entry) => (
            <section key={entry.group} aria-label={QUICK_CREATE_GROUP_LABELS[entry.group]}>
              <p className="px-2 pb-0.5 pt-2 text-micro font-semibold uppercase tracking-[0.1em] text-fg-subtle">{QUICK_CREATE_GROUP_LABELS[entry.group]}</p>
              <ul>{entry.rows.map((action) => row(action, entry.group))}</ul>
            </section>
          ))}
          {ordered.length === 0 ? <p className="px-2 py-3 text-table text-fg-muted">No create actions match “{query.trim()}”.</p> : null}
        </div>
      </>
    );
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? close() : openPanel())}
        aria-label={t("quickCreate.create")}
        aria-keyshortcuts="C"
        title="Create (C)"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-accent px-2.5 text-table font-medium text-accent-fg transition-colors hover:bg-accent-strong md:px-3"
        data-testid="quick-create-button"
      >
        <Plus aria-hidden="true" className="size-4" />
        <span className="hidden md:inline">{t("quickCreate.create")}</span>
      </button>

      {open ? (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-labelledby={headingId}
          tabIndex={-1}
          onKeyDown={onListKey}
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-xl border-t border-line bg-surface shadow-xl outline-none sm:absolute sm:inset-auto sm:right-0 sm:top-full sm:mt-2 sm:max-h-[min(34rem,80vh)] sm:w-80 sm:rounded-lg sm:border"
          data-testid="quick-create-panel"
          data-state={step.kind === "menu" ? menuState.status : step.kind}
        >
          <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5">
            {step.kind === "menu" ? (
              <h2 id={headingId} className="text-card font-semibold text-fg">{t("quickCreate.create")}</h2>
            ) : (
              <button type="button" id={headingId} onClick={backToMenu} className="inline-flex items-center gap-1.5 text-table font-medium text-fg">
                <ArrowLeft aria-hidden="true" className="size-4" />
                Create {step.action.label}
              </button>
            )}
            <button type="button" onClick={close} aria-label={t("quickCreate.close")} className="grid size-8 place-items-center rounded-md text-fg-muted hover:bg-hover">
              <X aria-hidden="true" className="size-4" />
            </button>
          </div>

          {step.kind === "menu" ? (
            menuBody()
          ) : step.kind === "company" ? (
            <form
              className="space-y-3 overflow-y-auto p-3"
              onSubmit={(event) => {
                event.preventDefault();
                continueWithCompany(step.action);
              }}
            >
              <label className="block space-y-1">
                <span className="text-meta font-medium text-fg">Company</span>
                <select value={company} onChange={(event) => setCompany(event.target.value)} className="h-9 w-full rounded-md border border-line bg-surface px-2 text-table text-fg outline-none focus:border-accent" data-testid="quick-create-company" required>
                  <option value="">Choose a company…</option>
                  {step.action.companies?.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-meta text-fg-muted">The {step.action.label.toLowerCase()} belongs to the company you choose. Opening it enters that company.</p>
              <button type="submit" disabled={!company || launching !== null} aria-busy={launching !== null || undefined} className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-accent text-table font-medium text-accent-fg disabled:opacity-60" data-testid="quick-create-continue">
                {launching ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
                Continue
              </button>
            </form>
          ) : (
            <form
              className="space-y-3 overflow-y-auto p-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (project) void launch(step.action, step.company, project);
              }}
            >
              {stepNotice ? (
                <p role="alert" className="rounded-md bg-surface-muted px-2.5 py-2 text-meta text-fg" data-testid="quick-create-step-notice">
                  {stepNotice}
                </p>
              ) : null}
              <label className="block space-y-1">
                <span className="text-meta font-medium text-fg">Project</span>
                {projects.status === "loading" ? (
                  <span role="status" className="flex h-9 items-center gap-2 text-table text-fg-muted" data-testid="quick-create-projects-loading">
                    <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                    {t("quickCreate.loadingProjects")}
                  </span>
                ) : projects.status === "failed" ? (
                  <span className="flex items-center justify-between gap-2 text-table text-fg-muted" data-testid="quick-create-projects-error">
                    <span>{projects.message ?? t("quickCreate.projectsFailed")}</span>
                    <button type="button" onClick={() => void loadProjects(step.action, step.company)} className="shrink-0 font-medium text-accent-strong hover:underline" data-testid="quick-create-projects-retry">
                      {t("quickCreate.retry")}
                    </button>
                  </span>
                ) : projects.items.length === 0 ? (
                  <span className="block text-table text-fg-muted">{t("quickCreate.noProjects")}</span>
                ) : (
                  <select value={project} onChange={(event) => setProject(event.target.value)} className="h-9 w-full rounded-md border border-line bg-surface px-2 text-table text-fg outline-none focus:border-accent" data-testid="quick-create-project" required>
                    <option value="">Choose a project…</option>
                    {projects.items.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name}
                      </option>
                    ))}
                  </select>
                )}
              </label>
              <button type="submit" disabled={!project || launching !== null} aria-busy={launching !== null || undefined} className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-accent text-table font-medium text-accent-fg disabled:opacity-60" data-testid="quick-create-continue">
                {launching ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
                Continue
              </button>
            </form>
          )}
        </div>
      ) : null}
    </div>
  );
}
