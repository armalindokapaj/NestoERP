"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, CalendarRange, Flag, GanttChart, LayoutDashboard, ListTree, Lock, MoreHorizontal, Network, Plus, Search, SlidersHorizontal, Unlock } from "lucide-react";

import { selectClass } from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { addLocalDays, dateLabel, shortDateLabel } from "@/lib/modules/project-planning/planning.dates";
import { PLANNING_TEMPLATES } from "@/lib/modules/project-planning/planning.template-catalog";
import { MILESTONE_STATUSES, STATUS_LABELS, type MilestoneStatus, type MilestoneSummaryDTO, type Option, type ProjectPlanningOverviewDTO } from "@/lib/modules/project-planning/planning.types";
import { cn } from "@/lib/utils/cn";
import { MilestoneDrawer } from "./milestone-drawer";
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

const VIEWS: Array<{ key: View; label: string; icon: typeof Flag }> = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "timeline", label: "Timeline", icon: GanttChart },
  { key: "milestones", label: "Milestones", icon: ListTree },
  { key: "dependencies", label: "Dependencies", icon: Network },
];

const QUICK: Array<{ key: Quick; label: string }> = [
  { key: "upcoming", label: "Upcoming 30 Days" },
  { key: "delayed", label: "Delayed" },
  { key: "at_risk", label: "At Risk" },
  { key: "critical", label: "Critical" },
  { key: "completed", label: "Completed" },
];

function useBreakpoint(query: string) {
  const [matches, setMatches] = React.useState(false);
  React.useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
}

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
  const toast = useToast();
  const mobile = useBreakpoint("(max-width: 767px)");
  const wide = useBreakpoint("(min-width: 768px)");
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
      toast({ title: failureMessage(error, "The plan could not be refreshed."), tone: "danger" });
    }
  }, [plan.projectId, toast]);

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
      toast({ title: failureMessage(error, "The phases could not be reordered."), tone: "danger" });
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
          <h2 className="text-page font-semibold text-fg">Project Planning</h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-table text-fg-muted" data-testid="planning-summary">
            {metrics.total ? (
              <>
                <span className="font-medium text-fg">{metrics.progressPercent}% complete</span>
                <span>{metrics.total} {metrics.total === 1 ? "milestone" : "milestones"}</span>
                <span>{metrics.completed} complete</span>
              </>
            ) : (
              <span>{empty ? "No plan yet" : "No milestones yet"}</span>
            )}
            {metrics.atRisk ? <span className="text-warning-strong">{metrics.atRisk} at risk</span> : null}
            {metrics.delayed ? <span className="text-danger-strong">{metrics.delayed} delayed</span> : null}
            {plan.baselineLocked ? (
              <span className="inline-flex items-center gap-1">
                <Lock aria-hidden="true" className="size-3.5" /> Baseline locked
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {caps.canCreatePhase && !empty ? (
            <Button type="button" variant="secondary" size="sm" onClick={() => setCreating("phase")}>
              <Plus /> Phase
            </Button>
          ) : null}
          {caps.canCreateMilestone && !empty ? (
            <Button type="button" size="sm" onClick={() => setCreating("milestone")}>
              <Plus /> Milestone
            </Button>
          ) : null}
          {caps.canLockBaseline || caps.canUnlockBaseline ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Plan actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {caps.canLockBaseline ? (
                  <DropdownMenuItem onSelect={() => void run(() => planningApi(`/api/projects/${plan.projectId}/planning/settings`, { method: "PUT", body: { baselineLocked: true } }), "Baseline locked")}>
                    <Lock className="size-4" /> Lock baseline
                  </DropdownMenuItem>
                ) : null}
                {caps.canUnlockBaseline ? (
                  <DropdownMenuItem onSelect={() => void run(() => planningApi(`/api/projects/${plan.projectId}/planning/settings`, { method: "PUT", body: { baselineLocked: false } }), "Baseline unlocked")}>
                    <Unlock className="size-4" /> Unlock baseline
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
            <p className="mt-3 text-card font-semibold text-fg">No project plan yet.</p>
            <p className="mt-1 text-table text-fg-muted">Set out the phases and key milestones this project is working towards — or start from a template.</p>
            {caps.canCreatePhase || caps.canApplyTemplate ? (
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {caps.canCreatePhase ? (
                  <Button type="button" size="sm" onClick={() => setCreating("phase")}>
                    <Plus /> Create Phase
                  </Button>
                ) : null}
                {caps.canCreateMilestone ? (
                  <Button type="button" variant="secondary" size="sm" onClick={() => setCreating("milestone")}>
                    <Plus /> Add Milestone
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
                    Copy from another project
                  </Button>
                ) : null}
              </div>
            ) : (
              <p className="mt-3 text-table text-fg-subtle">The project manager has not set out a plan.</p>
            )}
          </div>
          {caps.canApplyTemplate ? (
            <div className="mt-6">
              <p className="text-meta font-medium uppercase tracking-wide text-fg-subtle">Apply Template</p>
              <ul className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {PLANNING_TEMPLATES.map((entry) => (
                  <li key={entry.key}>
                    <button type="button" onClick={() => setTemplate(entry.key)} className="flex h-full w-full flex-col rounded-xl border border-line bg-surface px-4 py-3 text-left transition-colors hover:border-accent/50 hover:bg-accent-soft/30" data-testid="planning-template">
                      <span className="text-table font-semibold text-fg">{entry.name}</span>
                      <span className="mt-1 flex-1 text-meta text-fg-muted">{entry.description}</span>
                      <span className="mt-3 text-meta tabular-nums text-fg-subtle">
                        {entry.phases.length} phases · {entry.phases.reduce((sum, phase) => sum + phase.milestones.length, 0)} milestones
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
          <nav aria-label="Planning views" className="flex items-center gap-1 overflow-x-auto border-b border-line">
            {VIEWS.filter((entry) => entry.key !== "timeline" || wide).map((entry) => (
              <button
                key={entry.key}
                type="button"
                onClick={() => chooseView(entry.key)}
                aria-current={view === entry.key ? "page" : undefined}
                className={cn("-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-table font-medium transition-colors", view === entry.key ? "border-accent text-fg" : "border-transparent text-fg-muted hover:text-fg")}
                data-testid={`planning-view-${entry.key}`}
              >
                <entry.icon aria-hidden="true" className="size-4" />
                {entry.label}
              </button>
            ))}
          </nav>

          {/* Filters (§124-§127) */}
          {view !== "overview" ? (
            <section className="space-y-2" aria-label="Filters">
              <div className="flex flex-wrap items-center gap-2">
                <label className="relative min-w-[12rem] flex-1 sm:max-w-xs">
                  <span className="sr-only">Search milestones</span>
                  <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
                  <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search milestones" className="pl-8" />
                </label>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick filters">
                  {QUICK.map((entry) => (
                    <button key={entry.key} type="button" aria-pressed={quick === entry.key} onClick={() => { const next = quick === entry.key ? null : entry.key; setQuick(next); writeUrl({ filter: next }); }} className={cn("rounded-full border px-3 py-1 text-table transition-colors", quick === entry.key ? "border-accent/40 bg-accent-soft font-medium text-accent-strong" : "border-line text-fg-muted hover:border-line-strong hover:text-fg")}>
                      {entry.label}
                    </button>
                  ))}
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={() => setFiltersOpen((value) => !value)} aria-expanded={filtersOpen}>
                  <SlidersHorizontal /> Filters
                </Button>
                {view === "milestones" ? (
                  <label className="flex items-center gap-2 text-table text-fg-muted">
                    <span>Sort</span>
                    <select className={cn(selectClass, "h-8 w-auto")} value={sort} onChange={(event) => setSort(event.target.value as SortKey)} aria-label="Sort milestones">
                      <option value="phase">Phase</option>
                      <option value="date">Date</option>
                      <option value="status">Status</option>
                      <option value="variance">Variance</option>
                      <option value="owner">Owner</option>
                    </select>
                  </label>
                ) : null}
              </div>
              {filtersOpen ? (
                <div className="nesto-card grid gap-3 px-4 py-3 sm:grid-cols-2 lg:grid-cols-5">
                  <label className="flex flex-col gap-1 text-meta text-fg-muted">
                    Phase
                    <select className={selectClass} value={phaseFilter} onChange={(event) => setPhaseFilter(event.target.value)}>
                      <option value="">All phases</option>
                      {plan.phases.map((phase) => (
                        <option key={phase.id} value={phase.id}>
                          {phase.name}
                        </option>
                      ))}
                      <option value="none">No phase</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-meta text-fg-muted">
                    Status
                    <select className={selectClass} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as MilestoneStatus | "")}>
                      <option value="">All statuses</option>
                      {MILESTONE_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {STATUS_LABELS[status]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-meta text-fg-muted">
                    Owner
                    <select className={selectClass} value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)}>
                      <option value="">Anyone</option>
                      {owners.map((owner) => (
                        <option key={owner.id} value={owner.id}>
                          {owner.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-meta text-fg-muted">
                    From
                    <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
                  </label>
                  <label className="flex flex-col gap-1 text-meta text-fg-muted">
                    To
                    <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
                  </label>
                </div>
              ) : null}
              {filtering ? (
                <p className="text-meta text-fg-muted">
                  {filtered.length} of {plan.milestones.length} milestones.{" "}
                  <button type="button" className="font-medium text-accent-strong hover:underline" onClick={() => { setSearch(""); setQuick(null); setPhaseFilter(""); setStatusFilter(""); setOwnerFilter(""); setFrom(""); setTo(""); writeUrl({ filter: null }); }}>
                    Clear filters
                  </button>
                </p>
              ) : null}
            </section>
          ) : null}

          {view === "overview" ? (
            <div className="space-y-4">
              {/* KPIs (§96) */}
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
                <Kpi label="Planning progress" value={metrics.progressPercent === null ? "—" : `${metrics.progressPercent}%`} testId="kpi-progress">
                  <ProgressBar value={metrics.progressPercent} label="Planning progress" className="mt-1" />
                </Kpi>
                <Kpi label="Milestones complete" value={`${metrics.completed}/${metrics.total}`} testId="kpi-complete" />
                <Kpi label="Upcoming · 30 days" value={metrics.upcoming} testId="kpi-upcoming" />
                <Kpi label="Delayed" value={metrics.delayed} tone={metrics.delayed ? "danger" : undefined} testId="kpi-delayed" />
                <Kpi label="At risk" value={metrics.atRisk} tone={metrics.atRisk ? "warning" : undefined} testId="kpi-at-risk" />
                <Kpi label="Critical" value={metrics.critical} testId="kpi-critical" />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                {/* Upcoming (§237) */}
                <section className="nesto-card overflow-hidden" aria-labelledby="upcoming-title">
                  <header className="flex items-center justify-between border-b border-line px-4 py-3">
                    <h3 id="upcoming-title" className="text-card font-semibold text-fg">Upcoming</h3>
                    <button type="button" className="text-table font-medium text-accent-strong" onClick={() => { setQuick("upcoming"); chooseView("milestones"); }}>
                      View all
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
                                <OwnerName owner={milestone.owner} />
                              </span>
                            </span>
                            {milestone.critical ? <span className="shrink-0 rounded border border-line-strong px-1 text-micro font-medium uppercase text-fg-muted">Critical</span> : null}
                            <MilestoneStatusBadge status={milestone.status} delayed={milestone.delayed} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="px-4 py-6 text-table text-fg-subtle">Nothing ahead on the plan.</p>
                  )}
                </section>

                {/* Delayed and at risk (§238) */}
                <section className="nesto-card overflow-hidden" aria-labelledby="late-title">
                  <header className="flex items-center justify-between border-b border-line px-4 py-3">
                    <h3 id="late-title" className="text-card font-semibold text-fg">Delayed / At Risk</h3>
                    <button type="button" className="text-table font-medium text-accent-strong" onClick={() => { setQuick("delayed"); chooseView("milestones"); }}>
                      View delayed
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
                                <OwnerName owner={milestone.owner} />
                                {milestone.delayed ? ` · ${milestone.overdueDays} ${milestone.overdueDays === 1 ? "day" : "days"} past ${dateLabel(milestone.forecastDate ?? milestone.plannedDate)}` : ""}
                              </span>
                            </span>
                            <Variance days={milestone.varianceDays} short className="text-table" />
                            <MilestoneStatusBadge status={milestone.status} delayed={milestone.delayed} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="px-4 py-6 text-table text-fg-subtle">Nothing is delayed or at risk.</p>
                  )}
                </section>
              </div>

              {/* Phases (§26, §28, §114, §131) */}
              <section className="nesto-card overflow-hidden" aria-labelledby="phases-title">
                <header className="flex items-center justify-between border-b border-line px-4 py-3">
                  <h3 id="phases-title" className="text-card font-semibold text-fg">Phases</h3>
                  {caps.canEditPhase && plan.phases.length > 1 ? <span className="hidden text-meta text-fg-subtle sm:inline">Drag to reorder, or use the arrows.</span> : null}
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
                            {phase.span ? `${shortDateLabel(phase.span.start)} – ${dateLabel(phase.span.end)}` : "No dates"} · {phase.completedCount}/{phase.milestoneCount} milestones
                            {phase.owner ? ` · ${phase.owner.name}` : ""}
                          </span>
                        </button>
                        <span className="hidden w-40 items-center gap-2 sm:flex">
                          <ProgressBar value={phase.progressPercent ?? phase.suggestedProgress} label={`${phase.name} progress`} />
                          <span className="w-10 text-right text-meta tabular-nums text-fg-muted" title={phase.progressPercent === null && phase.suggestedProgress !== null ? "Suggested from milestones" : undefined}>
                            {phase.progressPercent ?? phase.suggestedProgress ?? 0}%
                          </span>
                        </span>
                        {caps.canEditPhase ? (
                          <span className="flex shrink-0">
                            <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move ${phase.name} up`} disabled={index === 0 || pending} onClick={() => void movePhase(index, -1)}>
                              <ArrowUp />
                            </Button>
                            <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move ${phase.name} down`} disabled={index === plan.phases.length - 1 || pending} onClick={() => void movePhase(index, 1)}>
                              <ArrowDown />
                            </Button>
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="px-4 py-6 text-table text-fg-subtle">No phases — milestones are listed on their own.</p>
                )}
              </section>
            </div>
          ) : null}

          {view === "timeline" && wide ? (
            <>
              <PlanningTimeline phases={plan.phases} milestones={filtered} dependencies={plan.dependencies} today={plan.today} projectStart={plan.project.startDate} projectEnd={plan.project.endDate} zoom={zoom} onZoom={setZoom} onOpenMilestone={(id) => open(id)} onOpenPhase={setPhaseOpen} showPhasesWithoutMatches={!filtering} />
              <p className="text-meta text-fg-subtle">The same plan is listed under Milestones, for keyboard and screen-reader use.</p>
            </>
          ) : null}

          {view === "milestones" ? <MilestoneList phases={plan.phases} milestones={filtered} sort={sort} mobile={mobile} capabilities={caps} filtered={filtering} onOpen={open} onOpenPhase={setPhaseOpen} /> : null}

          {view === "dependencies" ? (
            /* Dependencies (§268) */
            <section className="nesto-card overflow-hidden" data-testid="dependency-table">
              {plan.dependencies.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left">
                    <caption className="sr-only">Milestone dependencies</caption>
                    <thead>
                      <tr className="border-b border-line text-meta text-fg-muted">
                        <th scope="col" className="px-4 py-2 font-medium">Predecessor</th>
                        <th scope="col" className="px-3 py-2 font-medium" aria-label="then" />
                        <th scope="col" className="px-3 py-2 font-medium">Successor</th>
                        <th scope="col" className="px-3 py-2 font-medium">Lag</th>
                        <th scope="col" className="px-4 py-2 font-medium">Status</th>
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
                                <span className="block text-meta text-fg-muted">{predecessor ? `${STATUS_LABELS[predecessor.status]} · ${dateLabel(predecessor.displayDate)}` : ""}</span>
                              </td>
                              <td className="px-3 py-2.5 text-fg-subtle" aria-hidden="true">→</td>
                              <td className="px-3 py-2.5">
                                <button type="button" className="text-table font-medium text-fg hover:text-accent-strong" onClick={() => successor && open(successor.id)}>
                                  {successor?.name}
                                </button>
                                <span className="block text-meta text-fg-muted">{successor ? `${STATUS_LABELS[successor.status]} · ${dateLabel(successor.displayDate)}` : ""}</span>
                              </td>
                              <td className="px-3 py-2.5 text-table tabular-nums text-fg-muted">{edge.lagDays ? `${edge.lagDays} ${edge.lagDays === 1 ? "day" : "days"}` : "—"}</td>
                              <td className="px-4 py-2.5 text-table">
                                {edge.warning ? <span className="text-warning-strong">{edge.warning}</span> : edge.satisfied ? <span className="text-success-strong">Satisfied</span> : <span className="text-fg-muted">Waiting</span>}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="px-4 py-8 text-center text-table text-fg-subtle">No dependencies. Open a milestone and add what it depends on.</p>
              )}
            </section>
          ) : null}
        </>
      )}

      <MilestoneDrawer milestoneId={drawer.id} initialPanel={drawer.panel} mobile={mobile} phases={phaseOptions} members={plan.members} canSetBaseline={caps.canManageBaseline} onClose={close} onChanged={() => void refresh()} />

      <MilestoneFormDialog open={creating === "milestone"} onOpenChange={(value) => setCreating(value ? "milestone" : null)} projectId={plan.projectId} initial={{ ...EMPTY_MILESTONE, phaseId: phaseFilter && phaseFilter !== "none" ? phaseFilter : "" }} phases={phaseOptions} members={plan.members} canSetBaseline={caps.canManageBaseline} onSaved={(id) => { toast({ title: "Milestone added", tone: "success" }); void refresh(); open(id); }} />
      <PhaseFormDialog open={creating === "phase"} onOpenChange={(value) => setCreating(value ? "phase" : null)} projectId={plan.projectId} initial={EMPTY_PHASE} members={plan.members} canEdit onSaved={() => { toast({ title: "Phase added", tone: "success" }); void refresh(); }} />
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
            toast({ title: "Phase saved", tone: "success" });
            void refresh();
          }}
        />
      ) : null}

      <Dialog open={Boolean(template)} onOpenChange={(value) => !value && setTemplate(null)}>
        <DialogContent>
          <DialogTitle>Apply the {PLANNING_TEMPLATES.find((entry) => entry.key === template)?.name} template?</DialogTitle>
          <DialogDescription>
            Creates its phases, milestones and dependencies on this empty plan.{plan.project.startDate ? " Planned dates follow the project's start date." : " Add dates afterwards."} Baselines are left for you to set.
          </DialogDescription>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setTemplate(null)}>
              Cancel
            </Button>
            <Button type="button" disabled={pending} onClick={async () => { if (await run(() => planningApi(`/api/projects/${plan.projectId}/planning/template`, { body: { templateKey: template } }), "Template applied")) setTemplate(null); }}>
              Apply template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={copyOpen} onOpenChange={setCopyOpen}>
        <DialogContent>
          <DialogTitle>Copy planning from another project</DialogTitle>
          <DialogDescription>Phases, milestone names and dependencies are copied. Actual dates, statuses, documents, meetings and logs are not.</DialogDescription>
          <label className="mt-4 flex flex-col gap-1 text-meta text-fg-muted">
            Project
            <select className={selectClass} value={copySource} onChange={(event) => setCopySource(event.target.value)}>
              <option value="">{copyChoices === null ? "Loading…" : copyChoices.length ? "Choose a project" : "No other project has a plan"}</option>
              {(copyChoices ?? []).map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.label}
                </option>
              ))}
            </select>
          </label>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setCopyOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={pending || !copySource} onClick={async () => { if (await run(() => planningApi(`/api/projects/${plan.projectId}/planning/copy`, { body: { sourceProjectId: copySource } }), "Planning copied")) setCopyOpen(false); }}>
              Copy planning
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
