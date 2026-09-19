import { PersonLink } from "@/components/people/person-link";
import { localDate, localTime } from "@/lib/modules/calendar/calendar.time";
import { dayLabel } from "@/lib/modules/timesheets/timesheet.time";
import type { TimesheetHistoryEntry } from "@/lib/modules/timesheets/timesheet.types";
import { cn } from "@/lib/utils/cn";

/**
 * The week's decision trail (PRD #42 §84-§86, §117-§119): every submission,
 * return, rejection, approval and reopening, oldest first, with its note.
 * Nothing is overwritten by a resubmission.
 */

const DOT: Record<TimesheetHistoryEntry["tone"], string> = {
  neutral: "bg-line-strong",
  info: "bg-info-strong",
  success: "bg-success-strong",
  warning: "bg-warning-strong",
  danger: "bg-danger-strong",
};

export function TimesheetHistory({ history, zone, className }: { history: TimesheetHistoryEntry[]; zone: string; className?: string }) {
  const when = (iso: string) => {
    const instant = new Date(iso);
    return `${dayLabel(localDate(instant, zone)).day}, ${localTime(instant, zone)}`;
  };
  return (
    <section aria-labelledby="timesheet-history-title" className={cn("nesto-card px-5 py-4", className)} data-testid="timesheet-history">
      <h2 id="timesheet-history-title" className="text-card font-semibold text-fg">
        History
      </h2>
      <ol className="mt-3 space-y-3">
        {history.map((entry) => (
          <li key={entry.id} className="flex gap-3">
            <span aria-hidden="true" className={cn("mt-1.5 size-2 shrink-0 rounded-full", DOT[entry.tone])} />
            <div className="min-w-0 flex-1">
              <p className="text-table text-fg">
                <span className="font-medium">{entry.action}</span>
                {entry.actorName ? (
                  <span className="text-fg-muted">
                    {" · "}
                    <PersonLink memberId={entry.actorMemberId} name={entry.actorName} />
                  </span>
                ) : null}
              </p>
              <p className="text-meta text-fg-subtle">
                <time dateTime={entry.occurredAt}>{when(entry.occurredAt)}</time>
              </p>
              {entry.note ? <p className="mt-1 whitespace-pre-line break-words text-table text-fg-muted">“{entry.note}”</p> : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
