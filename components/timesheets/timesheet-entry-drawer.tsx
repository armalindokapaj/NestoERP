"use client";

import * as React from "react";
import { Trash2 } from "lucide-react";

import { selectClass } from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useDialogClose } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useUnsavedEditor } from "@/components/unsaved/use-unsaved";
import { dayLabel, formatMinutes, parseDuration } from "@/lib/modules/timesheets/timesheet.time";
import { WORK_LOG_TYPE_LABELS, WORK_LOG_TYPES, type TimesheetFormOptions, type TimesheetWeekDTO, type WorkLogDTO, type WorkLogType } from "@/lib/modules/timesheets/timesheet.types";
import type { SaveOutcome } from "@/lib/unsaved/coordinator";
import { OUTCOME_COPY } from "@/lib/unsaved/outcome";
import { cn } from "@/lib/utils/cn";
import { failureMessage, isFailure, timesheetApi } from "./timesheet-api";
import { useTimesheetsTranslations } from "./timesheets-text";
import { timesheetsLabel } from "@/lib/i18n/modules/timesheets/labels";
import { FormSelect } from "@/components/ui/form-select";


/**
 * The detailed entry (PRD #42 §48, §184, §185): one piece of work on one day,
 * with its project, task, duration and what was done. The same form creates
 * and edits, on a side panel at desktop and a bottom sheet on a phone.
 *
 * The form lives inside the drawer, so every close — X, Escape, the backdrop,
 * Cancel — asks while it holds an unsaved entry (AUD-03 §5), and "Save and
 * continue" runs the same checks and save as its own button (§3).
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
  // The draft it opened with, kept while the panel animates closed; a new
  // draft is a new form.
  const shown = React.useRef<{ draft: EntryDraft; key: number } | null>(null);
  if (draft && draft !== shown.current?.draft) shown.current = { draft, key: (shown.current?.key ?? 0) + 1 };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent side={side} className={cn("bg-surface pb-0", side === "right" ? "sm:max-w-[440px]" : "")} aria-describedby="entry-drawer-description">
        {shown.current ? <EntryForm key={shown.current.key} draft={shown.current.draft} week={week} options={options} onDone={() => onOpenChange(false)} onSaved={onSaved} /> : null}
      </DrawerContent>
    </Drawer>
  );
}

type EntryValues = { workDate: string; workType: WorkLogType; projectId: string; taskId: string; duration: string; description: string; billable: boolean | null; overtime: boolean };

/** Mounted each time the panel opens, so it starts from the draft it was opened with. */
function EntryForm({
  draft,
  week,
  options,
  onDone,
  onSaved,
}: {
  draft: EntryDraft;
  week: TimesheetWeekDTO;
  options: TimesheetFormOptions;
  onDone: () => void;
  onSaved: (message: string) => Promise<void> | void;
}) {
  const toast = useToast();
  const t = useTimesheetsTranslations();
  const close = useDialogClose();
  const formRef = React.useRef<HTMLFormElement>(null);
  const running = React.useRef(false);
  const editing = draft.log;
  const selectable = week.days.filter((day) => (!day.future && !day.locked) || day.date === draft.log?.workDate);
  const [initial] = React.useState<EntryValues>(() => {
    const log = draft.log;
    const fallbackDate = selectable.find((day) => day.date === week.today)?.date ?? selectable.at(-1)?.date ?? week.today;
    return {
      workDate: log?.workDate ?? draft.workDate ?? fallbackDate,
      workType: log?.workType ?? draft.workType ?? (options.projects.length ? "PROJECT_WORK" : "INTERNAL"),
      projectId: log?.project?.id ?? draft.projectId ?? "",
      taskId: log?.task?.id ?? draft.taskId ?? "",
      duration: log ? formatMinutes(log.minutes) : "",
      description: log?.description ?? "",
      billable: log ? log.billable : null,
      overtime: log?.overtimeFlag ?? false,
    };
  });
  const [workDate, setWorkDate] = React.useState(initial.workDate);
  const [workType, setWorkType] = React.useState<WorkLogType>(initial.workType);
  const [projectId, setProjectId] = React.useState(initial.projectId);
  const [taskId, setTaskId] = React.useState(initial.taskId);
  const [duration, setDuration] = React.useState(initial.duration);
  const [description, setDescription] = React.useState(initial.description);
  const [billable, setBillable] = React.useState<boolean | null>(initial.billable);
  const [overtime, setOvertime] = React.useState(initial.overtime);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [pending, setPending] = React.useState(false);
  const tasks = useTaskOptions(projectId || null);

  const editor = useUnsavedEditor({
    module: "timesheets",
    saveKind: editing ? "save" : "create",
    label: editing ? t("entry.editorEdit") : t("entry.editorNew"),
    save: () => save("continue"),
    focus: () => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
  });
  const { setDirty, setSaving, setUnresolved } = editor;
  const dirty =
    workDate !== initial.workDate ||
    workType !== initial.workType ||
    projectId !== initial.projectId ||
    taskId !== initial.taskId ||
    duration !== initial.duration ||
    description !== initial.description ||
    billable !== initial.billable ||
    overtime !== initial.overtime;
  React.useEffect(() => setDirty(dirty), [dirty, setDirty]);

  const minutes = parseDuration(duration);
  const effectiveBillable = billable ?? workType === "PROJECT_WORK";

  async function save(mode: "normal" | "continue"): Promise<SaveOutcome> {
    if (running.current) return { kind: "unknown" };
    const found: Record<string, string> = {};
    if (!workDate) found.workDate = t("entry.chooseDay");
    if (minutes === null) found.duration = t("entry.durationFormat");
    else if (minutes < 5 || minutes > 1440) found.duration = t("entry.durationRange");
    if (workType === "PROJECT_WORK" && !projectId) found.projectId = t("entry.projectRequired");
    if (week.settings.descriptionsRequired && !description.trim()) found.description = t("entry.describe");
    setErrors(found);
    if (Object.keys(found).length) return { kind: "invalid" };

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
    running.current = true;
    setPending(true);
    setSaving(true);
    try {
      if (editing) await timesheetApi(`/api/worklogs/${editing.id}`, { method: "PATCH", body: { ...body, updatedAt: editing.updatedAt } });
      else await timesheetApi("/api/timesheets/worklogs", { body });
    } catch (error) {
      running.current = false;
      setPending(false);
      setSaving(false);
      // No answer: it may have been logged. Say so; never log it again on its own (§6).
      if (!isFailure(error) || error.status === 0) {
        setUnresolved(true);
        toast({ title: OUTCOME_COPY.unknown, tone: "danger" });
        return { kind: "unknown" };
      }
      if (error.detailCode === "TIMESHEET_PROJECT_REQUIRED") setErrors({ projectId: error.message });
      else if (error.detailCode?.startsWith("TIMESHEET_TASK")) setErrors({ taskId: error.message });
      else if (error.detailCode === "TIMESHEET_DAILY_LIMIT" || error.detailCode === "TIMESHEET_INCREMENT") setErrors({ duration: error.message });
      else toast({ title: failureMessage(error, t("common.somethingWrong")), tone: "danger" });
      return { kind: error.detailCode === "STALE_VERSION" || error.code === "CONFLICT" ? "conflict" : error.status === 403 || error.status === 404 ? "refused" : "invalid" };
    }
    running.current = false;
    setPending(false);
    setSaving(false);
    setUnresolved(false);
    setDirty(false);
    if (mode === "normal") onDone();
    await onSaved(editing ? t("entry.updated") : t("entry.logged", { time: formatMinutes(minutes!) }));
    return { kind: "committed" };
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    void save("normal");
  }

  async function remove() {
    if (!editing || running.current) return;
    running.current = true;
    setPending(true);
    setSaving(true);
    try {
      await timesheetApi(`/api/worklogs/${editing.id}`, { method: "DELETE" });
      setDirty(false);
      onDone();
      await onSaved(t("entry.removed"));
    } catch (error) {
      toast({ title: failureMessage(error, t("common.somethingWrong")), tone: "danger" });
    } finally {
      running.current = false;
      setPending(false);
      setSaving(false);
    }
  }

  const fieldError = (key: string) =>
    errors[key] ? (
      <p id={`entry-${key}-error`} className="mt-1 text-meta text-danger-strong">
        {errors[key]}
      </p>
    ) : null;

  return (
    <form ref={formRef} onSubmit={submit} className="flex min-h-full flex-col" noValidate>
      <div className="border-b border-line px-5 py-4">
        <DrawerTitle className="text-card font-semibold text-fg">{editing ? t("entry.editTitle") : t("week.logTime")}</DrawerTitle>
        <DrawerDescription id="entry-drawer-description" className="mt-0.5 text-meta text-fg-muted">
          {editing ? t("entry.editDescription") : t("entry.newDescription")}
        </DrawerDescription>
      </div>

      <div className="flex-1 space-y-4 px-5 py-4">
        <div>
          <label htmlFor="entry-date" className="text-table font-medium text-fg">
            {t("entry.day")}
          </label>
          <FormSelect id="entry-date" className={cn(selectClass, "mt-1.5")} value={workDate} onChange={(change) => setWorkDate(change.target.value)} aria-invalid={Boolean(errors.workDate)}>
            {selectable.map((day) => {
              const label = dayLabel(day.date);
              return (
                <option key={day.date} value={day.date}>
                  {label.weekday} {label.day}
                  {day.date === week.today ? t("entry.today") : ""}
                </option>
              );
            })}
          </FormSelect>
          {fieldError("workDate")}
        </div>

        <div>
          <label htmlFor="entry-type" className="text-table font-medium text-fg">
            {t("grid.workType")}
          </label>
          <FormSelect
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
                {timesheetsLabel(t, "workType", type, WORK_LOG_TYPE_LABELS[type])}
              </option>
            ))}
          </FormSelect>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="entry-project" className="text-table font-medium text-fg">
              {t("common.project")}{workType === "PROJECT_WORK" ? "" : t("entry.optional")}
            </label>
            <FormSelect
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
              <option value="">{workType === "PROJECT_WORK" ? t("grid.choosePlaceholder") : t("grid.noProject")}</option>
              {options.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.code ? `${project.code} · ` : ""}
                  {project.name}
                </option>
              ))}
            </FormSelect>
            {fieldError("projectId")}
          </div>
          <div>
            <label htmlFor="entry-task" className="text-table font-medium text-fg">
              {t("entry.taskOptional")}
            </label>
            <FormSelect id="entry-task" className={cn(selectClass, "mt-1.5")} value={taskId} onChange={(change) => setTaskId(change.target.value)} disabled={!projectId} aria-invalid={Boolean(errors.taskId)}>
              <option value="">{projectId ? t("grid.noTask") : t("entry.chooseProjectFirst")}</option>
              {tasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.title}
                </option>
              ))}
            </FormSelect>
            {fieldError("taskId")}
          </div>
        </div>

        <div>
          <label htmlFor="entry-duration" className="text-table font-medium text-fg">
            {t("entry.duration")}
          </label>
          <Input
            id="entry-duration"
            className="mt-1.5 tabular-nums"
            inputMode="decimal"
            autoComplete="off"
            placeholder={t("entry.durationPlaceholder")}
            value={duration}
            onChange={(change) => setDuration(change.target.value)}
            aria-invalid={Boolean(errors.duration)}
            aria-describedby={errors.duration ? "entry-duration-error" : "entry-duration-hint"}
          />
          <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label={t("entry.quickDurations")}>
            {QUICK_DURATIONS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setDuration(formatMinutes(value))}
                className={cn("inline-flex items-center rounded-full border px-2.5 py-1 text-meta tabular-nums transition-colors touch:min-h-11 touch:px-3.5", minutes === value ? "border-accent/40 bg-accent-soft text-accent-strong" : "border-line text-fg-muted hover:border-line-strong hover:text-fg")}
              >
                {formatMinutes(value)}
              </button>
            ))}
          </div>
          {errors.duration ? fieldError("duration") : (
            <p id="entry-duration-hint" className="mt-1 text-meta text-fg-subtle">
              {minutes !== null && minutes > 0 ? `${formatMinutes(minutes)}` : t("entry.durationHint")}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="entry-description" className="text-table font-medium text-fg">
            {t("entry.description")}{week.settings.descriptionsRequired ? "" : t("entry.optional")}
          </label>
          <Textarea id="entry-description" className="mt-1.5" rows={3} maxLength={2000} value={description} onChange={(change) => setDescription(change.target.value)} placeholder={t("entry.descriptionPlaceholder")} aria-invalid={Boolean(errors.description)} />
          {fieldError("description")}
        </div>

        <div className="space-y-2.5">
          {week.capabilities.canSetBillable ? (
            <label className="flex items-center gap-2.5 text-table text-fg">
              <Checkbox checked={effectiveBillable} onCheckedChange={(checked) => setBillable(checked === true)} aria-label={t("common.billable")} />
              {t("common.billable")}
            </label>
          ) : (
            <p className="text-meta text-fg-muted">{effectiveBillable ? t("common.billable") : t("common.notBillable")} {t("entry.setByType")}</p>
          )}
          <label className="flex items-center gap-2.5 text-table text-fg">
            <Checkbox checked={overtime} onCheckedChange={(checked) => setOvertime(checked === true)} aria-label={t("common.overtime")} />
            {t("common.overtime")}
          </label>
        </div>
      </div>

      {/* The footer carries the home-indicator inset itself: it is what sits on it (AUD-04 §6, D-07-04, MW-10). */}
      <div className="sticky bottom-0 flex items-center gap-2 border-t border-line bg-surface px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
        {editing ? (
          <Button type="button" variant="ghost" size="sm" onClick={remove} disabled={pending} className="text-danger-strong hover:text-danger-strong">
            <Trash2 aria-hidden="true" />
            {t("common.remove")}
          </Button>
        ) : null}
        <span className="flex-1" />
        <Button type="button" variant="secondary" size="sm" onClick={close} disabled={pending}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? t("common.saving") : editing ? t("common.save") : t("week.logTime")}
        </Button>
      </div>
    </form>
  );
}
