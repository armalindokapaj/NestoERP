"use client";

import * as React from "react";
import { ChevronRight } from "lucide-react";

import { addLocalDays, dateLabel, daysBetween, MONTHS, varianceLabel } from "@/lib/modules/project-planning/planning.dates";
import { STATUS_LABELS, type DependencyEdgeDTO, type MilestoneSummaryDTO, type PhaseSummaryDTO } from "@/lib/modules/project-planning/planning.types";
import { cn } from "@/lib/utils/cn";
import { markerColor } from "./planning-ui";

/**
 * The lightweight timeline (PRD #44 §97-§108, §160, §243-§245, §304).
 *
 * Phases as calm bars with their progress, milestones as diamonds on the date
 * that matters, a faint baseline marker with the variance beside it, today as a
 * thin line and dependencies as restrained connectors. Horizontal scroll with
 * the plan's structure pinned on the left; week, month or quarter zoom. It
 * edits nothing — a click opens the drawer, where dates change on purpose.
 * Past 200 rows only the rows in view are drawn.
 */

export type TimelineZoom = "week" | "month" | "quarter";

const ROW = 36;
const HEADER = 40;
const LEFT = 272;
const PX_PER_DAY: Record<TimelineZoom, number> = { week: 22, month: 5, quarter: 1.8 };
const PAD_DAYS: Record<TimelineZoom, number> = { week: 7, month: 21, quarter: 45 };
const VIRTUAL_THRESHOLD = 200;
const OVERSCAN = 12;

type Row =
  | { kind: "phase"; id: string; phase: PhaseSummaryDTO }
  | { kind: "group"; id: string; label: string }
  | { kind: "milestone"; id: string; milestone: MilestoneSummaryDTO };

export function defaultZoom(start: string | null, end: string | null): TimelineZoom {
  if (!start || !end) return "month";
  const span = daysBetween(start, end);
  return span <= 120 ? "week" : span <= 540 ? "month" : "quarter";
}

function ticks(start: string, end: string, zoom: TimelineZoom): Array<{ date: string; label: string; major: boolean }> {
  const result: Array<{ date: string; label: string; major: boolean }> = [];
  const [sy, sm] = start.split("-").map(Number);
  if (zoom === "week") {
    let day = start;
    const weekday = new Date(`${start}T12:00:00Z`).getUTCDay();
    day = addLocalDays(day, (8 - (weekday === 0 ? 7 : weekday)) % 7);
    while (day <= end) {
      const [, month, date] = day.split("-").map(Number);
      result.push({ date: day, label: `${date} ${MONTHS[month - 1]}`, major: date <= 7 });
      day = addLocalDays(day, 7);
    }
    return result;
  }
  let year = sy;
  let month = sm;
  for (let guard = 0; guard < 400; guard += 1) {
    const date = `${year}-${String(month).padStart(2, "0")}-01`;
    if (date > end) break;
    if (date >= start && (zoom === "month" || (month - 1) % 3 === 0)) {
      result.push({ date, label: zoom === "month" ? `${MONTHS[month - 1]}${month === 1 ? ` ${year}` : ""}` : `Q${Math.floor((month - 1) / 3) + 1} ${year}`, major: month === 1 });
    }
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return result;
}

export function PlanningTimeline({
  phases,
  milestones,
  dependencies,
  today,
  projectStart,
  projectEnd,
  zoom,
  onZoom,
  onOpenMilestone,
  onOpenPhase,
  showPhasesWithoutMatches = true,
}: {
  phases: PhaseSummaryDTO[];
  milestones: MilestoneSummaryDTO[];
  dependencies: DependencyEdgeDTO[];
  today: string;
  projectStart: string | null;
  projectEnd: string | null;
  zoom: TimelineZoom;
  onZoom: (zoom: TimelineZoom) => void;
  onOpenMilestone: (id: string) => void;
  onOpenPhase: (id: string) => void;
  showPhasesWithoutMatches?: boolean;
}) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = React.useState({ top: 0, height: 600 });
  const [hover, setHover] = React.useState<{ milestone: MilestoneSummaryDTO; x: number; y: number } | null>(null);

  const rows = React.useMemo<Row[]>(() => {
    const result: Row[] = [];
    for (const phase of phases) {
      const own = milestones.filter((milestone) => milestone.phaseId === phase.id);
      if (!own.length && !showPhasesWithoutMatches) continue;
      result.push({ kind: "phase", id: `phase:${phase.id}`, phase });
      for (const milestone of own) result.push({ kind: "milestone", id: milestone.id, milestone });
    }
    const loose = milestones.filter((milestone) => !milestone.phaseId || !phases.some((phase) => phase.id === milestone.phaseId));
    if (loose.length) {
      result.push({ kind: "group", id: "group:none", label: "No phase" });
      for (const milestone of loose) result.push({ kind: "milestone", id: milestone.id, milestone });
    }
    return result;
  }, [phases, milestones, showPhasesWithoutMatches]);

  const [start, end] = React.useMemo(() => {
    const dates = [today, projectStart, projectEnd, ...phases.flatMap((phase) => [phase.span?.start, phase.span?.end]), ...milestones.flatMap((milestone) => [milestone.displayDate, milestone.baselineDate])].filter((date): date is string => Boolean(date)).sort();
    const pad = PAD_DAYS[zoom];
    return [addLocalDays(dates[0], -pad), addLocalDays(dates[dates.length - 1], pad)];
  }, [today, projectStart, projectEnd, phases, milestones, zoom]);

  const perDay = PX_PER_DAY[zoom];
  const width = Math.max(600, Math.round((daysBetween(start, end) + 1) * perDay));
  const x = React.useCallback((date: string) => daysBetween(start, date) * perDay, [start, perDay]);
  const centre = (date: string) => x(date) + Math.max(perDay / 2, 0);
  const rowIndex = React.useMemo(() => new Map(rows.map((row, index) => [row.id, index])), [rows]);
  const virtual = rows.length > VIRTUAL_THRESHOLD;

  React.useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const update = () => setViewport({ top: element.scrollTop, height: element.clientHeight });
    update();
    element.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      element.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  // Open on today, not on the far left of a long plan.
  React.useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollLeft = Math.max(0, x(today) - (element.clientWidth - LEFT) / 3);
  }, [zoom, today, x]);

  const first = virtual ? Math.max(0, Math.floor((viewport.top - HEADER) / ROW) - OVERSCAN) : 0;
  const last = virtual ? Math.min(rows.length, Math.ceil((viewport.top + viewport.height) / ROW) + OVERSCAN) : rows.length;
  const visible = rows.slice(first, last);
  const heightPx = HEADER + rows.length * ROW;
  const tickList = ticks(start, end, zoom);
  const todayX = x(today) + perDay / 2;

  const edges = dependencies
    .map((edge) => {
      const from = milestones.find((milestone) => milestone.id === edge.predecessorId);
      const to = milestones.find((milestone) => milestone.id === edge.successorId);
      const fromRow = rowIndex.get(edge.predecessorId);
      const toRow = rowIndex.get(edge.successorId);
      if (!from?.displayDate || !to?.displayDate || fromRow === undefined || toRow === undefined) return null;
      if (virtual && (Math.max(fromRow, toRow) < first || Math.min(fromRow, toRow) > last)) return null;
      return { edge, x1: centre(from.displayDate) + 7, y1: fromRow * ROW + ROW / 2, x2: centre(to.displayDate) - 7, y2: toRow * ROW + ROW / 2 };
    })
    .filter((value): value is NonNullable<typeof value> => Boolean(value));

  return (
    <div className="nesto-card overflow-hidden" data-testid="planning-timeline">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <p className="text-table font-medium text-fg">Timeline</p>
        <span className="flex items-center gap-3 text-meta text-fg-muted" aria-hidden="true">
          <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-5 rounded-full bg-line" /> Phase</span>
          <span className="flex items-center gap-1.5"><span className="inline-block size-2.5 rotate-45 rounded-[2px] bg-accent" /> Milestone</span>
          <span className="flex items-center gap-1.5"><span className="inline-block size-2.5 rotate-45 rounded-[2px] border-[1.5px] border-fg-subtle bg-surface" /> Baseline</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-px bg-accent" /> Today</span>
        </span>
        <span className="flex-1" />
        <div role="group" aria-label="Zoom" className="flex rounded-md border border-line p-0.5">
          {(["week", "month", "quarter"] as const).map((level) => (
            <button key={level} type="button" onClick={() => onZoom(level)} aria-pressed={zoom === level} className={cn("rounded px-2.5 py-1 text-meta font-medium capitalize transition-colors", zoom === level ? "bg-accent-soft text-accent-strong" : "text-fg-muted hover:text-fg")}>
              {level}
            </button>
          ))}
        </div>
      </div>

      <div ref={scrollRef} className="relative max-h-[70vh] overflow-auto overscroll-contain" tabIndex={-1}>
        <div className="relative" style={{ width: LEFT + width, height: heightPx }}>
          {/* Header */}
          <div className="sticky top-0 z-20 flex border-b border-line bg-surface" style={{ height: HEADER, width: LEFT + width }}>
            <div className="sticky left-0 z-10 flex items-center border-r border-line bg-surface px-4 text-meta font-medium text-fg-muted" style={{ width: LEFT, minWidth: LEFT }}>
              Plan
            </div>
            <div className="relative" style={{ width }}>
              {tickList.map((tick) => (
                <span key={tick.date} className={cn("absolute top-0 flex h-full items-end border-l pb-2 pl-1.5 text-meta tabular-nums", tick.major ? "border-line-strong text-fg" : "border-line text-fg-muted")} style={{ left: x(tick.date) }}>
                  {tick.label}
                </span>
              ))}
            </div>
          </div>

          {/* Grid lines and today */}
          <div aria-hidden="true" className="pointer-events-none absolute bottom-0 z-0" style={{ left: LEFT, top: HEADER, width }}>
            {tickList.map((tick) => (
              <span key={tick.date} className={cn("absolute inset-y-0 border-l", tick.major ? "border-line" : "border-line/50")} style={{ left: x(tick.date) }} />
            ))}
            {today >= start && today <= end ? <span className="absolute inset-y-0 w-px bg-accent/70" style={{ left: todayX }} data-testid="timeline-today" /> : null}
          </div>

          {/* Dependencies */}
          <svg aria-hidden="true" className="pointer-events-none absolute z-[5]" style={{ left: LEFT, top: HEADER }} width={width} height={rows.length * ROW}>
            <defs>
              <marker id="planning-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0,0 L8,4 L0,8 z" fill="var(--color-line-strong)" />
              </marker>
              <marker id="planning-arrow-warning" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0,0 L8,4 L0,8 z" fill="var(--color-warning)" />
              </marker>
            </defs>
            {edges.map(({ edge, x1, y1, x2, y2 }) => {
              const bend = Math.max(x1 + 8, Math.min(x2 - 8, (x1 + x2) / 2));
              const path = x2 >= x1 + 16 ? `M${x1},${y1} H${bend} V${y2} H${x2}` : `M${x1},${y1} h8 V${(y1 + y2) / 2} H${x2 - 8} V${y2} H${x2}`;
              return <path key={edge.id} d={path} fill="none" stroke={edge.warning ? "var(--color-warning)" : "var(--color-line-strong)"} strokeWidth={1.25} strokeDasharray={edge.warning ? "4 3" : undefined} markerEnd={`url(#${edge.warning ? "planning-arrow-warning" : "planning-arrow"})`} />;
            })}
          </svg>

          {/* Rows */}
          {visible.map((row, offset) => {
            const index = first + offset;
            const top = HEADER + index * ROW;
            if (row.kind === "group") {
              return (
                <div key={row.id} className="absolute left-0 flex border-b border-line/60 bg-surface-muted/60" style={{ top, height: ROW, width: LEFT + width }}>
                  <div className="sticky left-0 z-10 flex items-center border-r border-line bg-surface-muted px-4 text-meta font-semibold uppercase tracking-wide text-fg-muted" style={{ width: LEFT, minWidth: LEFT }}>
                    {row.label}
                  </div>
                </div>
              );
            }
            if (row.kind === "phase") {
              const { phase } = row;
              const span = phase.span;
              const progress = phase.progressPercent ?? phase.suggestedProgress ?? 0;
              return (
                <div key={row.id} className="absolute left-0 flex border-b border-line/60 bg-surface-muted/40" style={{ top, height: ROW, width: LEFT + width }}>
                  <button type="button" onClick={() => onOpenPhase(phase.id)} className="sticky left-0 z-10 flex items-center gap-2 border-r border-line bg-surface-muted px-4 text-left text-table font-semibold text-fg hover:text-accent-strong" style={{ width: LEFT, minWidth: LEFT }} aria-label={`Phase ${phase.name}, ${STATUS_LABELS[phase.status]}, ${progress}% progress`}>
                    <ChevronRight aria-hidden="true" className="size-3.5 text-fg-subtle" />
                    <span className="truncate">{phase.name}</span>
                    <span className="ml-auto shrink-0 text-meta font-normal tabular-nums text-fg-muted">{phase.completedCount}/{phase.milestoneCount}</span>
                  </button>
                  <div className="relative" style={{ width }}>
                    {span ? (
                      <button
                        type="button"
                        onClick={() => onOpenPhase(phase.id)}
                        className="absolute top-1/2 h-3.5 -translate-y-1/2 overflow-hidden rounded-full border border-line-strong/60 bg-line/70 hover:border-line-strong"
                        style={{ left: x(span.start), width: Math.max(8, (daysBetween(span.start, span.end) + 1) * perDay) }}
                        title={`${phase.name}: ${dateLabel(span.start)} – ${dateLabel(span.end)} · ${STATUS_LABELS[phase.status]} · ${progress}%`}
                        aria-hidden="true"
                        tabIndex={-1}
                        data-testid="timeline-phase-bar"
                      >
                        <span className={cn("block h-full", phase.status === "DELAYED" ? "bg-danger/50" : phase.status === "AT_RISK" ? "bg-warning/50" : "bg-accent/45")} style={{ width: `${progress}%` }} />
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            }
            const { milestone } = row;
            const date = milestone.displayDate;
            const color = markerColor(milestone.status, milestone.delayed);
            const baselineShown = milestone.baselineDate && date && milestone.baselineDate !== date;
            const label = `${milestone.name}, ${date ? dateLabel(date) : "no date"}, ${milestone.delayed ? "Delayed" : STATUS_LABELS[milestone.status]}${milestone.critical ? ", critical" : ""}, ${varianceLabel(milestone.varianceDays)}`;
            return (
              <div key={row.id} className="absolute left-0 flex border-b border-line/40" style={{ top, height: ROW, width: LEFT + width }} data-testid="timeline-row">
                <button type="button" onClick={() => onOpenMilestone(milestone.id)} className="sticky left-0 z-10 flex items-center gap-2 border-r border-line bg-surface pl-9 pr-4 text-left text-table text-fg hover:text-accent-strong" style={{ width: LEFT, minWidth: LEFT }} aria-label={label}>
                  <span className="truncate">{milestone.name}</span>
                  {milestone.critical ? <span className="shrink-0 rounded border border-line-strong px-1 text-micro font-medium uppercase text-fg-muted">Critical</span> : null}
                </button>
                <div className="relative" style={{ width }}>
                  {baselineShown ? (
                    <>
                      <span aria-hidden="true" className="absolute top-1/2 h-px bg-fg-subtle/50" style={{ left: Math.min(centre(milestone.baselineDate!), centre(date!)), width: Math.abs(centre(date!) - centre(milestone.baselineDate!)) }} />
                      <span aria-hidden="true" className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[1px] border-[1.5px] border-fg-subtle bg-surface" style={{ left: centre(milestone.baselineDate!) }} title={`Baseline ${dateLabel(milestone.baselineDate)}`} />
                    </>
                  ) : null}
                  {date ? (
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-hidden="true"
                      onClick={() => onOpenMilestone(milestone.id)}
                      onMouseEnter={(event) => setHover({ milestone, x: event.clientX, y: event.clientY })}
                      onMouseLeave={() => setHover(null)}
                      className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] shadow-sm ring-2 ring-surface transition-transform hover:scale-125"
                      style={{ left: centre(date), background: milestone.status === "NOT_STARTED" ? "var(--color-surface)" : color, border: `1.5px solid ${color}` }}
                      data-testid="timeline-marker"
                    />
                  ) : null}
                  {date && milestone.varianceDays ? (
                    <span className={cn("absolute top-1/2 -translate-y-1/2 pl-3 text-micro tabular-nums", milestone.varianceDays > 0 ? "text-danger-strong" : "text-success-strong")} style={{ left: Math.max(centre(date), milestone.baselineDate ? centre(milestone.baselineDate) : 0) }} aria-hidden="true">
                      {milestone.varianceDays > 0 ? "+" : "-"}
                      {Math.abs(milestone.varianceDays)}d
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {hover ? (
        <div role="tooltip" className="pointer-events-none fixed z-[70] w-64 rounded-lg border border-line bg-surface px-3 py-2 shadow-dialog" style={{ left: Math.min(hover.x + 14, window.innerWidth - 272), top: hover.y + 14 }}>
          <p className="text-table font-medium text-fg">{hover.milestone.name}</p>
          <p className="text-meta text-fg-muted">
            {hover.milestone.status === "COMPLETED" ? "Achieved" : "Forecast"} {dateLabel(hover.milestone.displayDate)} · {hover.milestone.delayed ? "Delayed" : STATUS_LABELS[hover.milestone.status]}
          </p>
          <p className="text-meta text-fg-muted">
            {hover.milestone.owner ? hover.milestone.owner.name : "No owner"} · {varianceLabel(hover.milestone.varianceDays)}
          </p>
        </div>
      ) : null}
    </div>
  );
}
