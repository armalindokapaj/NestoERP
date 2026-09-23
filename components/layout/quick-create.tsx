"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, Building2, ClipboardCheck, FileText, FolderKanban, HardHat, Loader2, NotebookPen, Plus, Presentation, ReceiptText, Search, ShoppingCart, SquareCheckBig, Target, Wallet, X, type LucideIcon } from "lucide-react";

import { useToast } from "@/components/ui/toast";
import { QUICK_CREATE_GROUP_LABELS, QUICK_CREATE_GROUPS } from "@/config/quick-create";
import { WORKSPACE_CHANGED } from "@/config/workspace";
import type { QuickCreateActionDTO, QuickCreateCompany, QuickCreateLaunchDTO, QuickCreateMenuDTO } from "@/lib/modules/quick-create/quick-create.service";
import { requestWorkspaceSwitch } from "@/lib/workspace/client";
import { cn } from "@/lib/utils/cn";

/**
 * `+ Create` (Quick Create PRD §4-§7, §13-§20, §34, §37-§50, §69-§71, §129, §150-§156).
 *
 * The menu is the server's answer — only actions the person may create here —
 * and each one opens the module's own create page. In a company workspace the
 * company is already known; in the Group workspace the person chooses one of
 * the companies the server listed, and a flow that lives under a project asks
 * for the project. Launching asks the server again, so a menu drawn before a
 * permission changed cannot open anything (§95).
 */

const ICONS: Record<string, LucideIcon> = { SquareCheckBig, Presentation, FileText, FolderKanban, NotebookPen, Building2, Target, ReceiptText, Wallet, ShoppingCart, ClipboardCheck, HardHat };
const RECENT_LIMIT = 4;
const SEARCH_FROM = 8;

type Step = { kind: "menu" } | { kind: "company"; action: QuickCreateActionDTO } | { kind: "project"; action: QuickCreateActionDTO; company: QuickCreateCompany | null };

function recentKey(userKey: string) {
  return `nesto-quick-create-recent:${userKey}`;
}

/** Recent actions are action keys only, never record details (§38). */
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

async function readError(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
  return body?.error?.message ?? fallback;
}

export function QuickCreate({ userKey }: { userKey: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const panelId = React.useId();
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);

  const [menu, setMenu] = React.useState<QuickCreateMenuDTO | null>(null);
  const [open, setOpen] = React.useState(false);
  const [step, setStep] = React.useState<Step>({ kind: "menu" });
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const [recent, setRecent] = React.useState<string[]>([]);
  const [launching, setLaunching] = React.useState<string | null>(null);
  const [company, setCompany] = React.useState<string>("");
  const [projects, setProjects] = React.useState<Array<{ id: string; name: string }> | null>(null);
  const [project, setProject] = React.useState("");

  // The menu follows the page: its record is the context, and a workspace switch reloads the shell (§129, §133).
  const load = React.useCallback(async () => {
    try {
      const response = await fetch(`/api/quick-create/actions?pathname=${encodeURIComponent(pathname || "/")}`);
      if (response.ok) setMenu(((await response.json()) as { data: QuickCreateMenuDTO }).data);
    } catch {
      // The button keeps its last answer.
    }
  }, [pathname]);

  React.useEffect(() => void load(), [load]);
  // "C" opens Create — only when nothing that takes typing has focus, and never with a modifier (§44).
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "c" || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.closest("[role=dialog]"))) return;
      if (!menu?.actions.length) return;
      event.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);
  // Another workspace offers other actions and companies (§134, §189).
  React.useEffect(() => {
    const onChange = () => void load();
    window.addEventListener(WORKSPACE_CHANGED, onChange);
    return () => window.removeEventListener(WORKSPACE_CHANGED, onChange);
  }, [load]);
  React.useEffect(() => setRecent(readRecent(userKey)), [userKey, open]);

  const close = React.useCallback(() => {
    setOpen(false);
    setStep({ kind: "menu" });
    setQuery("");
    setActive(0);
    setProjects(null);
    setProject("");
    triggerRef.current?.focus();
  }, []);

  React.useEffect(() => {
    if (!open) return;
    (searchRef.current ?? panelRef.current?.querySelector<HTMLElement>("button,select"))?.focus();
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
  }, [open, step.kind, close]);

  const actions = React.useMemo(() => menu?.actions ?? [], [menu]);
  const text = query.trim().toLowerCase();
  const matches = React.useCallback((action: QuickCreateActionDTO) => !text || [action.label, QUICK_CREATE_GROUP_LABELS[action.group], ...action.keywords].some((value) => value.toLowerCase().includes(text)), [text]);
  const recentActions = text ? [] : recent.map((key) => actions.find((action) => action.key === key)).filter((action): action is QuickCreateActionDTO => Boolean(action));
  const grouped = QUICK_CREATE_GROUPS.map((group) => ({ group, rows: actions.filter((action) => action.group === group && matches(action)).sort((a, b) => a.label.localeCompare(b.label)) })).filter((entry) => entry.rows.length);
  const ordered = [...recentActions, ...grouped.flatMap((entry) => entry.rows)];

  // Nothing to create, nothing to show (§150, §183).
  if (!menu || actions.length === 0) return null;

  const contextCompany = menu.context?.company ?? null;

  async function launch(action: QuickCreateActionDTO, chosenCompany: QuickCreateCompany | null, chosenProject: string | null) {
    setLaunching(action.key);
    try {
      const response = await fetch("/api/quick-create/launch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actionKey: action.key, companyId: chosenCompany?.id ?? null, projectId: chosenProject, pathname }),
      });
      if (!response.ok) {
        toast({ title: await readError(response, "This create action is currently unavailable."), tone: "danger" });
        void load();
        return;
      }
      const data = ((await response.json()) as { data: QuickCreateLaunchDTO }).data;
      rememberRecent(userKey, action.key);
      if (data.switchWorkspace) {
        // A create page is a company page: enter the company, then open it there (§69).
        const [currentPathname, search = ""] = data.href.split("?");
        const switched = await requestWorkspaceSwitch({ scopeType: "COMPANY", companyId: data.company.id, currentPathname, currentSearch: search ? `?${search}` : "" });
        if (!switched.ok) {
          if (!switched.stale) toast({ title: `Could not open ${data.company.name}.`, tone: "danger" });
          return;
        }
        close();
        router.push(switched.data.navigation.destination);
        return;
      }
      close();
      router.push(data.href);
    } catch {
      toast({ title: "This create action is currently unavailable.", tone: "danger" });
    } finally {
      setLaunching(null);
    }
  }

  async function loadProjects(action: QuickCreateActionDTO, chosenCompany: QuickCreateCompany | null) {
    setProjects(null);
    setProject("");
    const params = new URLSearchParams({ actionKey: action.key });
    if (chosenCompany) params.set("companyId", chosenCompany.id);
    const response = await fetch(`/api/quick-create/projects?${params}`).catch(() => null);
    setProjects(response?.ok ? ((await response.json()) as { data: Array<{ id: string; name: string }> }).data : []);
  }

  function choose(action: QuickCreateActionDTO) {
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
      <li key={`${section}:${action.key}`} role="none">
        <button
          type="button"
          role="menuitem"
          id={`${panelId}-${position}`}
          onClick={() => choose(action)}
          onMouseMove={() => setActive(position)}
          disabled={launching !== null}
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

  const banner = menu.context ? (
    <p className="border-b border-line bg-surface-muted px-3 py-2 text-meta text-fg-muted" data-testid="quick-create-context">
      Creating in: <span className="font-medium text-fg">{[menu.context.company.name, menu.context.project?.name].filter(Boolean).join(" · ")}</span>
      {menu.context.recordType !== "project" ? <span className="block truncate">From {menu.context.label}</span> : null}
    </p>
  ) : menu.workspace.company ? (
    <p className="border-b border-line bg-surface-muted px-3 py-2 text-meta text-fg-muted" data-testid="quick-create-context">
      Creating in: <span className="font-medium text-fg">{menu.workspace.company.name}</span>
    </p>
  ) : null;

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-label="Create"
        aria-keyshortcuts="C"
        title="Create (C)"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-accent px-2.5 text-table font-medium text-accent-fg transition-colors hover:bg-accent-strong md:px-3"
        data-testid="quick-create-button"
      >
        <Plus aria-hidden="true" className="size-4" />
        <span className="hidden md:inline">Create</span>
      </button>

      {open ? (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label="Create"
          onKeyDown={onListKey}
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-xl border-t border-line bg-surface shadow-xl sm:absolute sm:inset-auto sm:right-0 sm:top-full sm:mt-2 sm:max-h-[min(34rem,80vh)] sm:w-80 sm:rounded-lg sm:border"
          data-testid="quick-create-panel"
        >
          <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5">
            {step.kind === "menu" ? (
              <h2 className="text-card font-semibold text-fg">Create</h2>
            ) : (
              <button type="button" onClick={() => setStep({ kind: "menu" })} className="inline-flex items-center gap-1.5 text-table font-medium text-fg">
                <ArrowLeft aria-hidden="true" className="size-4" />
                Create {step.action.label}
              </button>
            )}
            <button type="button" onClick={close} aria-label="Close" className="grid size-8 place-items-center rounded-md text-fg-muted hover:bg-hover">
              <X aria-hidden="true" className="size-4" />
            </button>
          </div>

          {step.kind === "menu" ? (
            <>
              {banner}
              {actions.length > SEARCH_FROM ? (
                <div className="border-b border-line p-2">
                  <label className="relative block">
                    <span className="sr-only">Search actions</span>
                    <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
                    <input
                      ref={searchRef}
                      value={query}
                      onChange={(event) => {
                        setQuery(event.target.value);
                        setActive(0);
                      }}
                      placeholder="Search actions…"
                      role="combobox"
                      aria-expanded="true"
                      aria-controls={`${panelId}-list`}
                      aria-activedescendant={ordered.length ? `${panelId}-${active}` : undefined}
                      className="h-9 w-full rounded-md border border-line bg-surface pl-8 pr-2 text-table text-fg outline-none focus:border-accent"
                    />
                  </label>
                </div>
              ) : null}
              <div id={`${panelId}-list`} role="menu" aria-label="Create" className="min-h-0 flex-1 overflow-y-auto p-1.5">
                {recentActions.length ? (
                  <section aria-label="Recent">
                    <p className="px-2 pb-0.5 pt-1.5 text-micro font-semibold uppercase tracking-[0.1em] text-fg-subtle">Recent</p>
                    <ul role="none">{recentActions.map((action) => row(action, "recent"))}</ul>
                  </section>
                ) : null}
                {grouped.map((entry) => (
                  <section key={entry.group} aria-label={QUICK_CREATE_GROUP_LABELS[entry.group]}>
                    <p className="px-2 pb-0.5 pt-2 text-micro font-semibold uppercase tracking-[0.1em] text-fg-subtle">{QUICK_CREATE_GROUP_LABELS[entry.group]}</p>
                    <ul role="none">{entry.rows.map((action) => row(action, entry.group))}</ul>
                  </section>
                ))}
                {ordered.length === 0 ? <p className="px-2 py-3 text-table text-fg-muted">No create actions match “{query.trim()}”.</p> : null}
              </div>
            </>
          ) : step.kind === "company" ? (
            <form
              className="space-y-3 p-3"
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
              <button type="submit" disabled={!company || launching !== null} className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-accent text-table font-medium text-accent-fg disabled:opacity-60" data-testid="quick-create-continue">
                {launching ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
                Continue
              </button>
            </form>
          ) : (
            <form
              className="space-y-3 p-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (project) void launch(step.action, step.company, project);
              }}
            >
              <label className="block space-y-1">
                <span className="text-meta font-medium text-fg">Project</span>
                {projects === null ? (
                  <span className="flex h-9 items-center gap-2 text-table text-fg-muted">
                    <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                    Loading projects…
                  </span>
                ) : projects.length === 0 ? (
                  <span className="block text-table text-fg-muted">No projects you can create this in.</span>
                ) : (
                  <select value={project} onChange={(event) => setProject(event.target.value)} className="h-9 w-full rounded-md border border-line bg-surface px-2 text-table text-fg outline-none focus:border-accent" data-testid="quick-create-project" required>
                    <option value="">Choose a project…</option>
                    {projects.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name}
                      </option>
                    ))}
                  </select>
                )}
              </label>
              <button type="submit" disabled={!project || launching !== null} className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-accent text-table font-medium text-accent-fg disabled:opacity-60" data-testid="quick-create-continue">
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
