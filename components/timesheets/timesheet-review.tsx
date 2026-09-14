"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil, RotateCcw, Stamp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { formatMinutes, weekLabel } from "@/lib/modules/timesheets/timesheet.time";
import type { TimesheetFormOptions, TimesheetWeekDTO } from "@/lib/modules/timesheets/timesheet.types";
import { failureMessage, timesheetApi } from "./timesheet-api";
import { TimesheetGrid } from "./timesheet-grid";
import { TimesheetHistory } from "./timesheet-history";
import { SummaryFigure, TimesheetStatusBadge, TimesheetWarnings } from "./timesheet-ui";

/**
 * One week as its reviewer sees it (PRD #42 §79, §117-§119, §122-§125): who,
 * which week, the totals and the grid, read-only; its history; the link to
 * decide it in Approvals for whoever may; and the controlled reopening of an
 * approved week, with a note, for HR and the Owner.
 */

const NO_OPTIONS: TimesheetFormOptions = { projects: [], recent: [] };

export function TimesheetReview({ week, discussion }: { week: TimesheetWeekDTO; discussion: React.ReactNode }) {
  const router = useRouter();
  const toast = useToast();
  const [reopening, setReopening] = React.useState(false);
  const [note, setNote] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function reopen() {
    if (note.trim().length < 3) {
      setError("Say why it is being reopened.");
      return;
    }
    setPending(true);
    try {
      await timesheetApi(`/api/timesheets/${week.id}/reopen`, { body: { note: note.trim() } });
      setReopening(false);
      setNote("");
      toast({ title: "Week reopened", description: `${week.member.name} can correct it and submit it again.`, tone: "success" });
      router.refresh();
    } catch (failure) {
      setError(failureMessage(failure));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-5" data-testid="timesheet-review">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-meta text-fg-muted">Timesheet</p>
          <h1 className="text-page font-semibold text-fg">
            {week.member.name} <span className="font-normal text-fg-muted">· {weekLabel(week.periodStart)}</span>
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <TimesheetStatusBadge status={week.status} />
          {week.capabilities.approvalHref ? (
            <Button asChild size="sm">
              <Link href={week.capabilities.approvalHref}>
                <Stamp aria-hidden="true" />
                Review in Approvals
              </Link>
            </Button>
          ) : null}
          {week.capabilities.isOwn && week.capabilities.canEdit ? (
            <Button asChild size="sm" variant="secondary">
              <Link href={`/timesheets?week=${week.periodStart}`}>
                <Pencil aria-hidden="true" />
                Edit in My Timesheet
              </Link>
            </Button>
          ) : null}
          {week.capabilities.canReopen ? (
            <Button size="sm" variant="secondary" onClick={() => setReopening(true)}>
              <RotateCcw aria-hidden="true" />
              Reopen
            </Button>
          ) : null}
        </div>
      </div>

      {week.decisionNote && (week.status === "RETURNED" || week.status === "REJECTED") ? (
        <div className="rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-table text-fg" role="status">
          <p className="font-medium">{week.status === "RETURNED" ? "Returned for correction" : "Rejected"}{week.decidedBy ? ` by ${week.decidedBy.name}` : ""}</p>
          <p className="mt-1 whitespace-pre-line text-fg-muted">“{week.decisionNote}”</p>
        </div>
      ) : null}

      <section aria-label="Week summary" className="nesto-card px-5 py-4">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-6">
          <SummaryFigure label="Total" value={formatMinutes(week.totals.totalMinutes)} testId="summary-total" />
          <SummaryFigure label="Expected" value={formatMinutes(week.totals.expectedMinutes)} tone="muted" />
          <SummaryFigure label="Billable" value={formatMinutes(week.totals.billableMinutes)} />
          <SummaryFigure label="Non-billable" value={formatMinutes(week.totals.nonBillableMinutes)} />
          <SummaryFigure label="Overtime" value={formatMinutes(week.totals.overtimeMinutes)} tone={week.totals.overtimeMinutes > 0 ? "warning" : "muted"} />
          <SummaryFigure label="Approver" value={week.approver?.name ?? week.expectedApprover?.name ?? "—"} tone="muted" />
        </dl>
        {week.totals.projects.length ? (
          <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-1 border-t border-line pt-3 text-table" aria-label="Time by project">
            {week.totals.projects.map((project) => (
              <li key={project.projectId ?? "internal"} className="flex items-baseline gap-2">
                <span className="text-fg-muted">{project.name}</span>
                <span className="font-medium tabular-nums text-fg">{formatMinutes(project.minutes)}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <TimesheetWarnings warnings={week.warnings} className="mt-4 border-t border-line pt-3" />
      </section>

      <TimesheetGrid
        week={week}
        rows={week.rows.map((row) => ({ ...row, template: false }))}
        editable={false}
        options={NO_OPTIONS}
        cellState={{}}
        onCommit={async () => false}
        onOpenEntries={() => undefined}
        onAddRow={() => undefined}
        onRemoveTemplate={() => undefined}
      />

      {week.logs.some((log) => log.description) ? (
        <section className="nesto-card px-5 py-4" aria-labelledby="timesheet-entries-title">
          <h2 id="timesheet-entries-title" className="text-card font-semibold text-fg">
            Entries
          </h2>
          <ul className="mt-3 divide-y divide-line">
            {week.logs.map((log) => (
              <li key={log.id} className="flex items-start gap-3 py-2.5">
                <span className="w-24 shrink-0 text-meta tabular-nums text-fg-muted">{log.workDate}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-table font-medium text-fg">{[log.project?.name, log.task?.title].filter(Boolean).join(" · ") || "Internal"}</span>
                  {log.description ? <span className="block whitespace-pre-line break-words text-table text-fg-muted">{log.description}</span> : null}
                </span>
                <span className="text-table font-medium tabular-nums text-fg">{formatMinutes(log.minutes)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        {week.history.length ? <TimesheetHistory history={week.history} zone={week.settings.timezone} /> : <div />}
        {discussion}
      </div>

      <Dialog open={reopening} onOpenChange={setReopening}>
        <DialogContent>
          <DialogTitle>Reopen this approved week?</DialogTitle>
          <DialogDescription>It goes back to {week.member.name} as returned, to correct and submit again. The approval stays in its history.</DialogDescription>
          <label htmlFor="reopen-note" className="mt-4 block text-table font-medium text-fg">
            Why
          </label>
          <Textarea id="reopen-note" className="mt-1.5" rows={3} value={note} onChange={(change) => { setNote(change.target.value); setError(null); }} aria-invalid={Boolean(error)} />
          {error ? <p className="mt-1 text-meta text-danger-strong">{error}</p> : null}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setReopening(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={() => void reopen()} disabled={pending}>
              {pending ? "Reopening…" : "Reopen week"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
