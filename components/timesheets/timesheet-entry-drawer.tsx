"use client";

import * as React from "react";
import { Trash2 } from "lucide-react";

import { selectClass } from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { dayLabel, formatMinutes, parseDuration } from "@/lib/modules/timesheets/timesheet.time";
import { WORK_LOG_TYPE_LABELS, WORK_LOG_TYPES, type TimesheetFormOptions, type TimesheetWeekDTO, type WorkLogDTO, type WorkLogType } from "@/lib/modules/timesheets/timesheet.types";
import { cn } from "@/lib/utils/cn";
import { failureMessage, isFailure, timesheetApi } from "./timesheet-api";

/**
 * The detailed entry (PRD #42 §48, §184, §185): one piece of work on one day,
 * with its project, task, duration and what was done. The same form creates
 * and edits, on a side panel at desktop and a bottom sheet on a phone.
 */

export type EntryDraft = {
  log?: WorkLogDTO;
  workDate?: string;
  workType?: WorkLogType;
  projectId?: string | null;
  taskId?: string | null;
};

type TaskOption = { id: string; title: string };

const QUICK_DURATIONS = [30, 60, 120, 240, 480];

export function useTaskOptions(projectId: string | null | undefined) {
  const [tasks, setTasks] = React.useState<TaskOption[]>([]);
  React.useEffect(() => {
    if (!projectId) {
      setTasks([]);
      return;
    }
    let live = true;
    timesheetApi<TaskOption[]>(`/api/timesheets/options/tasks?projectId=${encodeURIComponent(projectId)}`)
      .then((rows) => live && setTasks(rows))
      .catch(() => live && setTasks([]));
    return () => {
      live = false;
    };
  }, [projectId]);
  return tasks;
}

export function TimesheetEntryDrawer({
  open,
  onOpenChange,
  draft,
  week,
  options,
  side,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: EntryDraft | null;
  week: TimesheetWeekDTO;
  options: TimesheetFormOptions;
  side: "right" | "bottom";
  onSaved: (message: string) => Promise<void> | void;
}) {
  const toast = useToast();
  const editing = draft?.log;
  const selectable = week.days.filter((day) => (!day.future && !day.locked) || day.date === draft?.log?.workDate);
  const [workDate, setWorkDate] = React.useState("");
  const [workType, setWorkType] = React.useState<WorkLogType>("PROJECT_WORK");
  const [projectId, setProjectId] = React.useState("");
  const [taskId, setTaskId] = React.useState("");
  const [duration, setDuration] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [billable, setBillable] = React.useState<boolean | null>(null);
  const [overtime, setOvertime] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [pending, setPending] = React.useState(false);
  const tasks = useTaskOptions(projectId || null);

  React.useEffect(() => {
    if (!open || !draft) return;
    const log = draft.log;
    const fallbackDate = selectable.find((day) => day.date === week.today)?.date ?? selectable.at(-1)?.date ?? week.today;
    setWorkDate(log?.workDate ?? draft.workDate ?? fallbackDate);
    setWorkType(log?.workType ?? draft.workType ?? (options.projects.length ? "PROJECT_WORK" : "INTERNAL"));
    setProjectId(log?.project?.id ?? draft.projectId ?? "");
    setTaskId(log?.task?.id ?? draft.taskId ?? "");
    setDuration(log ? formatMinutes(log.minutes) : "");
    setDescription(log?.description ?? "");
    setBillable(log ? log.billable : null);
    setOvertime(log?.overtimeFlag ?? false);
    setErrors({});
    // Only when the panel opens with a new draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draft]);

  const minutes = parseDuration(duration);
  const effectiveBillable = billable ?? workType === "PROJECT_WORK";

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const found: Record<string, string> = {};
    if (!workDate) found.workDate = "Choose the day.";
    if (minutes === null) found.duration = "Enter a duration such as 2, 2.5, 2:30 or 1h 30m.";
    else if (minutes < 5 || minutes > 1440) found.duration = "An entry is between 5 minutes and 24 hours.";
    if (workType === "PROJECT_WORK" && !projectId) found.projectId = "Project work needs a project.";
    if (week.settings.descriptionsRequired && !description.trim()) found.description = "Describe the work.";
    setErrors(found);
    if (Object.keys(found).length) return;

    const body = {
      workDate,
      workType,
      projectId: projectId || null,
      taskId: projectId && taskId ? taskId : null,
      minutes: minutes!,
      description: description.trim() || null,
      ...(week.capabilities.canSetBillable ? { billable: effectiveBillable } : {}),
      overtimeFlag: overtime,
    };
    setPending(true);
    try {
      if (editing) await timesheetApi(`/api/worklogs/${editing.id}`, { method: "PATCH", body: { ...body, updatedAt: editing.updatedAt } });
      else await timesheetApi("/api/timesheets/worklogs", { body });
      onOpenChange(false);
      await onSaved(editing ? "Entry updated" : `${formatMinutes(minutes!)} logged`);
    } catch (error) {
      if (isFailure(error) && error.detailCode === "TIMESHEET_PROJECT_REQUIRED") setErrors({ projectId: error.message });
      else if (isFailure(error) && error.detailCode?.startsWith("TIMESHEET_TASK")) setErrors({ taskId: error.message });
      else if (isFailure(error) && (error.detailCode === "TIMESHEET_DAILY_LIMIT" || error.detailCode === "TIMESHEET_INCREMENT")) setErrors({ duration: error.message });
      else toast({ title: failureMessage(error), tone: "danger" });
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    if (!editing) return;
    setPending(true);
    try {
      await timesheetApi(`/api/worklogs/${editing.id}`, { method: "DELETE" });
      onOpenChange(false);
      await onSaved("Entry removed");
    } catch (error) {
      toast({ title: failureMessage(error), tone: "danger" });
    } finally {
      setPending(false);
    }
  }

  const fieldError = (key: string) =>
    errors[key] ? (
      <p id={`entry-${key}-error`} className="mt-1 text-meta text-danger-strong">
        {errors[key]}
      </p>
    ) : null;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent side={side} className={cn("bg-surface", side === "right" ? "sm:max-w-[440px]" : "")} aria-describedby="entry-drawer-description">
        <form onSubmit={save} className="flex min-h-full flex-col" noValidate>
          <div className="border-b border-line px-5 py-4">
            <DrawerTitle className="text-card font-semibold text-fg">{editing ? "Edit entry" : "Log time"}</DrawerTitle>
            <DrawerDescription id="entry-drawer-description" className="mt-0.5 text-meta text-fg-muted">
              {editing ? "Change what was logged, while the week is still yours to edit." : "What you worked on, on which day, and for how long."}
            </DrawerDescription>
          </div>

          <div className="flex-1 space-y-4 px-5 py-4">
            <div>
              <label htmlFor="entry-date" className="text-table font-medium text-fg">
                Day
              </label>
              <select id="entry-date" className={cn(selectClass, "mt-1.5")} value={workDate} onChange={(change) => setWorkDate(change.target.value)} aria-invalid={Boolean(errors.workDate)}>
                {selectable.map((day) => {
                  const label = dayLabel(day.date);
                  return (
                    <option key={day.date} value={day.date}>
                      {label.weekday} {label.day}
                      {day.date === week.today ? " (today)" : ""}
                    </option>
                  );
                })}
              </select>
              {fieldError("workDate")}
            </div>

            <div>
              <label htmlFor="entry-type" className="text-table font-medium text-fg">
                Work type
              </label>
              <select
                id="entry-type"
                className={cn(selectClass, "mt-1.5")}
                value={workType}
                onChange={(change) => {
                  setWorkType(change.target.value as WorkLogType);
                  setBillable(null);
                }}
              >
                {WORK_LOG_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {WORK_LOG_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="entry-project" className="text-table font-medium text-fg">
                  Project{workType === "PROJECT_WORK" ? "" : " (optional)"}
                </label>
                <select
                  id="entry-project"
                  className={cn(selectClass, "mt-1.5")}
                  value={projectId}
                  onChange={(change) => {
                    setProjectId(change.target.value);
                    setTaskId("");
                  }}
                  aria-invalid={Boolean(errors.projectId)}
                  aria-describedby={errors.projectId ? "entry-projectId-error" : undefined}
                >
                  <option value="">{workType === "PROJECT_WORK" ? "Choose a project" : "No project"}</option>
                  {options.projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.code ? `${project.code} · ` : ""}
                      {project.name}
                    </option>
                  ))}
                </select>
                {fieldError("projectId")}
              </div>
              <div>
                <label htmlFor="entry-task" className="text-table font-medium text-fg">
                  Task (optional)
                </label>
                <select id="entry-task" className={cn(selectClass, "mt-1.5")} value={taskId} onChange={(change) => setTaskId(change.target.value)} disabled={!projectId} aria-invalid={Boolean(errors.taskId)}>
                  <option value="">{projectId ? "No task" : "Choose a project first"}</option>
                  {tasks.map((task) => (
                    <option key={task.id} value={task.id}>
                      {task.title}
                    </option>
                  ))}
                </select>
                {fieldError("taskId")}
              </div>
            </div>

            <div>
              <label htmlFor="entry-duration" className="text-table font-medium text-fg">
                Duration
              </label>
              <Input
                id="entry-duration"
                className="mt-1.5 tabular-nums"
                inputMode="decimal"
                autoComplete="off"
                placeholder="2.5, 2:30 or 1h 30m"
                value={duration}
                onChange={(change) => setDuration(change.target.value)}
                aria-invalid={Boolean(errors.duration)}
                aria-describedby={errors.duration ? "entry-duration-error" : "entry-duration-hint"}
              />
              <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Quick durations">
                {QUICK_DURATIONS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setDuration(formatMinutes(value))}
                    className={cn("rounded-full border px-2.5 py-1 text-meta tabular-nums transition-colors", minutes === value ? "border-accent/40 bg-accent-soft text-accent-strong" : "border-line text-fg-muted hover:border-line-strong hover:text-fg")}
                  >
                    {formatMinutes(value)}
                  </button>
                ))}
              </div>
              {errors.duration ? fieldError("duration") : (
                <p id="entry-duration-hint" className="mt-1 text-meta text-fg-subtle">
                  {minutes !== null && minutes > 0 ? `${formatMinutes(minutes)}` : "Hours, hours and minutes, or minutes."}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="entry-description" className="text-table font-medium text-fg">
                Description{week.settings.descriptionsRequired ? "" : " (optional)"}
              </label>
              <Textarea id="entry-description" className="mt-1.5" rows={3} maxLength={2000} value={description} onChange={(change) => setDescription(change.target.value)} placeholder="What was done" aria-invalid={Boolean(errors.description)} />
              {fieldError("description")}
            </div>

            <div className="space-y-2.5">
              {week.capabilities.canSetBillable ? (
                <label className="flex items-center gap-2.5 text-table text-fg">
                  <Checkbox checked={effectiveBillable} onCheckedChange={(checked) => setBillable(checked === true)} aria-label="Billable" />
                  Billable
                </label>
              ) : (
                <p className="text-meta text-fg-muted">{effectiveBillable ? "Billable" : "Not billable"} — set by the work type.</p>
              )}
              <label className="flex items-center gap-2.5 text-table text-fg">
                <Checkbox checked={overtime} onCheckedChange={(checked) => setOvertime(checked === true)} aria-label="Overtime" />
                Overtime
              </label>
            </div>
          </div>

          <div className="sticky bottom-0 flex items-center gap-2 border-t border-line bg-surface px-5 py-3">
            {editing ? (
              <Button type="button" variant="ghost" size="sm" onClick={remove} disabled={pending} className="text-danger-strong hover:text-danger-strong">
                <Trash2 aria-hidden="true" />
                Remove
              </Button>
            ) : null}
            <span className="flex-1" />
            <Button type="button" variant="secondary" size="sm" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Saving…" : editing ? "Save" : "Log time"}
            </Button>
          </div>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
