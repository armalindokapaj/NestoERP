"use client";

import * as React from "react";
import { Plus, X } from "lucide-react";

import { selectClass } from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import { dayLabel, formatMinutes, parseDuration } from "@/lib/modules/timesheets/timesheet.time";
import { WORK_LOG_TYPE_LABELS, WORK_LOG_TYPES, type TimesheetFormOptions, type TimesheetRowDTO, type TimesheetWeekDTO, type WorkLogType } from "@/lib/modules/timesheets/timesheet.types";
import { cn } from "@/lib/utils/cn";
import { useTaskOptions } from "./timesheet-entry-drawer";
import { hoursValue } from "./timesheet-ui";

/**
 * The weekly grid (PRD #42 §43, §45, §47, §190-§195, §204-§207).
 *
 * Rows are project, task and work type; columns are the days. A cell holds the
 * row's time that day and saves when you leave it — Tab moves on, Enter saves,
 * Escape puts it back. A day with several entries on one row shows its total
 * and opens the entries rather than merging them. Days in the future or past
 * the backdating window are not editable, and approved leave is marked in the
 * column header.
 */

export type RowTemplate = { key: string; workType: WorkLogType; project: TimesheetRowDTO["project"]; task: TimesheetRowDTO["task"] };

export type CellCommit = { row: RowTemplate; date: string; minutes: number };

function rowLabel(row: RowTemplate) {
  return {
    primary: row.project ? row.project.name : WORK_LOG_TYPE_LABELS[row.workType],
    secondary: row.project ? [row.task?.title, row.workType === "PROJECT_WORK" ? null : WORK_LOG_TYPE_LABELS[row.workType]].filter(Boolean).join(" · ") || row.project.code || "Project work" : row.task?.title ?? null,
  };
}

function Cell({
  row,
  date,
  minutes,
  logIds,
  disabled,
  state,
  onCommit,
  onOpenEntries,
}: {
  row: RowTemplate;
  date: string;
  minutes: number;
  logIds: string[];
  disabled: boolean;
  state: "idle" | "saving" | "error";
  onCommit: (commit: CellCommit) => Promise<boolean>;
  onOpenEntries: (logIds: string[], date: string) => void;
}) {
  const [value, setValue] = React.useState(hoursValue(minutes));
  const [invalid, setInvalid] = React.useState(false);
  const label = dayLabel(date);
  const name = `${rowLabel(row).primary}${row.task ? `, ${row.task.title}` : ""}, ${label.weekday} ${label.day}`;

  React.useEffect(() => {
    setValue(hoursValue(minutes));
    setInvalid(false);
  }, [minutes]);

  if (logIds.length > 1) {
    return (
      <button
        type="button"
        onClick={() => onOpenEntries(logIds, date)}
        className="h-9 w-full rounded-md border border-dashed border-line-strong px-2 text-right text-table tabular-nums text-fg hover:bg-hover"
        aria-label={`${name}: ${formatMinutes(minutes)} in ${logIds.length} entries`}
        title={`${logIds.length} entries — open to edit them`}
      >
        {hoursValue(minutes)}
        <span className="ml-1 text-micro text-fg-subtle">×{logIds.length}</span>
      </button>
    );
  }

  async function commit() {
    const trimmed = value.trim();
    const next = trimmed === "" ? 0 : parseDuration(trimmed);
    if (next === null || next > 1440 || (next > 0 && next < 5)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (next === minutes) {
      setValue(hoursValue(minutes));
      return;
    }
    const ok = await onCommit({ row, date, minutes: next });
    if (!ok) setValue(hoursValue(minutes));
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      aria-label={name}
      aria-invalid={invalid || state === "error"}
      title={invalid ? "Enter hours like 2.5, 2:30 or 1h 30m" : undefined}
      disabled={disabled}
      value={value}
      data-cell={`${row.key}@${date}`}
      onChange={(change) => setValue(change.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          (event.target as HTMLInputElement).blur();
        } else if (event.key === "Escape") {
          setValue(hoursValue(minutes));
          setInvalid(false);
        }
      }}
      className={cn(
        "h-9 w-full rounded-md border bg-surface px-2 text-right text-table tabular-nums text-fg transition-colors",
        "placeholder:text-fg-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20",
        "disabled:cursor-not-allowed disabled:border-transparent disabled:bg-transparent disabled:text-fg-muted",
        invalid || state === "error" ? "border-danger" : "border-line",
        state === "saving" && "opacity-60",
      )}
    />
  );
}

export function TimesheetGrid({
  week,
  rows,
  editable,
  options,
  cellState,
  onCommit,
  onOpenEntries,
  onAddRow,
  onRemoveTemplate,
}: {
  week: TimesheetWeekDTO;
  rows: Array<RowTemplate & { days: TimesheetRowDTO["days"]; totalMinutes: number; billableMinutes: number; template: boolean }>;
  editable: boolean;
  options: TimesheetFormOptions;
  cellState: Record<string, "saving" | "error">;
  onCommit: (commit: CellCommit) => Promise<boolean>;
  onOpenEntries: (logIds: string[], date: string) => void;
  onAddRow: (row: RowTemplate) => void;
  onRemoveTemplate: (key: string) => void;
}) {
  return (
    <div className="nesto-card overflow-hidden" data-testid="timesheet-grid">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse text-table">
          <caption className="sr-only">Time logged for {week.member.name}, by project and day</caption>
          <thead>
            <tr className="border-b border-line bg-surface-muted/60">
              <th scope="col" className="w-[28%] px-4 py-2.5 text-left text-meta font-medium text-fg-muted">
                Project / task
              </th>
              {week.days.map((day) => {
                const label = dayLabel(day.date);
                const today = day.date === week.today;
                return (
                  <th key={day.date} scope="col" className={cn("px-1.5 py-2 text-right text-meta font-medium", today ? "text-accent-strong" : "text-fg-muted")}>
                    <span className="block">{label.weekday}</span>
                    <span className={cn("block tabular-nums", today ? "font-semibold" : "font-normal text-fg-subtle")}>{label.day}</span>
                    {day.leave ? (
                      <span className="mt-0.5 block truncate text-micro font-medium text-info-strong" title={day.leave.label}>
                        {day.leave.label}
                      </span>
                    ) : null}
                  </th>
                );
              })}
              <th scope="col" className="px-4 py-2.5 text-right text-meta font-medium text-fg-muted">
                Total
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-body text-fg-muted">
                  {editable ? "No time logged this week. Add a row, or log time for a day." : "No time was logged this week."}
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const label = rowLabel(row);
                return (
                  <tr key={row.key} className="group hover:bg-row-hover" data-testid="timesheet-row">
                    <th scope="row" className="px-4 py-2 text-left font-normal">
                      <span className="flex items-center gap-2">
                        <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", row.billableMinutes > 0 ? "bg-accent" : "bg-line-strong")} title={row.billableMinutes > 0 ? "Billable" : "Not billable"} />
                        <span className="min-w-0">
                          <span className="block truncate text-table font-medium text-fg">{label.primary}</span>
                          {label.secondary ? <span className="block truncate text-meta text-fg-muted">{label.secondary}</span> : null}
                        </span>
                        {row.template && editable ? (
                          <button type="button" onClick={() => onRemoveTemplate(row.key)} className="ml-auto rounded p-1 text-fg-subtle opacity-0 hover:bg-hover hover:text-fg group-hover:opacity-100 focus:opacity-100" aria-label={`Remove the empty row ${label.primary}`}>
                            <X className="size-3.5" />
                          </button>
                        ) : null}
                      </span>
                    </th>
                    {week.days.map((day) => {
                      const cell = row.days[day.date] ?? { minutes: 0, logIds: [] };
                      const key = `${row.key}@${day.date}`;
                      return (
                        <td key={day.date} className={cn("px-1 py-1.5", day.date === week.today && "bg-accent-soft/30")}>
                          {editable ? (
                            <Cell
                              row={row}
                              date={day.date}
                              minutes={cell.minutes}
                              logIds={cell.logIds}
                              disabled={(day.future || day.locked) && cell.logIds.length === 0}
                              state={cellState[key] ?? "idle"}
                              onCommit={onCommit}
                              onOpenEntries={onOpenEntries}
                            />
                          ) : (
                            <span className="block px-2 text-right tabular-nums text-fg">{hoursValue(cell.minutes)}</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="whitespace-nowrap px-4 py-2 text-right font-medium tabular-nums text-fg" data-testid="row-total">
                      {formatMinutes(row.totalMinutes)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          <tfoot>
            <tr className="border-t border-line-strong bg-surface-muted/40">
              <th scope="row" className="px-4 py-2.5 text-left text-meta font-medium text-fg-muted">
                Daily total
              </th>
              {week.days.map((day) => (
                <td key={day.date} className={cn("whitespace-nowrap px-2.5 py-2.5 text-right text-table font-medium tabular-nums", day.totalMinutes > 720 ? "text-warning-strong" : "text-fg")} data-testid={`day-total-${day.date}`}>
                  {day.totalMinutes ? formatMinutes(day.totalMinutes) : <span className="text-fg-subtle">–</span>}
                </td>
              ))}
              <td className="whitespace-nowrap px-4 py-2.5 text-right text-table font-semibold tabular-nums text-fg" data-testid="week-total">
                {formatMinutes(week.totals.totalMinutes)}
              </td>
            </tr>
            {week.days.some((day) => day.attendanceMinutes) ? (
              // Attendance beside the time, for comparison only — it never becomes an entry (§98, §99).
              <tr className="bg-surface-muted/40">
                <th scope="row" className="px-4 pb-2.5 text-left text-meta font-normal text-fg-subtle">
                  Attendance
                </th>
                {week.days.map((day) => (
                  <td key={day.date} className="whitespace-nowrap px-2.5 pb-2.5 text-right text-meta tabular-nums text-fg-subtle">
                    {day.attendanceMinutes ? formatMinutes(day.attendanceMinutes) : ""}
                  </td>
                ))}
                <td />
              </tr>
            ) : null}
          </tfoot>
        </table>
      </div>
      {editable ? <AddRow options={options} recent={options.recent} existing={new Set(rows.map((row) => row.key))} onAdd={onAddRow} /> : null}
    </div>
  );
}

function AddRow({ options, recent, existing, onAdd }: { options: TimesheetFormOptions; recent: TimesheetFormOptions["recent"]; existing: Set<string>; onAdd: (row: RowTemplate) => void }) {
  const [open, setOpen] = React.useState(false);
  const [workType, setWorkType] = React.useState<WorkLogType>(options.projects.length ? "PROJECT_WORK" : "INTERNAL");
  const [projectId, setProjectId] = React.useState("");
  const [taskId, setTaskId] = React.useState("");
  const tasks = useTaskOptions(projectId || null);
  const [error, setError] = React.useState<string | null>(null);

  const keyOf = (type: string, project?: string | null, task?: string | null) => `${type}|${project ?? ""}|${task ?? ""}`;
  const suggestions = recent.filter((row) => !existing.has(keyOf(row.workType, row.project?.id, row.task?.id)));

  function add() {
    if (workType === "PROJECT_WORK" && !projectId) {
      setError("Choose the project.");
      return;
    }
    const project = options.projects.find((row) => row.id === projectId) ?? null;
    const task = tasks.find((row) => row.id === taskId) ?? null;
    onAdd({ key: keyOf(workType, project?.id, task?.id), workType, project, task: task ? { id: task.id, title: task.title } : null });
    setProjectId("");
    setTaskId("");
    setError(null);
    setOpen(false);
  }

  return (
    <div className="border-t border-line px-4 py-3">
      {open ? (
        <div className="flex flex-wrap items-end gap-2" data-testid="add-row-form">
          <label className="flex min-w-[9rem] flex-1 flex-col">
            <span className="text-meta text-fg-muted">Work type</span>
            <select className={cn(selectClass, "mt-1 h-9")} value={workType} onChange={(change) => setWorkType(change.target.value as WorkLogType)} aria-label="Row work type">
              {WORK_LOG_TYPES.map((type) => (
                <option key={type} value={type}>
                  {WORK_LOG_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-[12rem] flex-[2] flex-col">
            <span className="text-meta text-fg-muted">Project</span>
            <select
              className={cn(selectClass, "mt-1 h-9")}
              value={projectId}
              onChange={(change) => {
                setProjectId(change.target.value);
                setTaskId("");
                setError(null);
              }}
              aria-label="Row project"
              aria-invalid={Boolean(error)}
            >
              <option value="">{workType === "PROJECT_WORK" ? "Choose a project" : "No project"}</option>
              {options.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.code ? `${project.code} · ` : ""}
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-[12rem] flex-[2] flex-col">
            <span className="text-meta text-fg-muted">Task</span>
            <select className={cn(selectClass, "mt-1 h-9")} value={taskId} onChange={(change) => setTaskId(change.target.value)} disabled={!projectId} aria-label="Row task">
              <option value="">No task</option>
              {tasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.title}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={add}>
              Add row
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
          {error ? <p className="w-full text-meta text-danger-strong">{error}</p> : null}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)}>
            <Plus aria-hidden="true" />
            Add row
          </Button>
          {suggestions.length ? <span className="text-meta text-fg-subtle">Recent:</span> : null}
          {suggestions.slice(0, 5).map((row) => (
            <button
              key={keyOf(row.workType, row.project?.id, row.task?.id)}
              type="button"
              onClick={() => onAdd({ key: keyOf(row.workType, row.project?.id, row.task?.id), workType: row.workType, project: row.project, task: row.task })}
              className="max-w-[16rem] truncate rounded-full border border-line px-2.5 py-1 text-meta text-fg-muted transition-colors hover:border-line-strong hover:text-fg"
            >
              {row.project?.name ?? WORK_LOG_TYPE_LABELS[row.workType]}
              {row.task ? ` · ${row.task.title}` : ""}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
