"use client";

import * as React from "react";
import { ArrowLeft, Building2, ClipboardCheck, FileText, FolderKanban, HardHat, Loader2, NotebookPen, Plus, Presentation, ReceiptText, RefreshCw, Search, ShoppingCart, SquareCheckBig, Target, TriangleAlert, Wallet, WifiOff, X, type LucideIcon } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { useCommonTranslations } from "@/components/i18n/common-text";
import { QUICK_CREATE_GROUP_LABELS, QUICK_CREATE_GROUPS } from "@/config/quick-create";
import type { QuickCreateActionDTO, QuickCreateCompany } from "@/lib/modules/quick-create/quick-create.service";
import { cn } from "@/lib/utils/cn";
import type { MenuState, ProjectsState, Step } from "@/components/layout/quick-create";

/**
 * `+ Create`'s menu, company and project steps, loaded when the panel first
 * opens (Quick Create PRD §13-§20; NAV-03 PANEL-01, PANEL-05).
 *
 * Presentation only. The menu read, its 30 s cache, the launch ticket and
 * every generation check stay in the shell's QuickCreate, which started the
 * menu read together with this chunk.
 */

const ICONS: Record<string, LucideIcon> = { SquareCheckBig, Presentation, FileText, FolderKanban, NotebookPen, Building2, Target, ReceiptText, Wallet, ShoppingCart, ClipboardCheck, HardHat, TriangleAlert };
const SEARCH_FROM = 8;

export type QuickCreateBodyProps = {
  panelId: string;
  headingId: string;
  step: Step;
  menuState: MenuState;
  recent: string[];
  query: string;
  setQuery: (query: string) => void;
  active: number;
  setActive: React.Dispatch<React.SetStateAction<number>>;
  launching: string | null;
  company: string;
  setCompany: (company: string) => void;
  project: string;
  setProject: (project: string) => void;
  projects: ProjectsState;
  stepNotice: string | null;
  searchRef: React.RefObject<HTMLInputElement | null>;
  choose: (action: QuickCreateActionDTO) => void;
  continueWithCompany: (action: QuickCreateActionDTO) => void;
  backToMenu: () => void;
  launch: (action: QuickCreateActionDTO, company: QuickCreateCompany | null, project: string | null) => Promise<void>;
  loadProjects: (action: QuickCreateActionDTO, company: QuickCreateCompany | null) => Promise<void>;
  loadMenu: () => void;
  close: () => void;
};

export function QuickCreatePanelBody(props: QuickCreateBodyProps) {
  const { panelId, headingId, step, menuState, recent, query, setQuery, active, setActive, launching, company, setCompany, project, setProject, projects, stepNotice, searchRef, choose, continueWithCompany, backToMenu, launch, loadProjects, loadMenu, close } = props;
  const t = useTranslations("shell");
  const tc = useCommonTranslations();
  const menu = menuState.status === "ready" ? menuState.menu : null;
  const actions = React.useMemo(() => menu?.actions ?? [], [menu]);
  const text = query.trim().toLowerCase();
  const matches = React.useCallback((action: QuickCreateActionDTO) => !text || [action.label, QUICK_CREATE_GROUP_LABELS[action.group], ...action.keywords].some((value) => value.toLowerCase().includes(text)), [text]);
  const recentActions = text ? [] : recent.map((key) => actions.find((action) => action.key === key)).filter((action): action is QuickCreateActionDTO => Boolean(action));
  const grouped = QUICK_CREATE_GROUPS.map((group) => ({ group, rows: actions.filter((action) => action.group === group && matches(action)).sort((a, b) => a.label.localeCompare(b.label)) })).filter((entry) => entry.rows.length);
  const ordered = [...recentActions, ...grouped.flatMap((entry) => entry.rows)];

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
          className={cn("flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-table text-fg outline-none touch:min-h-11", position === active ? "bg-hover" : "hover:bg-hover", "focus-visible:ring-2 focus-visible:ring-accent")}
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
    <button type="button" onClick={loadMenu} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-3 text-table font-medium text-fg hover:bg-hover touch:h-11" data-testid="quick-create-retry">
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
                placeholder={tc("shell.searchActions")}
                aria-controls={`${panelId}-list`}
                className="h-9 w-full rounded-md border border-control bg-surface pl-8 pr-2 text-table text-fg outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-ring touch:h-11"
              />
            </label>
          </div>
        ) : null}
        <div id={`${panelId}-list`} className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {recentActions.length ? (
            <section aria-label={tc("shell.recent")}>
              <p className="px-2 pb-0.5 pt-1.5 text-micro font-semibold uppercase tracking-[0.1em] text-fg-subtle">{tc("shell.recent")}</p>
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
    <div className="flex min-h-0 flex-1 flex-col" onKeyDown={onListKey}>
          <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5">
            {step.kind === "menu" ? (
              <h2 id={headingId} className="text-card font-semibold text-fg">{t("quickCreate.create")}</h2>
            ) : (
              <button type="button" id={headingId} onClick={backToMenu} className="inline-flex items-center gap-1.5 text-table font-medium text-fg">
                <ArrowLeft aria-hidden="true" className="size-4" />
                Create {step.action.label}
              </button>
            )}
            <button type="button" onClick={close} aria-label={t("quickCreate.close")} className="grid size-8 place-items-center rounded-md text-fg-muted hover:bg-hover touch:size-11">
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
                <span className="text-meta font-medium text-fg">{tc("shell.company")}</span>
                <select value={company} onChange={(event) => setCompany(event.target.value)} className="h-9 w-full rounded-md border border-control bg-surface px-2 text-table text-fg outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-ring touch:h-11" data-testid="quick-create-company" required>
                  <option value="">{tc("shell.chooseCompany")}</option>
                  {step.action.companies?.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-meta text-fg-muted">The {step.action.label.toLowerCase()} belongs to the company you choose. Opening it enters that company.</p>
              <button type="submit" disabled={!company || launching !== null} aria-busy={launching !== null || undefined} className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-accent touch:h-11 text-table font-medium text-accent-fg disabled:opacity-60" data-testid="quick-create-continue">
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
                  <select value={project} onChange={(event) => setProject(event.target.value)} className="h-9 w-full rounded-md border border-control bg-surface px-2 text-table text-fg outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-ring touch:h-11" data-testid="quick-create-project" required>
                    <option value="">{tc("shell.chooseProject")}</option>
                    {projects.items.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name}
                      </option>
                    ))}
                  </select>
                )}
              </label>
              <button type="submit" disabled={!project || launching !== null} aria-busy={launching !== null || undefined} className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-accent touch:h-11 text-table font-medium text-accent-fg disabled:opacity-60" data-testid="quick-create-continue">
                {launching ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
                Continue
              </button>
            </form>
          )}
    </div>
  );
}
