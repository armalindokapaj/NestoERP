"use client";

import * as React from "react";
import { useTranslations } from "@/components/i18n/i18n-provider";
import { ArrowDown, ArrowUp, CalendarRange, Flag, GanttChart, LayoutDashboard, ListTree, Lock, MoreHorizontal, Network, Plus, Search, SlidersHorizontal, Unlock } from "lucide-react";

import { selectClass } from "@/components/forms/record-form";
import { ScrollRegion } from "@/components/ui/scroll-region";
import { useIsBelow } from "@/components/ui/use-breakpoint";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { addLocalDays, dateLabel, shortDateLabel } from "@/lib/modules/project-planning/planning.dates";
import { PLANNING_TEMPLATES } from "@/lib/modules/project-planning/planning.template-catalog";
import { MILESTONE_STATUSES, type MilestoneStatus, type MilestoneSummaryDTO, type Option, type ProjectPlanningOverviewDTO } from "@/lib/modules/project-planning/planning.types";
import { cn } from "@/lib/utils/cn";
import { MilestoneDrawer } from "./milestone-drawer";
import { useValuesEditor } from "./use-values-editor";
import { EMPTY_MILESTONE, EMPTY_PHASE, MilestoneFormDialog, PhaseFormDialog } from "./milestone-form";
import { MilestoneList, type DrawerPanel, type SortKey } from "./milestone-list";
import { failureMessage, planningApi } from "./planning-api";
import { defaultZoom, PlanningTimeline, type TimelineZoom } from "./planning-timeline";
import { Kpi, MilestoneStatusBadge, OwnerName, ProgressBar, Variance } from "./planning-ui";

/**
 * The planning workspace (PRD #44 §6, §8, §96, §104, §116, §120, §124-§128,
 * §236-§243, §268).
 *
 * One project's plan in four views — Overview, Timeline, Milestones and
 * Dependencies — over the same data, filtered the same way. The URL carries
 * the view and the open milestone, so a calendar event or a notification can
 * open the drawer directly. A phone gets milestone cards first; the timeline
 * waits for a wider screen.
 */

type View = "overview" | "timeline" | "milestones" | "dependencies";
type Quick = "upcoming" | "delayed" | "at_risk" | "critical" | "completed";

const VIEWS: Array<{ key: View; icon: typeof Flag }> = [
  { key: "overview", icon: LayoutDashboard },
  { key: "timeline", icon: GanttChart },
  { key: "milestones", icon: ListTree },
  { key: "dependencies", icon: Network },
];

const QUICK: Array<{ key: Quick }> = [{ key: "upcoming" }, { key: "delayed" }, { key: "at_risk" }, { key: "critical" }, { key: "completed" }];

function matchesQuick(milestone: MilestoneSummaryDTO, quick: Quick, today: string) {
  const closed = milestone.status === "COMPLETED" || milestone.status === "CANCELLED";
  switch (quick) {
    case "upcoming":
      return !closed && Boolean(milestone.displayDate) && milestone.displayDate! >= today && milestone.displayDate! <= addLocalDays(today, 30);
    case "delayed":
      return !closed && (milestone.delayed || milestone.status === "DELAYED");
    case "at_risk":
      return milestone.status === "AT_RISK";
    case "critical":
      return milestone.critical && milestone.status !== "CANCELLED";
    case "completed":
      return milestone.status === "COMPLETED";
  }
}

function writeUrl(params: Record<string, string | null>) {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  window.history.replaceState(window.history.state, "", url.toString());
}

export function PlanningShell({ initial, initialView, initialMilestone, initialQuick }: { initial: ProjectPlanningOverviewDTO; initialView: View | null; initialMilestone: string | null; initialQuick: Quick | null }) {
  const t = useTranslations("projects");
  const toast = useToast();
  // One shared breakpoint store (AUD-04 §4, SP-15); false until hydrated, as before.
  const below = useIsBelow("md");
  const mobile = below === true;
  const wide = below === false;
  // Milestone cards run up to lg: a portrait tablet reads cards, not a 960px table (AUD-04 §5, MW-05).
  const cards = useIsBelow("lg") === true;
  const [plan, setPlan] = React.useState(initial);
  const [view, setView] = React.useState<View>(initialView ?? "overview");
  const [drawer, setDrawer] = React.useState<{ id: string | null; panel: DrawerPanel }>({ id: initialMilestone, panel: null });
  const [search, setSearch] = React.useState("");
  const [quick, setQuick] = React.useState<Quick | null>(initialQuick);
  const [phaseFilter, setPhaseFilter] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<MilestoneStatus | "">("");
  const [ownerFilter, setOwnerFilter] = React.useState("");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [sort, setSort] = React.useState<SortKey>("phase");
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const [zoom, setZoom] = React.useState<TimelineZoom>(() => defaultZoom(initial.project.startDate, initial.project.endDate));
  const [creating, setCreating] = React.useState<"milestone" | "phase" | null>(null);
  const [phaseOpen, setPhaseOpen] = React.useState<string | null>(null);
  const [template, setTemplate] = React.useState<string | null>(null);
  const [copyOpen, setCopyOpen] = React.useState(false);
  const [copyChoices, setCopyChoices] = React.useState<Option[] | null>(null);
  const [copySource, setCopySource] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const caps = plan.capabilities;
  const empty = !plan.phases.length && !plan.milestones.length;

  React.useEffect(() => setPlan(initial), [initial]);

  const refresh = React.useCallback(async () => {
    try {
      setPlan(await planningApi<ProjectPlanningOverviewDTO>(`/api/projects/${plan.projectId}/planning`));
    } catch (error) {
      toast({ title: failureMessage(error, t("planning.refreshFailed")), tone: "danger" });
    }
  }, [plan.projectId, toast, t]);

  function chooseView(next: View) {
    setView(next);
    writeUrl({ view: next === "overview" ? null : next });
  }

  function open(id: string, panel: DrawerPanel = null) {
    setDrawer({ id, panel });
    writeUrl({ milestone: id });
  }

  function close() {
    setDrawer({ id: null, panel: null });
    writeUrl({ milestone: null });
  }

  // Phones start on the cards; the timeline needs width (§116, §120).
  React.useEffect(() => {
    if (mobile && view === "timeline") setView("milestones");
  }, [mobile, view]);

  const filtered = React.useMemo(() => {
    const term = search.trim().toLowerCase();
    return plan.milestones.filter(
      (milestone) =>
        (!term || milestone.name.toLowerCase().includes(term) || (milestone.description ?? "").toLowerCase().includes(term)) &&
        (!quick || matchesQuick(milestone, quick, plan.today)) &&
        (!phaseFilter || (phaseFilter === "none" ? !milestone.phaseId : milestone.phaseId === phaseFilter)) &&
        (!statusFilter || milestone.status === statusFilter) &&
        (!ownerFilter || milestone.owner?.memberId === ownerFilter) &&
        (!from || (milestone.displayDate !== null && milestone.displayDate >= from)) &&
        (!to || (milestone.displayDate !== null && milestone.displayDate <= to)),
    );
  }, [plan.milestones, plan.today, search, quick, phaseFilter, statusFilter, ownerFilter, from, to]);
  const filtering = Boolean(search || quick || phaseFilter || statusFilter || ownerFilter || from || to);
  const owners = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const milestone of plan.milestones) if (milestone.owner) map.set(milestone.owner.memberId, milestone.owner.name);
    return [...map.entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [plan.milestones]);
  const phaseOptions = plan.phases.map((phase) => ({ id: phase.id, label: phase.name }));
  const { metrics } = plan;

  async function movePhase(index: number, direction: -1 | 1) {
    const ids = plan.phases.map((phase) => phase.id);
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    setPlan((current) => ({ ...current, phases: ids.map((id, order) => ({ ...current.phases.find((phase) => phase.id === id)!, sortOrder: order + 1 })) }));
    try {
      await planningApi(`/api/projects/${plan.projectId}/phases/reorder`, { body: { ids } });
    } catch (error) {
      toast({ title: failureMessage(error, t("planning.reorderFailed")), tone: "danger" });
    }
    await refresh();
  }

  async function run(action: () => Promise<unknown>, success: string) {
    setPending(true);
    try {
      await action();
      toast({ title: success, tone: "success" });
      await refresh();
      return true;
    } catch (error) {
      toast({ title: failureMessage(error), tone: "danger" });
      return false;
    } finally {
      setPending(false);
    }
  }

  const dragged = React.useRef<number | null>(null);
  const upcoming = plan.milestones.filter((milestone) => milestone.status !== "COMPLETED" && milestone.status !== "CANCELLED" && milestone.displayDate && milestone.displayDate >= plan.today).sort((a, b) => a.displayDate!.localeCompare(b.displayDate!)).slice(0, 5);
  const late = plan.milestones.filter((milestone) => milestone.status !== "COMPLETED" && milestone.status !== "CANCELLED" && (milestone.delayed || milestone.status === "DELAYED" || milestone.status === "AT_RISK")).sort((a, b) => b.overdueDays - a.overdueDays || (b.varianceDays ?? 0) - (a.varianceDays ?? 0));
  const phaseBeingOpened = plan.phases.find((phase) => phase.id === phaseOpen);

  return (
    <div className="space-y-4" data-testid="planning-workspace">
      {/* Header (§128, §236) */}
      <section className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <h2 className="text-page font-semibold text-fg">{t("planning.title")}</h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-table text-fg-muted" data-testid="planning-summary">
            {metrics.total ? (
              <>
                <span className="font-medium text-fg">{t("planning.percentComplete", { value: metrics.progressPercent ?? 0 })}</span>
                <span>{t("planning.milestones", { count: metrics.total })}</span>
                <span>{t("planning.completeCount", { count: metrics.completed })}</span>
              </>
            ) : (
              <span>{empty ? t("planning.noPlan") : t("planning.noMilestones")}</span>
            )}
            {metrics.atRisk ? <span className="text-warning-strong">{t("planning.atRiskCount", { count: metrics.atRisk })}</span> : null}
            {metrics.delayed ? <span className="text-danger-strong">{t("planning.delayedCount", { count: metrics.delayed })}</span> : null}
            {plan.baselineLocked ? (
              <span className="inline-flex items-center gap-1">
                <Lock aria-hidden="true" className="size-3.5" /> {t("planning.baselineLocked")}
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {caps.canCreatePhase && !empty ? (
            <Button type="button" variant="secondary" size="sm" onClick={() => setCreating("phase")}>
              <Plus /> {t("planning.phase")}
            </Button>
          ) : null}
          {caps.canCreateMilestone && !empty ? (
            <Button type="button" size="sm" onClick={() => setCreating("milestone")}>
              <Plus /> {t("planning.milestone")}
            </Button>
          ) : null}
          {caps.canLockBaseline || caps.canUnlockBaseline ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="icon-sm" aria-label={t("planning.planActions")}>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {caps.canLockBaseline ? (
                  <DropdownMenuItem onSelect={() => void run(() => planningApi(`/api/projects/${plan.projectId}/planning/settings`, { method: "PUT", body: { baselineLocked: true } }), t("planning.baselineLocked"))}>
                    <Lock className="size-4" /> {t("planning.lockBaseline")}
                  </DropdownMenuItem>
                ) : null}
                {caps.canUnlockBaseline ? (
                  <DropdownMenuItem onSelect={() => void run(() => planningApi(`/api/projects/${plan.projectId}/planning/settings`, { method: "PUT", body: { baselineLocked: false } }), t("planning.baselineUnlocked"))}>
                    <Unlock className="size-4" /> {t("planning.unlockBaseline")}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </section>

      {empty ? (
        /* Empty plan (§241, §242) */
        <section className="nesto-card px-5 py-8" data-testid="planning-empty">
          <div className="mx-auto max-w-3xl text-center">
            <span className="mx-auto flex size-11 items-center justify-center rounded-full border border-line bg-surface-muted text-fg-subtle">
              <CalendarRange className="size-5" />
            </span>
            <p className="mt-3 text-card font-semibold text-fg">{t("planning.emptyTitle")}</p>
            <p className="mt-1 text-table text-fg-muted">{t("planning.emptyBody")}</p>
            {caps.canCreatePhase || caps.canApplyTemplate ? (
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {caps.canCreatePhase ? (
                  <Button type="button" size="sm" onClick={() => setCreating("phase")}>
                    <Plus /> {t("planning.createPhase")}
                  </Button>
                ) : null}
                {caps.canCreateMilestone ? (
                  <Button type="button" variant="secondary" size="sm" onClick={() => setCreating("milestone")}>
                    <Plus /> {t("planning.addMilestone")}
                  </Button>
                ) : null}
                {caps.canApplyTemplate ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setCopyOpen(true);
                      void planningApi<Option[]>(`/api/projects/${plan.projectId}/planning/copy`).then(setCopyChoices).catch(() => setCopyChoices([]));
                    }}
                  >
                    {t("planning.copyFromProject")}
                  </Button>
                ) : null}
              </div>
            ) : (
              <p className="mt-3 text-table text-fg-subtle">{t("planning.noPlanByManager")}</p>
            )}
          </div>
          {caps.canApplyTemplate ? (
            <div className="mt-6">
              <p className="text-meta font-medium uppercase tracking-wide text-fg-subtle">{t("planning.applyTemplateHeading")}</p>
              <ul className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {PLANNING_TEMPLATES.map((entry) => (
                  <li key={entry.key}>
                    <button type="button" onClick={() => setTemplate(entry.key)} className="flex h-full w-full flex-col rounded-xl border border-line bg-surface px-4 py-3 text-left transition-colors hover:border-accent/50 hover:bg-accent-soft/30" data-testid="planning-template">
                      <span className="text-table font-semibold text-fg">{entry.name}</span>
                      <span className="mt-1 flex-1 text-meta text-fg-muted">{entry.description}</span>
                      <span className="mt-3 text-meta tabular-nums text-fg-subtle">
                        {t("planning.templateCounts", { phases: entry.phases.length, milestones: entry.phases.reduce((sum, phase) => sum + phase.milestones.length, 0) })}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : (
        <>
          {/* View tabs */}
          <nav aria-label={t("planning.viewsLabel")} className="flex items-center gap-1 overflow-x-auto overscroll-x-contain border-b border-line">
            {VIEWS.filter((entry) => entry.key !== "timeline" || wide).map((entry) => (
              <button
                key={entry.key}
                type="button"
                onClick={() => chooseView(entry.key)}
                aria-current={view === entry.key ? "page" : undefined}
                className={cn("-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-table font-medium transition-colors touch:min-h-11", view === entry.key ? "border-accent text-fg" : "border-transparent text-fg-muted hover:text-fg")}
                data-testid={`planning-view-${entry.key}`}
              >
                <entry.icon aria-hidden="true" className="size-4" />
                {t(`planning.views.${entry.key}`)}
              </button>
            ))}
          </nav>

          {/* Filters (§124-§127) */}
          {view !== "overview" ? (
            <section className="space-y-2" aria-label={t("planning.filters")}>
              <div className="flex flex-wrap items-center gap-2">
                <label className="relative min-w-[12rem] flex-1 sm:max-w-xs">
                  <span className="sr-only">{t("planning.searchMilestones")}</span>
                  <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
                  <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("planning.searchMilestones")} className="pl-8" />
                </label>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("planning.quickFilters")}>
                  {QUICK.map((entry) => (
                    <button key={entry.key} type="button" aria-pressed={quick === entry.key} onClick={() => { const next = quick === entry.key ? null : entry.key; setQuick(next); writeUrl({ filter: next }); }} className={cn("rounded-full border px-3 py-1 text-table transition-colors touch:min-h-11", quick === entry.key ? "border-accent/40 bg-accent-soft font-medium text-accent-strong" : "border-line text-fg-muted hover:border-line-strong hover:text-fg")}>
                      {t(`planning.quick.${entry.key}`)}
                    </button>
                  ))}
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={() => setFiltersOpen((value) => !value)} aria-expanded={filtersOpen}>
                  <SlidersHorizontal /> {t("planning.filters")}
                </Button>
                {view === "milestones" ? (
                  <label className="flex items-center gap-2 text-table text-fg-muted">
                    <span>{t("planning.sort")}</span>
                    <select className={cn(selectClass, "h-8 w-auto")} value={sort} onChange={(event) => setSort(event.target.value as SortKey)} aria-label={t("planning.sortMilestones")}>
                      <option value="phase">{t("planning.sortPhase")}</option>
                      <option value="date">{t("planning.sortDate")}</option>
                      <option value="status">{t("planning.sortStatus")}</option>
                      <option value="variance">{t("planning.sortVariance")}</option>
                      <option value="owner">{t("planning.sortOwner")}</option>
                    </select>
                  </label>
                ) : null}
              </div>
              {filtersOpen ? (
                <div className="nesto-card grid gap-3 px-4 py-3 sm:grid-cols-2 lg:grid-cols-5">
                  <label className="flex flex-col gap-1 text-meta text-fg-muted">
                    {t("planning.phase")}
                    <select className={selectClass} value={phaseFilter} onChange={(event) => setPhaseFilter(event.target.value)}>
                      <option value="">{t("planning.allPhases")}</option>
                      {plan.phases.map((phase) => (
                        <option key={phase.id} value={phase.id}>
                          {phase.name}
                        </option>
                      ))}
                      <option value="none">{t("planning.noPhase")}</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-meta text-fg-muted">
                    {t("planning.status")}
                    <select className={selectClass} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as MilestoneStatus | "")}>
                      <option value="">{t("planning.allStatuses")}</option>
                      {MILESTONE_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {t(`milestoneStatus.${status}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-meta text-fg-muted">
                    {t("planning.owner")}
                    <select className={selectClass} value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)}>
                      <option value="">{t("planning.anyone")}</option>
                      {owners.map((owner) => (
                        <option key={owner.id} value={owner.id}>
                          {owner.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-meta text-fg-muted">
                    {t("planning.from")}
                    <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
                  </label>
                  <label className="flex flex-col gap-1 text-meta text-fg-muted">
                    {t("planning.to")}
                    <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
                  </label>
                </div>
              ) : null}
              {filtering ? (
                <p className="text-meta text-fg-muted">
                  {t("planning.filteredCount", { shown: filtered.length, total: plan.milestones.length })}{" "}
                  <button type="button" className="font-medium text-accent-strong hover:underline" onClick={() => { setSearch(""); setQuick(null); setPhaseFilter(""); setStatusFilter(""); setOwnerFilter(""); setFrom(""); setTo(""); writeUrl({ filter: null }); }}>
                    {t("planning.clearFilters")}
                  </button>
                </p>
              ) : null}
            </section>
          ) : null}

          {view === "overview" ? (
            <div className="space-y-4">
              {/* KPIs (§96) */}
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
                <Kpi label={t("planning.planningProgress")} value={metrics.progressPercent === null ? "—" : `${metrics.progressPercent}%`} testId="kpi-progress">
                  <ProgressBar value={metrics.progressPercent} label={t("planning.planningProgress")} className="mt-1" />
                </Kpi>
                <Kpi label={t("planning.milestonesComplete")} value={`${metrics.completed}/${metrics.total}`} testId="kpi-complete" />
                <Kpi label={t("planning.upcoming30")} value={metrics.upcoming} testId="kpi-upcoming" />
                <Kpi label={t("planning.delayed")} value={metrics.delayed} tone={metrics.delayed ? "danger" : undefined} testId="kpi-delayed" />
                <Kpi label={t("planning.atRisk")} value={metrics.atRisk} tone={metrics.atRisk ? "warning" : undefined} testId="kpi-at-risk" />
                <Kpi label={t("planning.critical")} value={metrics.critical} testId="kpi-critical" />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                {/* Upcoming (§237) */}
                <section className="nesto-card overflow-hidden" aria-labelledby="upcoming-title">
                  <header className="flex items-center justify-between border-b border-line px-4 py-3">
                    <h3 id="upcoming-title" className="text-card font-semibold text-fg">{t("planning.upcoming")}</h3>
                    <button type="button" className="text-table font-medium text-accent-strong" onClick={() => { setQuick("upcoming"); chooseView("milestones"); }}>
                      {t("planning.viewAll")}
                    </button>
                  </header>
                  {upcoming.length ? (
                    <ul className="divide-y divide-line/70">
                      {upcoming.map((milestone) => (
                        <li key={milestone.id}>
                          <button type="button" onClick={() => open(milestone.id)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-row-hover" data-testid="upcoming-milestone">
                            <span className="w-14 shrink-0 text-meta font-medium tabular-nums text-fg-muted">{shortDateLabel(milestone.displayDate)}</span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-table font-medium text-fg">{milestone.name}</span>
                              <span className="block truncate text-meta text-fg-muted">
                                <OwnerName owner={milestone.owner} plain />
                              </span>
                            </span>
                            {milestone.critical ? <span className="shrink-0 rounded border border-line-strong px-1 text-micro font-medium uppercase text-fg-muted">{t("planning.critical")}</span> : null}
                            <MilestoneStatusBadge status={milestone.status} delayed={milestone.delayed} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="px-4 py-6 text-table text-fg-subtle">{t("planning.nothingAhead")}</p>
                  )}
                </section>

                {/* Delayed and at risk (§238) */}
                <section className="nesto-card overflow-hidden" aria-labelledby="late-title">
                  <header className="flex items-center justify-between border-b border-line px-4 py-3">
                    <h3 id="late-title" className="text-card font-semibold text-fg">{t("planning.delayedAtRisk")}</h3>
                    <button type="button" className="text-table font-medium text-accent-strong" onClick={() => { setQuick("delayed"); chooseView("milestones"); }}>
                      {t("planning.viewDelayed")}
                    </button>
                  </header>
                  {late.length ? (
                    <ul className="divide-y divide-line/70">
                      {late.slice(0, 6).map((milestone) => (
                        <li key={milestone.id}>
                          <button type="button" onClick={() => open(milestone.id)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-row-hover" data-testid="late-milestone">
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-table font-medium text-fg">{milestone.name}</span>
                              <span className="block truncate text-meta text-fg-muted">
                                <OwnerName owner={milestone.owner} plain />
                                {milestone.delayed ? t("planning.daysPast", { count: milestone.overdueDays, date: dateLabel(milestone.forecastDate ?? milestone.plannedDate) }) : ""}
                              </span>
                            </span>
                            <Variance days={milestone.varianceDays} short className="text-table" />
                            <MilestoneStatusBadge status={milestone.status} delayed={milestone.delayed} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="px-4 py-6 text-table text-fg-subtle">{t("planning.nothingLate")}</p>
                  )}
                </section>
              </div>

              {/* Phases (§26, §28, §114, §131) */}
              <section className="nesto-card overflow-hidden" aria-labelledby="phases-title">
                <header className="flex items-center justify-between border-b border-line px-4 py-3">
                  <h3 id="phases-title" className="text-card font-semibold text-fg">{t("planning.phases")}</h3>
                  {caps.canEditPhase && plan.phases.length > 1 ? <span className="hidden text-meta text-fg-subtle sm:inline">{t("planning.dragHint")}</span> : null}
                </header>
                {plan.phases.length ? (
                  <ol className="divide-y divide-line/70">
                    {plan.phases.map((phase, index) => (
                      <li
                        key={phase.id}
                        draggable={caps.canEditPhase && !mobile}
                        onDragStart={() => (dragged.current = index)}
                        onDragOver={(event) => caps.canEditPhase && event.preventDefault()}
                        onDrop={() => {
                          const source = dragged.current;
                          dragged.current = null;
                          if (source === null || source === index) return;
                          const ids = plan.phases.map((row) => row.id);
                          const [moved] = ids.splice(source, 1);
                          ids.splice(index, 0, moved);
                          void planningApi(`/api/projects/${plan.projectId}/phases/reorder`, { body: { ids } }).then(refresh, (error) => toast({ title: failureMessage(error), tone: "danger" }));
                        }}
                        className="flex items-center gap-3 px-4 py-3"
                        data-testid="phase-row"
                      >
                        <button type="button" onClick={() => setPhaseOpen(phase.id)} className="min-w-0 flex-1 text-left">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="text-table font-semibold text-fg">{phase.name}</span>
                            <MilestoneStatusBadge status={phase.status} />
                          </span>
                          <span className="mt-0.5 block text-meta text-fg-muted">
                            {phase.span ? `${shortDateLabel(phase.span.start)} – ${dateLabel(phase.span.end)}` : t("planning.noDates")} · {t("planning.phaseMilestones", { done: phase.completedCount, total: phase.milestoneCount })}
                            {phase.owner ? ` · ${phase.owner.name}` : ""}
                          </span>
                        </button>
                        <span className="hidden w-40 items-center gap-2 sm:flex">
                          <ProgressBar value={phase.progressPercent ?? phase.suggestedProgress} label={t("planning.phaseProgress", { name: phase.name })} />
                          <span className="w-10 text-right text-meta tabular-nums text-fg-muted" title={phase.progressPercent === null && phase.suggestedProgress !== null ? t("planning.suggested") : undefined}>
                            {phase.progressPercent ?? phase.suggestedProgress ?? 0}%
                          </span>
                        </span>
                        {caps.canEditPhase ? (
                          <span className="flex shrink-0">
                            <Button type="button" variant="ghost" size="icon-sm" aria-label={t("planning.moveUp", { name: phase.name })} disabled={index === 0 || pending} onClick={() => void movePhase(index, -1)}>
                              <ArrowUp />
                            </Button>
                            <Button type="button" variant="ghost" size="icon-sm" aria-label={t("planning.moveDown", { name: phase.name })} disabled={index === plan.phases.length - 1 || pending} onClick={() => void movePhase(index, 1)}>
                              <ArrowDown />
                            </Button>
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="px-4 py-6 text-table text-fg-subtle">{t("planning.noPhases")}</p>
                )}
              </section>
            </div>
          ) : null}

          {view === "timeline" && wide ? (
            <>
              <PlanningTimeline phases={plan.phases} milestones={filtered} dependencies={plan.dependencies} today={plan.today} projectStart={plan.project.startDate} projectEnd={plan.project.endDate} zoom={zoom} onZoom={setZoom} onOpenMilestone={(id) => open(id)} onOpenPhase={setPhaseOpen} showPhasesWithoutMatches={!filtering} />
              <p className="text-meta text-fg-subtle">{t("planning.timelineNote")}</p>
            </>
          ) : null}

          {view === "milestones" ? <MilestoneList phases={plan.phases} milestones={filtered} sort={sort} mobile={cards} capabilities={caps} filtered={filtering} onOpen={open} onOpenPhase={setPhaseOpen} /> : null}

          {view === "dependencies" ? (
            /* Dependencies (§268) */
            <section className="nesto-card overflow-hidden" data-testid="dependency-table">
              {plan.dependencies.length ? (
                <ScrollRegion label={t("planning.dependenciesLabel")}>
                  <table className="w-full min-w-[640px] text-left">
                    <caption className="sr-only">{t("planning.dependenciesLabel")}</caption>
                    <thead>
                      <tr className="border-b border-line text-meta text-fg-muted">
                        <th scope="col" className="px-4 py-2 font-medium">{t("planning.predecessor")}</th>
                        <th scope="col" className="px-3 py-2 font-medium" aria-label="then" />
                        <th scope="col" className="px-3 py-2 font-medium">{t("planning.successor")}</th>
                        <th scope="col" className="px-3 py-2 font-medium">{t("planning.lag")}</th>
                        <th scope="col" className="px-4 py-2 font-medium">{t("planning.status")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.dependencies
                        .filter((edge) => filtered.some((milestone) => milestone.id === edge.predecessorId || milestone.id === edge.successorId))
                        .map((edge) => {
                          const predecessor = plan.milestones.find((milestone) => milestone.id === edge.predecessorId);
                          const successor = plan.milestones.find((milestone) => milestone.id === edge.successorId);
                          return (
                            <tr key={edge.id} className="border-b border-line/70 last:border-0">
                              <td className="px-4 py-2.5">
                                <button type="button" className="text-table font-medium text-fg hover:text-accent-strong" onClick={() => predecessor && open(predecessor.id)}>
                                  {predecessor?.name}
                                </button>
                                <span className="block text-meta text-fg-muted">{predecessor ? `${t(`milestoneStatus.${predecessor.status}`)} · ${dateLabel(predecessor.displayDate)}` : ""}</span>
                              </td>
                              <td className="px-3 py-2.5 text-fg-subtle" aria-hidden="true">→</td>
                              <td className="px-3 py-2.5">
                                <button type="button" className="text-table font-medium text-fg hover:text-accent-strong" onClick={() => successor && open(successor.id)}>
                                  {successor?.name}
                                </button>
                                <span className="block text-meta text-fg-muted">{successor ? `${t(`milestoneStatus.${successor.status}`)} · ${dateLabel(successor.displayDate)}` : ""}</span>
                              </td>
                              <td className="px-3 py-2.5 text-table tabular-nums text-fg-muted">{edge.lagDays ? t("planning.lagDays", { count: edge.lagDays }) : "—"}</td>
                              <td className="px-4 py-2.5 text-table">
                                {edge.warning ? <span className="text-warning-strong">{edge.warning}</span> : edge.satisfied ? <span className="text-success-strong">{t("planning.satisfied")}</span> : <span className="text-fg-muted">{t("planning.waiting")}</span>}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </ScrollRegion>
              ) : (
                <p className="px-4 py-8 text-center text-table text-fg-subtle">{t("planning.noDependencies")}</p>
              )}
            </section>
          ) : null}
        </>
      )}

      <MilestoneDrawer milestoneId={drawer.id} initialPanel={drawer.panel} mobile={mobile} phases={phaseOptions} members={plan.members} canSetBaseline={caps.canManageBaseline} onClose={close} onChanged={() => void refresh()} />

      <MilestoneFormDialog open={creating === "milestone"} onOpenChange={(value) => setCreating(value ? "milestone" : null)} projectId={plan.projectId} initial={{ ...EMPTY_MILESTONE, phaseId: phaseFilter && phaseFilter !== "none" ? phaseFilter : "" }} phases={phaseOptions} members={plan.members} canSetBaseline={caps.canManageBaseline} onSaved={(id) => { toast({ title: t("planning.milestoneAdded"), tone: "success" }); void refresh(); open(id); }} />
      <PhaseFormDialog open={creating === "phase"} onOpenChange={(value) => setCreating(value ? "phase" : null)} projectId={plan.projectId} initial={EMPTY_PHASE} members={plan.members} canEdit onSaved={() => { toast({ title: t("planning.phaseAdded"), tone: "success" }); void refresh(); }} />
      {phaseBeingOpened ? (
        <PhaseFormDialog
          open={Boolean(phaseOpen)}
          onOpenChange={(value) => !value && setPhaseOpen(null)}
          projectId={plan.projectId}
          phaseId={phaseBeingOpened.id}
          version={phaseBeingOpened.version}
          canEdit={caps.canEditPhase}
          canArchive={caps.canArchivePhase}
          members={plan.members}
          suggestedProgress={phaseBeingOpened.suggestedProgress}
          milestones={plan.milestones.filter((milestone) => milestone.phaseId === phaseBeingOpened.id).map((milestone) => ({ id: milestone.id, name: milestone.name, status: milestone.status }))}
          initial={{
            name: phaseBeingOpened.name,
            status: phaseBeingOpened.status,
            ownerMemberId: phaseBeingOpened.owner?.memberId ?? "",
            progressPercent: phaseBeingOpened.progressPercent === null ? "" : String(phaseBeingOpened.progressPercent),
            plannedStartDate: phaseBeingOpened.plannedStartDate ?? "",
            plannedEndDate: phaseBeingOpened.plannedEndDate ?? "",
            forecastStartDate: phaseBeingOpened.forecastStartDate ?? "",
            forecastEndDate: phaseBeingOpened.forecastEndDate ?? "",
            actualStartDate: phaseBeingOpened.actualStartDate ?? "",
            actualEndDate: phaseBeingOpened.actualEndDate ?? "",
            description: phaseBeingOpened.description ?? "",
          }}
          onSaved={() => {
            toast({ title: t("planning.phaseSaved"), tone: "success" });
            void refresh();
          }}
        />
      ) : null}

      <Dialog open={Boolean(template)} onOpenChange={(value) => !value && setTemplate(null)}>
        <DialogContent>
          <DialogTitle>{t("planning.applyTitle", { name: PLANNING_TEMPLATES.find((entry) => entry.key === template)?.name ?? "" })}</DialogTitle>
          <DialogDescription>
            {t("planning.applyBody")}{plan.project.startDate ? t("planning.applyDates") : t("planning.applyNoDates")}{t("planning.applyBaselines")}
          </DialogDescription>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setTemplate(null)}>
              {t("planning.cancel")}
            </Button>
            <Button type="button" disabled={pending} onClick={async () => { if (await run(() => planningApi(`/api/projects/${plan.projectId}/planning/template`, { body: { templateKey: template } }), t("planning.templateApplied"))) setTemplate(null); }}>
              {t("planning.applyTemplate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={copyOpen}
        onOpenChange={(value) => {
          setCopyOpen(value);
          // Reached only through the guarded close: a discarded choice is gone (AUD-03 §5).
          if (!value) setCopySource("");
        }}
      >
        <DialogContent>
          <CopyChoiceEditor value={copySource} pending={pending} />
          <DialogTitle>{t("planning.copyTitle")}</DialogTitle>
          <DialogDescription>{t("planning.copyBody")}</DialogDescription>
          <label className="mt-4 flex flex-col gap-1 text-meta text-fg-muted">
            {t("planning.project")}
            <select className={selectClass} value={copySource} onChange={(event) => setCopySource(event.target.value)}>
              <option value="">{copyChoices === null ? t("planning.loading") : copyChoices.length ? t("planning.chooseProject") : t("planning.noOtherPlan")}</option>
              {(copyChoices ?? []).map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.label}
                </option>
              ))}
            </select>
          </label>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                {t("planning.cancel")}
              </Button>
            </DialogClose>
            <Button
              type="button"
              disabled={pending || !copySource}
              onClick={async () => {
                if (await run(() => planningApi(`/api/projects/${plan.projectId}/planning/copy`, { body: { sourceProjectId: copySource } }), t("planning.planningCopied"))) {
                  setCopyOpen(false);
                  setCopySource("");
                }
              }}
            >
              {t("planning.copyPlanning")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * The project chosen to copy a plan from, as a workflow editor (AUD-03 §3):
 * copying is a bulk step, so closing with a choice made asks, and Save and
 * continue never copies. Rendered inside the dialog, so its close is the one
 * that asks.
 */
function CopyChoiceEditor({ value, pending }: { value: string; pending: boolean }) {
  const t = useTranslations("projects");
  const editor = useValuesEditor(value, { module: "planning", saveKind: "none", workflow: "Copy planning", label: t("planning.planningToCopy") });
  const { setSaving } = editor;
  React.useEffect(() => setSaving(pending), [pending, setSaving]);
  return null;
}
