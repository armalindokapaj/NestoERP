"use client";

import { OPEN_QUICK_CREATE_EVENT } from "@/components/layout/mobile-bottom-nav";
import * as React from "react";
import { usePathname } from "next/navigation";
import { Plus, X } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { useCommonTranslations } from "@/components/i18n/common-text";
import { useFeedbackRouter, useNavigationFeedback } from "@/components/navigation/navigation-feedback";
import { useToast } from "@/components/ui/toast";
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
import { unsaved } from "@/lib/unsaved/coordinator";
import { openInSwitchedWorkspace, requestWorkspaceSwitch } from "@/lib/workspace/client";
import { PanelFailure, PanelLoading } from "@/components/layout/panels/panel-frame";
import { aimPointer, PanelPointer } from "@/components/ui/popup-pointer";
import { createPanelLoader, usePanelModule, usePanelOpen, useWarmIntent } from "@/lib/navigation/panel-host";

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

const RECENT_LIMIT = 4;

export type Step = { kind: "menu" } | { kind: "company"; action: QuickCreateActionDTO } | { kind: "project"; action: QuickCreateActionDTO; company: QuickCreateCompany | null };

export type MenuState =
  | { status: "loading" }
  | { status: "ready"; menu: QuickCreateMenuDTO; stale?: boolean }
  | { status: "failed"; reason: MenuFailure | "unavailable"; message?: string };

export type ProjectsState =
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

const body = createPanelLoader("quick_create", () => import("@/components/layout/panels/quick-create-panel-body"));

export function QuickCreate({ userKey, summary }: { userKey: string; summary: QuickCreateShellDTO }) {
  const nav = useFeedbackRouter();
  const feedback = useNavigationFeedback();
  const pathname = usePathname();
  const toast = useToast();
  const t = useTranslations("shell");
  const tc = useCommonTranslations();
  const panelId = React.useId();
  const headingId = `${panelId}-heading`;
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);
  /** The control that opened the panel when it was not this button: the phone bar's Create. */
  const opener = React.useRef<HTMLElement | null>(null);

  // One cache per signed-in user; a different user never inherits it (QC-08, Q13).
  const cache = React.useMemo(() => createMenuCache({ fetcher: fetchMenu }), [userKey]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => () => cache.invalidate(), [cache]);

  const [open, setOpen] = usePanelOpen("quick_create");
  const warm = useWarmIntent(body);
  const { state: code, retry: retryCode } = usePanelModule(body, open);
  const Body = code.status === "ready" ? code.module.QuickCreatePanelBody : null;
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
  }, [cache, cancelProjects, setOpen]);

  /** Closes by the person's own hand, handing focus back to the button that opened it. */
  const close = React.useCallback(() => {
    dismiss();
    const bar = opener.current;
    (bar?.isConnected && bar.getClientRects().length > 0 ? bar : triggerRef.current)?.focus({ preventScroll: true });
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
  }, [pathname, userKey, loadMenu, setOpen]);

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

  // The phone's bottom bar opens the same panel; its own trigger is hidden below md (MOB-02 §16).
  // Pressed again while the panel is open, the bar's button closes it, as this one does.
  React.useEffect(() => {
    if (!summary.canOpen) return;
    const onOpen = (event: Event) => {
      // The bar's button, so the panel's pointer can aim at it.
      opener.current = (event as CustomEvent<{ opener?: HTMLElement }>).detail?.opener ?? null;
      if (open) close();
      else openPanel();
    };
    window.addEventListener(OPEN_QUICK_CREATE_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_QUICK_CREATE_EVENT, onOpen);
  }, [summary.canOpen, open, openPanel, close]);

  // On a touch layout the panel carries a pointer: it is aimed at the button that was pressed.
  React.useLayoutEffect(() => {
    if (!open) return;
    const aim = () => aimPointer(panelRef.current, opener.current?.isConnected && opener.current.getClientRects().length > 0 ? opener.current : triggerRef.current);
    aim();
    window.addEventListener("resize", aim);
    return () => window.removeEventListener("resize", aim);
  }, [open]);

  // Escape and a click outside close it (QC-06).
  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && close();
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      // The bar's own Create button closes it too, by its own handler: a press on it is not "outside".
      if (!panelRef.current?.contains(target) && !triggerRef.current?.contains(target) && !opener.current?.contains(target)) close();
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
    const bar = opener.current?.isConnected && opener.current.getClientRects().length > 0 ? opener.current : null;
    const untouched = !focused || focused === document.body || focused === panel || focused === triggerRef.current || focused === bar;
    if (!untouched) return;
    if (step.kind === "menu" && menuState.status === "ready") {
      // Opened from the phone's bar, no field is focused for the person: a focused field stands for an open
      // keyboard there, and the bar — with the button this panel points at — steps aside for it (globals.css).
      (bar ? panel : (searchRef.current ?? panel.querySelector<HTMLElement>("[data-quick-create-action]") ?? panel)).focus({ preventScroll: true });
    } else if (step.kind !== "menu") {
      panel.querySelector<HTMLElement>("select,button[type=submit]")?.focus();
    } else {
      panel.focus();
    }
  }, [open, step.kind, menuState.status]);

  const menu = menuState.status === "ready" ? menuState.menu : null;
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
    // The unsaved-changes question, once for the whole flow (QC-10 step 2,
    // NAV-05): asked for leaving this page; a company switch later in the flow
    // does not ask again about what was answered here (AUD-03 §4).
    const approval = await unsaved.requestDeparture({ kind: "navigate", href: pathname });
    if (!approval) return;
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
      if (!approval.run(() => nav.push(data.href, { source: "quick-create", ticket }))) feedback?.store.settle(ticket);
      return;
    }

    // A create page is a company page: enter the company, then open it there (§69, QC-10 step 6).
    const ticket = feedback?.begin(data.href, "quick-create", { ownsWorkspaceSwitch: true }) ?? null;
    const [currentPathname, search = ""] = data.href.split("?");
    ownSwitch.current = { launch: id, companyId: data.company.id };
    const switched = await requestWorkspaceSwitch(
      { scopeType: "COMPANY", companyId: data.company.id, currentPathname, currentSearch: search ? `?${search}` : "" },
      { timeoutMs: REQUEST_TIMEOUT_MS, prior: approval, targetName: data.company.name, echoToThisTab: false },
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
      if (switched.stale || switched.cancelled) return;
      toast({ title: tc("shell.openFailed", { name: data.company.name }), tone: "danger" });
      if (switched.ambiguous) {
        // It may have switched on the server: load the canonical workspace
        // before anything else (QC-11). The person already let the page go.
        cache.invalidate();
        dismiss();
        unsaved.forceLeave();
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
      toast({ title: tc("shell.companyRequired"), tone: "danger" });
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

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? close() : openPanel())}
        aria-label={t("quickCreate.create")}
        aria-keyshortcuts="C"
        title={tc("shell.createShortcut")}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        className="inline-flex h-9 shrink-0 items-center max-md:hidden justify-center gap-1.5 rounded-md bg-accent px-2.5 text-table font-medium text-accent-fg transition-colors hover:bg-accent-strong md:px-3 touch:h-11 touch:min-w-11"
        data-testid="quick-create-button"
        {...warm}
      >
        <Plus aria-hidden="true" className="size-4" />
        <span className="hidden md:inline">{t("quickCreate.create")}</span>
      </button>

      {/* From md up the panel opens to the right of the button — never back under the sidebar — and starts on
          the breadcrumb bar's top line, like every panel opened from the top bar (lib/layout/topbar-line.ts).
          The wrapper is centred in the bar above its 1px rule, so half its height plus half the bar's, and
          half that rule, is the bar's lower edge.
          Below md the button is the bottom bar's Create: the panel is a bubble of glass floating above the
          bar, its pointer on that button. On a touch tablet it hangs under the top bar's button the same way. */}
      {open ? (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-labelledby={headingId}
          tabIndex={-1}
          className="nesto-popup-glass fixed inset-x-3 bottom-[calc(var(--nesto-safe-bottom)+7.25rem)] z-50 mx-auto flex max-h-[min(70dvh,calc(100dvh-11rem))] max-w-md flex-col rounded-lg border border-line bg-surface shadow-xl outline-none md:absolute md:inset-auto md:left-0 md:top-[calc(50%+var(--nesto-shell-header-h)/2+0.5px)] md:mx-0 md:max-h-[calc(100dvh-var(--nesto-shell-header-h)-1.5rem)] md:w-80 md:max-w-none md:touch:mt-3"
          data-testid="quick-create-panel"
          data-state={step.kind === "menu" ? menuState.status : step.kind}
        >
          <PanelPointer side="below" className="md:hidden!" />
          <PanelPointer side="above" className="max-md:hidden!" />
          {Body ? (
            <Body
              panelId={panelId}
              headingId={headingId}
              step={step}
              menuState={menuState}
              recent={recent}
              query={query}
              setQuery={setQuery}
              active={active}
              setActive={setActive}
              launching={launching}
              company={company}
              setCompany={setCompany}
              project={project}
              setProject={setProject}
              projects={projects}
              stepNotice={stepNotice}
              searchRef={searchRef}
              choose={choose}
              continueWithCompany={continueWithCompany}
              backToMenu={backToMenu}
              launch={launch}
              loadProjects={loadProjects}
              loadMenu={loadMenu}
              close={close}
            />
          ) : (
            <>
              <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5">
                <h2 id={headingId} className="text-card font-semibold text-fg">{t("quickCreate.create")}</h2>
                <button type="button" onClick={close} aria-label={t("quickCreate.close")} className="grid size-8 place-items-center rounded-md text-fg-muted hover:bg-hover touch:size-11">
                  <X aria-hidden="true" className="size-4" />
                </button>
              </div>
              {code.status === "failed" ? <PanelFailure kind="code" reloadAdvised={code.reloadAdvised} onRetry={retryCode} onClose={close} /> : <PanelLoading label={t("quickCreate.loadingActions")} />}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
