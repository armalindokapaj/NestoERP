"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "next/navigation";
import { CalendarDays, Check, ChevronLeft, ChevronRight, Copy, MessageSquare, Pencil, Plus, Send, Stamp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/toast";
import { PersonLink } from "@/components/people/person-link";
import { addLocalDays, dayLabel, formatMinutes, weekLabel } from "@/lib/modules/timesheets/timesheet.time";
import { WORK_LOG_TYPE_LABELS, type TimesheetFormOptions, type TimesheetWeekDTO, type WorkLogDTO } from "@/lib/modules/timesheets/timesheet.types";
import { cn } from "@/lib/utils/cn";
import { failureMessage, isFailure, timesheetApi } from "./timesheet-api";
import { isLeavingForWorkspaceSwitch, setWorkspaceDirtyState } from "@/lib/workspace/client";
import { TimesheetEntryDrawer, type EntryDraft } from "./timesheet-entry-drawer";
import { TimesheetGrid, type CellCommit, type RowTemplate } from "./timesheet-grid";
import { TimesheetHistory } from "./timesheet-history";
import { SummaryFigure, TimesheetStatusBadge, TimesheetWarnings } from "./timesheet-ui";

/**
 * My Timesheet (PRD #42 §43-§57, §66-§69, §182-§209).
 *
 * The week at a glance — what is logged, what was expected, where it went —
 * then the grid to fill it in on a desktop, or day cards with a quick log on a
 * phone. Everything saves as it goes; Submit sends the week to its approver
 * and locks it. A returned week says why, and is editable again.
 */

type SaveState = "idle" | "saving" | "saved" | "error";

function useMediaQuery(query: string): boolean {
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

export function TimesheetWeek({ initial, options, basePath = "/timesheets" }: { initial: TimesheetWeekDTO; options: TimesheetFormOptions; basePath?: string }) {
  const router = useRouter();
  const toast = useToast();
  const desktop = useMediaQuery("(min-width: 1024px)");
  const [week, setWeek] = React.useState(initial);
  const [templates, setTemplates] = React.useState<RowTemplate[]>([]);
  const [cellState, setCellState] = React.useState<Record<string, "saving" | "error">>({});
  const [saveState, setSaveState] = React.useState<SaveState>("idle");
  const [draft, setDraft] = React.useState<EntryDraft | null>(null);
  const [entries, setEntries] = React.useState<{ date: string; logIds: string[] } | null>(null);
  const [confirmShortfall, setConfirmShortfall] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const inflight = React.useRef(0);

  React.useEffect(() => {
    setWeek(initial);
    setTemplates([]);
  }, [initial]);

  const editable = week.capabilities.canEdit;
  const pendingSaves = Object.values(cellState).some((state) => state === "saving");

  // Leaving with a cell still saving would lose it (§208).
  React.useEffect(() => {
    if (!pendingSaves) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (!isLeavingForWorkspaceSwitch()) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pendingSaves]);

  React.useEffect(() => {
    setWorkspaceDirtyState(pendingSaves);
    return () => setWorkspaceDirtyState(false);
  }, [pendingSaves]);

  const refresh = React.useCallback(async () => {
    const next = await timesheetApi<TimesheetWeekDTO>(`/api/timesheets/me?week=${week.periodStart}`);
    setWeek(next);
    setTemplates((current) => current.filter((template) => !next.rows.some((row) => row.key === template.key)));
    return next;
  }, [week.periodStart]);

  async function afterSave(message?: string) {
    try {
      await refresh();
      setSaveState("saved");
      if (message) toast({ title: message, tone: "success" });
    } catch (error) {
      toast({ title: failureMessage(error), tone: "danger" });
    }
  }

  async function commitCell({ row, date, minutes }: CellCommit): Promise<boolean> {
    const key = `${row.key}@${date}`;
    setCellState((current) => ({ ...current, [key]: "saving" }));
    setSaveState("saving");
    inflight.current += 1;
    try {
      await timesheetApi("/api/timesheets/cells", { method: "PUT", body: { workDate: date, workType: row.workType, projectId: row.project?.id ?? null, taskId: row.task?.id ?? null, minutes } });
      setCellState((current) => Object.fromEntries(Object.entries(current).filter(([cell]) => cell !== key)));
      await refresh();
      setSaveState("saved");
      return true;
    } catch (error) {
      setCellState((current) => ({ ...current, [key]: "error" }));
      setSaveState("error");
      toast({ title: failureMessage(error, "That time could not be saved."), tone: "danger" });
      return false;
    } finally {
      inflight.current -= 1;
    }
  }

  async function submit(acknowledgeShortfall: boolean) {
    if (!week.id) return;
    if (!acknowledgeShortfall && week.totals.totalMinutes < week.totals.expectedMinutes) {
      setConfirmShortfall(true);
      return;
    }
    setSubmitting(true);
    try {
      const next = await timesheetApi<TimesheetWeekDTO>(`/api/timesheets/${week.id}/submit`, { body: { expectedVersion: week.version, acknowledgeShortfall } });
      setWeek(next);
      setConfirmShortfall(false);
      toast({ title: "Week submitted", description: next.approver ? `${next.approver.name} will review it.` : undefined, tone: "success" });
      router.refresh();
    } catch (error) {
      if (isFailure(error) && error.detailCode === "TIMESHEET_BELOW_EXPECTED") setConfirmShortfall(true);
      else {
        setConfirmShortfall(false);
        toast({ title: failureMessage(error), tone: "danger" });
        if (isFailure(error) && error.detailCode === "STALE_VERSION") void refresh();
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function copyLastWeek(withDurations: boolean) {
    try {
      const result = await timesheetApi<{ rows: Array<Omit<RowTemplate, "key"> & { projectId: string | null; taskId: string | null }>; copied: number; skipped: number }>("/api/timesheets/copy-week", {
        body: { week: week.periodStart, withDurations },
      });
      if (withDurations) {
        await refresh();
        toast({ title: result.copied ? `Copied ${result.copied} ${result.copied === 1 ? "entry" : "entries"}` : "Nothing to copy", description: result.skipped ? `${result.skipped} could not be copied — a future day, or a project no longer open to you.` : undefined, tone: result.copied ? "success" : "default" });
        return;
      }
      if (result.rows.length === 0) {
        toast({ title: "Last week has no rows to copy." });
        return;
      }
      const known = new Set([...week.rows.map((row) => row.key), ...templates.map((row) => row.key)]);
      const added: RowTemplate[] = result.rows
        .map((row) => ({ key: `${row.workType}|${row.projectId ?? ""}|${row.taskId ?? ""}`, workType: row.workType, project: row.project, task: row.task }))
        .filter((row) => !known.has(row.key));
      setTemplates((current) => [...current, ...added]);
      toast({ title: added.length ? `Added ${added.length} ${added.length === 1 ? "row" : "rows"} from last week` : "Last week's rows are already here." });
    } catch (error) {
      toast({ title: failureMessage(error), tone: "danger" });
    }
  }

  const rows = React.useMemo(
    () => [
      ...week.rows.map((row) => ({ ...row, template: false })),
      ...templates.filter((template) => !week.rows.some((row) => row.key === template.key)).map((template) => ({ ...template, days: {}, totalMinutes: 0, billableMinutes: 0, template: true })),
    ],
    [week.rows, templates],
  );

  const logsById = new Map(week.logs.map((log) => [log.id, log]));
  const periodEnd = week.periodEnd;
  const isCurrent = week.today >= week.periodStart && week.today <= periodEnd;
  const shortfall = Math.max(0, week.totals.expectedMinutes - week.totals.totalMinutes);
  const nav = (offset: number) => `${basePath}?week=${addLocalDays(week.periodStart, offset * 7)}`;
  const openLog = (log: WorkLogDTO) => setDraft({ log });

  return (
    <div className="space-y-5 pb-24 lg:pb-0" data-testid="timesheet-week">
      {/* Week navigation, status and the save indicator (§56, §57, §207) */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Button asChild variant="secondary" size="icon-sm">
            <Link href={nav(-1)} aria-label="Previous week">
              <ChevronLeft />
            </Link>
          </Button>
          <Button asChild variant="secondary" size="icon-sm">
            <Link href={nav(1)} aria-label="Next week" aria-disabled={isCurrent} className={cn(isCurrent && "pointer-events-none opacity-50")} tabIndex={isCurrent ? -1 : undefined}>
              <ChevronRight />
            </Link>
          </Button>
        </div>
        <h2 className="text-section font-semibold text-fg" data-testid="timesheet-week-label">
          {weekLabel(week.periodStart)}
        </h2>
        <TimesheetStatusBadge status={week.status} />
        {!isCurrent ? (
          <Link href={basePath} className="text-table font-medium text-accent-strong hover:underline">
            This week
          </Link>
        ) : null}
        <span className="flex-1" />
        <span className="text-meta text-fg-muted" aria-live="polite" data-testid="save-indicator">
          {saveState === "saving" || pendingSaves ? "Saving…" : saveState === "saved" ? (
            <span className="inline-flex items-center gap-1">
              <Check className="size-3.5 text-success-strong" aria-hidden="true" /> Saved
            </span>
          ) : saveState === "error" ? (
            <span className="text-danger-strong">Not saved</span>
          ) : null}
        </span>
        {editable ? (
          <div className="hidden items-center gap-2 lg:flex">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="sm">
                  <Copy aria-hidden="true" />
                  Copy last week
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void copyLastWeek(false)}>Rows only</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void copyLastWeek(true)}>Rows and hours</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="secondary" size="sm" onClick={() => setDraft({})}>
              <Plus aria-hidden="true" />
              Log time
            </Button>
            {week.capabilities.canSubmit ? (
              <Button size="sm" onClick={() => void submit(false)} disabled={submitting || !week.id || week.logs.length === 0 || pendingSaves}>
                <Send aria-hidden="true" />
                {week.status === "DRAFT" ? "Submit week" : "Resubmit week"}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <StatusBanner week={week} />

      {/* The week summary (§56, §210) */}
      <section aria-label="Week summary" className="nesto-card px-5 py-4">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-6">
          <SummaryFigure label="Total" value={formatMinutes(week.totals.totalMinutes)} testId="summary-total" />
          <SummaryFigure label="Expected" value={formatMinutes(week.totals.expectedMinutes)} tone="muted" />
          <SummaryFigure label="Billable" value={formatMinutes(week.totals.billableMinutes)} />
          <SummaryFigure label="Non-billable" value={formatMinutes(week.totals.nonBillableMinutes)} />
          <SummaryFigure label="Overtime" value={formatMinutes(week.totals.overtimeMinutes)} tone={week.totals.overtimeMinutes > 0 ? "warning" : "muted"} />
          <SummaryFigure label={shortfall > 0 ? "Still to log" : "Balance"} value={shortfall > 0 ? formatMinutes(shortfall) : "On track"} tone="muted" />
        </dl>
        {week.totals.projects.length ? (
          <div className="mt-4 border-t border-line pt-3">
            <div className="flex h-2 overflow-hidden rounded-full bg-hover" aria-hidden="true">
              {week.totals.projects.map((project, index) => (
                <span key={project.projectId ?? "internal"} className={cn("h-full", index % 3 === 0 ? "bg-accent" : index % 3 === 1 ? "bg-accent/60" : "bg-accent/30", !project.projectId && "bg-line-strong")} style={{ width: `${(project.minutes / Math.max(1, week.totals.totalMinutes)) * 100}%` }} />
              ))}
            </div>
            <ul className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-table" aria-label="Time by project">
              {week.totals.projects.map((project) => (
                <li key={project.projectId ?? "internal"} className="flex items-baseline gap-2">
                  <span className="text-fg-muted">{project.name}</span>
                  <span className="font-medium tabular-nums text-fg">{formatMinutes(project.minutes)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <TimesheetWarnings warnings={week.warnings} className="mt-4 border-t border-line pt-3" />
      </section>

      {/* Desktop grid, or day cards on smaller screens (§45, §183, §189) */}
      <div className="hidden lg:block">
        <TimesheetGrid
          week={week}
          rows={rows}
          editable={editable}
          options={options}
          cellState={cellState}
          onCommit={commitCell}
          onOpenEntries={(logIds, date) => setEntries({ logIds, date })}
          onAddRow={(row) => setTemplates((current) => (current.some((entry) => entry.key === row.key) || week.rows.some((entry) => entry.key === row.key) ? current : [...current, row]))}
          onRemoveTemplate={(key) => setTemplates((current) => current.filter((row) => row.key !== key))}
        />
      </div>

      <div className="space-y-3 lg:hidden" data-testid="timesheet-days">
        {week.days.map((day) => {
          const label = dayLabel(day.date);
          const logs = week.logs.filter((log) => log.workDate === day.date);
          const canLog = editable && !day.future && !day.locked;
          if (day.future && logs.length === 0) return null;
          return (
            <section key={day.date} className={cn("nesto-card px-4 py-3", day.date === week.today && "ring-1 ring-accent/30")} aria-label={`${label.weekday} ${label.day}`} data-testid="timesheet-day">
              <header className="flex items-center gap-2">
                <h3 className="text-card font-semibold text-fg">
                  {label.weekday} <span className="font-normal text-fg-muted">{label.day}</span>
                </h3>
                {day.date === week.today ? <span className="text-micro font-medium uppercase tracking-wide text-accent-strong">Today</span> : null}
                {day.leave ? <span className="text-meta text-info-strong">{day.leave.label}</span> : null}
                <span className="flex-1" />
                <span className="text-body font-semibold tabular-nums text-fg">{day.totalMinutes ? formatMinutes(day.totalMinutes) : "–"}</span>
              </header>
              {logs.length ? (
                <ul className="mt-2 divide-y divide-line">
                  {logs.map((log) => (
                    <li key={log.id}>
                      <button type="button" disabled={!editable} onClick={() => openLog(log)} className="flex w-full items-start gap-3 py-2.5 text-left disabled:cursor-default">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-table font-medium text-fg">{log.project?.name ?? WORK_LOG_TYPE_LABELS[log.workType]}</span>
                          <span className="block truncate text-meta text-fg-muted">{[log.task?.title, log.description].filter(Boolean).join(" · ") || WORK_LOG_TYPE_LABELS[log.workType]}</span>
                        </span>
                        <span className="text-table font-medium tabular-nums text-fg">{formatMinutes(log.minutes)}</span>
                        {editable ? <Pencil className="mt-0.5 size-3.5 text-fg-subtle" aria-hidden="true" /> : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {canLog ? (
                <Button type="button" variant="ghost" size="sm" className="mt-1 -ml-2 text-accent-strong" onClick={() => setDraft({ workDate: day.date })}>
                  <Plus aria-hidden="true" />
                  Log time
                </Button>
              ) : null}
            </section>
          );
        })}
      </div>

      {week.history.length ? <TimesheetHistory history={week.history} zone={week.settings.timezone} /> : null}

      {week.id ? (
        <p className="text-table text-fg-muted">
          <Link href={`/timesheets/${week.id}`} className="inline-flex items-center gap-1.5 font-medium text-accent-strong hover:underline">
            <MessageSquare className="size-4" aria-hidden="true" />
            Open the discussion
          </Link>
        </p>
      ) : null}

      {/* Sticky actions on a phone (§187) */}
      {editable ? (
        <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t border-line bg-surface/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur lg:hidden" data-testid="timesheet-sticky-actions">
          <div className="min-w-0">
            <p className="text-meta text-fg-muted">This week</p>
            <p className="text-body font-semibold tabular-nums text-fg">
              {formatMinutes(week.totals.totalMinutes)} <span className="font-normal text-fg-muted">of {formatMinutes(week.totals.expectedMinutes)}</span>
            </p>
          </div>
          <span className="flex-1" />
          <Button type="button" variant="secondary" size="icon" onClick={() => setDraft({})} aria-label="Log time">
            <Plus />
          </Button>
          {week.capabilities.canSubmit ? (
            <Button type="button" onClick={() => void submit(false)} disabled={submitting || !week.id || week.logs.length === 0}>
              <Send aria-hidden="true" />
              Submit
            </Button>
          ) : null}
        </div>
      ) : null}

      <TimesheetEntryDrawer
        open={draft !== null}
        onOpenChange={(open) => !open && setDraft(null)}
        draft={draft}
        week={week}
        options={options}
        side={desktop ? "right" : "bottom"}
        onSaved={(message) => afterSave(message)}
      />

      <Dialog open={entries !== null} onOpenChange={(open) => !open && setEntries(null)}>
        <DialogContent className="max-w-md">
          <DialogTitle>{entries ? `${dayLabel(entries.date).weekday} ${dayLabel(entries.date).day}` : "Entries"}</DialogTitle>
          <DialogDescription>Each entry is kept as it was logged. Open one to change it.</DialogDescription>
          <ul className="mt-4 divide-y divide-line">
            {(entries?.logIds ?? []).map((id) => logsById.get(id)).filter((log): log is WorkLogDTO => Boolean(log)).map((log) => (
              <li key={log.id}>
                <button
                  type="button"
                  className="flex w-full items-start gap-3 py-2.5 text-left hover:bg-hover"
                  onClick={() => {
                    setEntries(null);
                    openLog(log);
                  }}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-table font-medium text-fg">{log.task?.title ?? log.project?.name ?? WORK_LOG_TYPE_LABELS[log.workType]}</span>
                    <span className="block truncate text-meta text-fg-muted">{log.description ?? "No description"}</span>
                  </span>
                  <span className="text-table font-medium tabular-nums">{formatMinutes(log.minutes)}</span>
                </button>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmShortfall}
        onOpenChange={setConfirmShortfall}
        title="Submit a short week?"
        description={`You logged ${formatMinutes(week.totals.totalMinutes)} of the expected ${formatMinutes(week.totals.expectedMinutes)}. Submit it anyway?`}
        confirmLabel="Submit anyway"
        destructive={false}
        pending={submitting}
        onConfirm={() => void submit(true)}
      />
    </div>
  );
}

function StatusBanner({ week }: { week: TimesheetWeekDTO }) {
  const decided = week.decidedBy ? <PersonLink memberId={week.decidedBy.memberId} name={week.decidedBy.name} /> : null;
  const approver = week.approver ? <PersonLink memberId={week.approver.memberId} name={week.approver.name} /> : null;
  if (week.status === "SUBMITTED") {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-info/30 bg-info-soft px-4 py-3 text-table text-fg" role="status" data-testid="timesheet-banner">
        <Send className="size-4 text-info-strong" aria-hidden="true" />
        <span className="flex-1">
          {week.capabilities.isOwn ? <>Submitted{approver ? <> to {approver}</> : null}. Its entries are locked until it is decided.</> : <>Waiting for {approver ?? "its approver"}.</>}
        </span>
        {week.capabilities.approvalHref ? (
          <Button asChild size="sm">
            <Link href={week.capabilities.approvalHref}>
              <Stamp aria-hidden="true" />
              Review in Approvals
            </Link>
          </Button>
        ) : null}
      </div>
    );
  }
  if (week.status === "APPROVED") {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-success/30 bg-success-soft px-4 py-3 text-table text-fg" role="status" data-testid="timesheet-banner">
        <Check className="size-4 text-success-strong" aria-hidden="true" />
        <span>Approved{decided ? <> by {decided}</> : null}. The week is locked.</span>
      </div>
    );
  }
  if (week.status === "RETURNED" || week.status === "REJECTED") {
    return (
      <div className="rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-table text-fg" role="status" data-testid="timesheet-banner">
        <p className="font-medium">
          {week.status === "RETURNED" ? "Returned for correction" : "Rejected"}
          {decided ? <> by {decided}</> : null}
        </p>
        {week.decisionNote ? <p className="mt-1 whitespace-pre-line text-fg-muted">“{week.decisionNote}”</p> : null}
        {week.capabilities.isOwn ? <p className="mt-1 text-fg-muted">Correct the week and submit it again.</p> : null}
      </div>
    );
  }
  if (week.capabilities.isOwn && !week.expectedApprover) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted" role="status">
        <CalendarDays className="size-4" aria-hidden="true" />
        Nobody is set to approve your timesheets yet. You can log time; ask HR to assign an approver before you submit.
      </div>
    );
  }
  return null;
}
