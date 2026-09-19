"use client";

import * as React from "react";
import { AlertTriangle, ChevronDown, Flag, Link2, MoreHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { dateLabel, shortDateLabel } from "@/lib/modules/project-planning/planning.dates";
import { STATUS_LABELS, type MilestoneSummaryDTO, type PhaseSummaryDTO, type PlanningCapabilities } from "@/lib/modules/project-planning/planning.types";
import { cn } from "@/lib/utils/cn";
import { CommittedBadge, CriticalBadge, MilestoneStatusBadge, OwnerName, ProgressBar, Variance } from "./planning-ui";

/**
 * The planning list (PRD #44 §115-§117, §119, §239, §240, §246, §304).
 *
 * The same plan as the timeline, as rows: grouped by phase and collapsible, or
 * flat when sorted by date, status, variance or owner. It is the timeline's
 * accessible equivalent. On a phone each milestone is a card with the numbers
 * that matter and a short action menu for the updates made on site.
 */

export type DrawerPanel = "status" | "forecast" | "blocker" | "task" | "complete" | null;
export type SortKey = "phase" | "date" | "status" | "variance" | "owner";

const STATUS_ORDER = ["DELAYED", "AT_RISK", "IN_PROGRESS", "NOT_STARTED", "ON_HOLD", "COMPLETED", "CANCELLED"];

export function sortMilestones(milestones: MilestoneSummaryDTO[], sort: SortKey): MilestoneSummaryDTO[] {
  const byDate = (a: MilestoneSummaryDTO, b: MilestoneSummaryDTO) => (a.displayDate ?? "9999").localeCompare(b.displayDate ?? "9999");
  const copy = [...milestones];
  switch (sort) {
    case "date":
      return copy.sort(byDate);
    case "status":
      return copy.sort((a, b) => STATUS_ORDER.indexOf(a.delayed ? "DELAYED" : a.status) - STATUS_ORDER.indexOf(b.delayed ? "DELAYED" : b.status) || byDate(a, b));
    case "variance":
      return copy.sort((a, b) => (b.varianceDays ?? -99_999) - (a.varianceDays ?? -99_999) || byDate(a, b));
    case "owner":
      return copy.sort((a, b) => (a.owner?.name ?? "~").localeCompare(b.owner?.name ?? "~") || byDate(a, b));
    default:
      return copy;
  }
}

function MilestoneMeta({ milestone }: { milestone: MilestoneSummaryDTO }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {milestone.critical ? <CriticalBadge /> : null}
      {milestone.externallyCommitted ? <CommittedBadge /> : null}
      {milestone.dependencyWarning ? (
        <span className="inline-flex items-center gap-1 text-meta text-warning-strong" title={milestone.dependencyWarning}>
          <Link2 aria-hidden="true" className="size-3.5" />
          <span className="sr-only md:not-sr-only">{milestone.dependencyWarning}</span>
        </span>
      ) : null}
      {milestone.openBlockerCount ? (
        <span className={cn("inline-flex items-center gap-1 text-meta", milestone.criticalBlockerCount ? "text-danger-strong" : "text-fg-muted")}>
          <AlertTriangle aria-hidden="true" className="size-3.5" />
          {milestone.openBlockerCount} {milestone.openBlockerCount === 1 ? "blocker" : "blockers"}
        </span>
      ) : null}
    </span>
  );
}

function MobileCard({ milestone, capabilities, onOpen }: { milestone: MilestoneSummaryDTO; capabilities: PlanningCapabilities; onOpen: (id: string, panel?: DrawerPanel) => void }) {
  const closed = milestone.status === "COMPLETED" || milestone.status === "CANCELLED";
  const actions: Array<{ panel: DrawerPanel; label: string; show: boolean }> = [
    { panel: "status", label: "Update status", show: capabilities.canEditMilestone && !closed },
    { panel: "forecast", label: "Update forecast", show: capabilities.canEditMilestone && !closed },
    { panel: "blocker", label: "Add blocker", show: capabilities.canManageBlockers && !closed },
    { panel: "task", label: "Create task", show: capabilities.canCreateTask && !closed },
    { panel: "complete", label: "Mark complete", show: capabilities.canComplete && !closed },
  ];
  const available = actions.filter((action) => action.show);
  return (
    <li className="nesto-card relative px-4 py-3" data-testid="milestone-card">
      <div className="flex items-start gap-3">
        <button type="button" onClick={() => onOpen(milestone.id)} className="min-w-0 flex-1 text-left">
          <span className="block text-body font-medium text-fg">{milestone.name}</span>
          <span className="mt-1 flex flex-wrap items-center gap-2">
            <MilestoneStatusBadge status={milestone.status} delayed={milestone.delayed} />
            <MilestoneMeta milestone={milestone} />
          </span>
        </button>
        {available.length ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`Actions for ${milestone.name}`}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {available.map((action) => (
                <DropdownMenuItem key={action.label} onSelect={() => onOpen(milestone.id, action.panel)}>
                  {action.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-meta">
        <div>
          <dt className="text-fg-subtle">{milestone.status === "COMPLETED" ? "Actual" : "Forecast"}</dt>
          <dd className="font-medium tabular-nums text-fg">{shortDateLabel(milestone.status === "COMPLETED" ? milestone.actualDate : (milestone.forecastDate ?? milestone.plannedDate))}</dd>
        </div>
        <div>
          <dt className="text-fg-subtle">Baseline</dt>
          <dd className="tabular-nums text-fg">{shortDateLabel(milestone.baselineDate)}</dd>
        </div>
        <div>
          <dt className="text-fg-subtle">Variance</dt>
          <dd>
            <Variance days={milestone.varianceDays} />
          </dd>
        </div>
      </dl>
      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-fg-muted">
        <span>
          Owner: <OwnerName owner={milestone.owner} />
        </span>
        {milestone.taskStats.total ? (
          <span className="tabular-nums">
            {milestone.taskStats.completed}/{milestone.taskStats.total} tasks complete
          </span>
        ) : null}
      </p>
    </li>
  );
}

function Row({ milestone, onOpen }: { milestone: MilestoneSummaryDTO; onOpen: (id: string) => void }) {
  return (
    <tr className="cursor-pointer border-b border-line/70 transition-colors last:border-0 hover:bg-row-hover" onClick={(event) => !(event.target as HTMLElement).closest("a") && onOpen(milestone.id)} data-testid="milestone-row">
      <td className="px-4 py-2.5 align-top">
        <MilestoneStatusBadge status={milestone.status} delayed={milestone.delayed} />
      </td>
      <td className="px-3 py-2.5 align-top">
        <button type="button" className="text-left text-table font-medium text-fg hover:text-accent-strong" onClick={(event) => { event.stopPropagation(); onOpen(milestone.id); }}>
          {milestone.name}
        </button>
        <div className="mt-1">
          <MilestoneMeta milestone={milestone} />
        </div>
      </td>
      <td className="truncate px-3 py-2.5 align-top text-table text-fg-muted">
        <OwnerName owner={milestone.owner} />
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 align-top text-table tabular-nums text-fg-muted">{dateLabel(milestone.baselineDate)}</td>
      <td className="whitespace-nowrap px-3 py-2.5 align-top text-table tabular-nums text-fg">{dateLabel(milestone.forecastDate ?? milestone.plannedDate)}</td>
      <td className="whitespace-nowrap px-3 py-2.5 align-top text-table tabular-nums text-fg">{dateLabel(milestone.actualDate)}</td>
      <td className="px-3 py-2.5 align-top text-table">
        <Variance days={milestone.varianceDays} short />
      </td>
      <td className="px-3 py-2.5 align-top">
        <span className="flex items-center gap-2">
          <ProgressBar value={milestone.progressPercent} label={`${milestone.name} progress`} className="w-16" />
          <span className="text-meta tabular-nums text-fg-muted">{milestone.progressPercent === null ? "—" : `${Math.round(milestone.progressPercent)}%`}</span>
        </span>
      </td>
      <td className="px-4 py-2.5 align-top text-table tabular-nums text-fg-muted">{milestone.taskStats.total ? `${milestone.taskStats.completed}/${milestone.taskStats.total}` : "—"}</td>
    </tr>
  );
}

function Table({ milestones, onOpen, caption }: { milestones: MilestoneSummaryDTO[]; onOpen: (id: string) => void; caption: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[960px] table-fixed text-left">
        <caption className="sr-only">{caption}</caption>
        {/* One set of column widths, so every phase's table lines up with the next. */}
        <colgroup>
          <col className="w-[8.5rem]" />
          <col />
          <col className="w-[9.5rem]" />
          <col className="w-[7.5rem]" />
          <col className="w-[7.5rem]" />
          <col className="w-[7.5rem]" />
          <col className="w-[5.5rem]" />
          <col className="w-[8.5rem]" />
          <col className="w-[4.5rem]" />
        </colgroup>
        <thead>
          <tr className="border-b border-line text-meta text-fg-muted">
            <th scope="col" className="px-4 py-2 font-medium">Status</th>
            <th scope="col" className="px-3 py-2 font-medium">Milestone</th>
            <th scope="col" className="px-3 py-2 font-medium">Owner</th>
            <th scope="col" className="px-3 py-2 font-medium">Baseline</th>
            <th scope="col" className="px-3 py-2 font-medium">Forecast</th>
            <th scope="col" className="px-3 py-2 font-medium">Actual</th>
            <th scope="col" className="px-3 py-2 font-medium">Variance</th>
            <th scope="col" className="px-3 py-2 font-medium">Progress</th>
            <th scope="col" className="px-4 py-2 font-medium">Tasks</th>
          </tr>
        </thead>
        <tbody>
          {milestones.map((milestone) => (
            <Row key={milestone.id} milestone={milestone} onOpen={onOpen} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MilestoneList({
  phases,
  milestones,
  sort,
  mobile,
  capabilities,
  filtered,
  onOpen,
  onOpenPhase,
}: {
  phases: PhaseSummaryDTO[];
  milestones: MilestoneSummaryDTO[];
  sort: SortKey;
  mobile: boolean;
  capabilities: PlanningCapabilities;
  filtered: boolean;
  onOpen: (id: string, panel?: DrawerPanel) => void;
  onOpenPhase: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({});
  if (!milestones.length) {
    return <EmptyState icon={<Flag />} title={filtered ? "No milestones match these filters." : "No milestones yet."} description={filtered ? "Clear a filter to see more of the plan." : "Add the key achievements and dates this project is working towards."} />;
  }

  const groups: Array<{ id: string; phase: PhaseSummaryDTO | null; milestones: MilestoneSummaryDTO[] }> =
    sort === "phase"
      ? [
          ...phases.map((phase) => ({ id: phase.id, phase, milestones: milestones.filter((milestone) => milestone.phaseId === phase.id) })).filter((group) => group.milestones.length),
          { id: "none", phase: null, milestones: milestones.filter((milestone) => !milestone.phaseId || !phases.some((phase) => phase.id === milestone.phaseId)) },
        ].filter((group) => group.milestones.length)
      : [{ id: "all", phase: null, milestones: sortMilestones(milestones, sort) }];

  return (
    <div className="space-y-3" data-testid="milestone-list">
      {groups.map((group) => {
        const open = !collapsed[group.id];
        const title = group.phase?.name ?? (sort === "phase" ? "No phase" : "All milestones");
        return (
          <section key={group.id} className={mobile ? "space-y-2" : "nesto-card overflow-hidden"} aria-label={title}>
            {sort === "phase" || !mobile ? (
              <header className={cn("flex items-center gap-3", mobile ? "px-1" : "border-b border-line bg-surface-muted/50 px-4 py-2.5")}>
                <button type="button" onClick={() => setCollapsed((current) => ({ ...current, [group.id]: open }))} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                  <ChevronDown aria-hidden="true" className={cn("size-4 shrink-0 text-fg-subtle transition-transform", !open && "-rotate-90")} />
                  <span className="truncate text-table font-semibold text-fg">{title}</span>
                  <span className="shrink-0 text-meta tabular-nums text-fg-muted">
                    {group.milestones.filter((milestone) => milestone.status === "COMPLETED").length}/{group.milestones.length}
                  </span>
                </button>
                {group.phase ? (
                  <>
                    <span className="hidden text-meta text-fg-muted sm:inline">{STATUS_LABELS[group.phase.status]}</span>
                    <ProgressBar value={group.phase.progressPercent ?? group.phase.suggestedProgress} label={`${group.phase.name} progress`} className="hidden w-24 sm:block" />
                    <Button type="button" variant="ghost" size="sm" onClick={() => onOpenPhase(group.phase!.id)}>
                      Phase
                    </Button>
                  </>
                ) : null}
              </header>
            ) : null}
            {open ? (
              mobile ? (
                <ul className="space-y-2">
                  {group.milestones.map((milestone) => (
                    <MobileCard key={milestone.id} milestone={milestone} capabilities={capabilities} onOpen={onOpen} />
                  ))}
                </ul>
              ) : (
                <Table milestones={group.milestones} onOpen={(id) => onOpen(id)} caption={title} />
              )
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
