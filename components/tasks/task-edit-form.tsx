"use client";

import * as React from "react";
import { useRouter } from "@/components/navigation/guarded-router";
import { ArchiveRestore, RefreshCw } from "lucide-react";

import type { FormActionResult, SelectOption } from "@/components/forms/record-form";
import Link from "@/components/navigation/nav-link";
import { TaskForm, type TaskFormValues } from "@/components/tasks/task-form";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { taskCommandAction, taskReviewSnapshotAction, type TaskReviewSnapshot } from "@/lib/actions/tasks";

/**
 * The task edit form with its conflict recovery (AUD-02 §7).
 *
 * The form is saved against the version it was loaded with. When another
 * change got there first, nothing is lost and nothing is merged behind the
 * person's back:
 *
 * - their draft stays in the form, and in memory — never in storage, so it
 *   does not follow them to another user or workspace;
 * - "Review latest" reads the task again, through their own scope, and shows
 *   the latest value beside theirs for the fields they changed;
 * - they tick which of their changes to reapply; the form is reloaded with the
 *   latest task, their ticked changes on top, and the latest version — and
 *   they save it themselves;
 * - an archived task offers only Restore; a task they can no longer open
 *   offers only a way out, and shows nothing of it.
 */

type FieldKey = keyof TaskFormValues;
type LatestTask = Extract<TaskReviewSnapshot, { access: "ok" }>["task"];

type Recovery =
  | { kind: "conflict" }
  | { kind: "unconfirmed" }
  | { kind: "loading" }
  | { kind: "review"; latest: LatestTask; choices: Partial<Record<FieldKey, boolean>> }
  | { kind: "archived"; latest: LatestTask }
  | { kind: "lost" };

const FIELDS: Array<{ key: FieldKey; label: string }> = [
  { key: "title", label: "Title" },
  { key: "description", label: "Description" },
  { key: "status", label: "Status" },
  { key: "priority", label: "Priority" },
  { key: "projectId", label: "Project" },
  { key: "assigneeMemberId", label: "Assignee" },
  { key: "startDate", label: "Start date" },
  { key: "dueDate", label: "Due date" },
];

const STATUS_LABEL: Record<string, string> = { TODO: "To Do", IN_PROGRESS: "In Progress", BLOCKED: "Blocked", COMPLETED: "Completed", ARCHIVED: "Archived" };
const PRIORITY_LABEL: Record<string, string> = { LOW: "Low", MEDIUM: "Medium", HIGH: "High", CRITICAL: "Critical" };

function valuesOf(formData: FormData): TaskFormValues {
  const read = (key: FieldKey) => {
    const value = formData.get(key);
    return typeof value === "string" ? value : "";
  };
  return {
    title: read("title").trim(),
    description: read("description").trim(),
    projectId: read("projectId"),
    assigneeMemberId: read("assigneeMemberId"),
    status: read("status"),
    priority: read("priority"),
    startDate: read("startDate"),
    dueDate: read("dueDate"),
  };
}

function latestValues(latest: LatestTask): TaskFormValues {
  const { title, description, projectId, assigneeMemberId, status, priority, startDate, dueDate } = latest.values;
  return { title, description, projectId, assigneeMemberId, status, priority, startDate, dueDate };
}

export function TaskEditForm({
  taskId,
  initial,
  version,
  projects,
  assignees,
  mayAssignOthers,
  cancelHref,
  action,
}: {
  taskId: string;
  initial: TaskFormValues;
  version: number;
  projects: SelectOption[];
  assignees: SelectOption[];
  mayAssignOthers: boolean;
  cancelHref: string;
  action: (formData: FormData) => Promise<FormActionResult>;
}) {
  const router = useRouter();
  const toast = useToast();
  // What the form was loaded with, and against which version it saves.
  // `saved`: the task's saved values when the form opens on reapplied changes,
  // which are unsaved until the next save commits (AUD-03 §3).
  const [base, setBase] = React.useState<{ values: TaskFormValues; saved?: TaskFormValues; version: number; key: number }>({ values: initial, version, key: 0 });
  // The person's unsaved values, kept when a save is refused.
  const draft = React.useRef<TaskFormValues | null>(null);
  const [recovery, setRecovery] = React.useState<Recovery | null>(null);
  const [applied, setApplied] = React.useState(false);
  const [busy, startBusy] = React.useTransition();
  const heading = React.useRef<HTMLHeadingElement>(null);

  React.useEffect(() => {
    if (recovery && recovery.kind !== "loading") heading.current?.focus();
  }, [recovery]);

  const labelOf = React.useCallback(
    (key: FieldKey, value: string, latest?: LatestTask): string => {
      if (value === "") return key === "projectId" ? "No project" : key === "assigneeMemberId" ? "Unassigned" : "—";
      if (key === "status") return STATUS_LABEL[value] ?? value;
      if (key === "priority") return PRIORITY_LABEL[value] ?? value;
      if (key === "projectId") {
        if (latest && latest.values.projectId === value) return latest.values.projectLabel;
        return projects.find((option) => option.value === value)?.label ?? "A project";
      }
      if (key === "assigneeMemberId") {
        if (latest && latest.values.assigneeMemberId === value) return latest.values.assigneeLabel;
        return assignees.find((option) => option.value === value)?.label ?? "A team member";
      }
      return value;
    },
    [projects, assignees],
  );

  function onFailure(result: Extract<FormActionResult, { ok: false }>, submitted: FormData): boolean {
    setApplied(false);
    if (result.code === "TASK_VERSION_CONFLICT" || result.code === "TASK_STATE_CONFLICT") {
      draft.current = valuesOf(submitted);
      setRecovery({ kind: "conflict" });
      return true;
    }
    if (result.code === "UNCONFIRMED") {
      draft.current = valuesOf(submitted);
      setRecovery({ kind: "unconfirmed" });
      return true;
    }
    // Access outranks a conflict on the server, so a task that went out of
    // sight while the form was open answers "not found" to the save itself.
    if (result.code === "NOT_FOUND" || result.code === "MODULE_UNAVAILABLE" || result.code === "MEMBERSHIP_INACTIVE") {
      draft.current = null;
      setRecovery({ kind: "lost" });
      return true;
    }
    return false;
  }

  function onSuccess(result: Extract<FormActionResult, { ok: true }>, mode: "normal" | "continue"): boolean {
    if (!(result as { lostAccess?: boolean }).lostAccess) return false;
    toast({ title: "Saved. You no longer have access to this task.", tone: "success" });
    // After Save and continue the person's own destination wins.
    if (mode === "normal" && result.redirectTo) router.push(result.redirectTo);
    return true;
  }

  function reviewLatest() {
    setRecovery({ kind: "loading" });
    startBusy(async () => {
      let snapshot: TaskReviewSnapshot;
      try {
        snapshot = await taskReviewSnapshotAction(taskId);
      } catch {
        setRecovery({ kind: "unconfirmed" });
        return;
      }
      if (snapshot.access === "lost") {
        setRecovery({ kind: "lost" });
        return;
      }
      if (snapshot.task.archived || !snapshot.task.canEdit) {
        setRecovery({ kind: "archived", latest: snapshot.task });
        return;
      }
      const latest = snapshot.task;
      const mine = draft.current ?? base.values;
      // Preselected: the changes nobody else touched. Where the latest task
      // changed the same field, the person decides with nothing ticked.
      const choices: Partial<Record<FieldKey, boolean>> = {};
      for (const { key } of FIELDS) {
        if (mine[key] === base.values[key]) continue;
        choices[key] = latest.values[key] === base.values[key];
      }
      setRecovery({ kind: "review", latest, choices });
    });
  }

  function applySelected(latest: LatestTask, choices: Partial<Record<FieldKey, boolean>>) {
    const mine = draft.current ?? base.values;
    const next = latestValues(latest);
    for (const [key, chosen] of Object.entries(choices) as Array<[FieldKey, boolean]>) {
      if (chosen) next[key] = mine[key];
    }
    draft.current = null;
    setBase((current) => ({ values: next, saved: latestValues(latest), version: latest.version, key: current.key + 1 }));
    setRecovery(null);
    setApplied(true);
  }

  function restore(latest: LatestTask) {
    startBusy(async () => {
      let result: Awaited<ReturnType<typeof taskCommandAction>>;
      try {
        result = await taskCommandAction(taskId, "restore", { expectedVersion: latest.version });
      } catch {
        setRecovery({ kind: "unconfirmed" });
        return;
      }
      if (!result.ok) {
        toast({ title: result.error, tone: "danger" });
        return;
      }
      toast({ title: "Task restored. Review the latest version before saving.", tone: "success" });
      // A new active snapshot has to be reviewed before the draft can be saved.
      reviewLatest();
    });
  }

  const notice = recovery ? (
    <section
      aria-labelledby="task-conflict-heading"
      className="space-y-3 rounded-xl border border-warning/30 bg-warning-soft p-5"
      data-testid="task-conflict"
    >
      {recovery.kind === "loading" ? (
        <p role="status" className="text-table text-fg">
          Reading the latest version…
        </p>
      ) : null}

      {recovery.kind === "conflict" || recovery.kind === "unconfirmed" ? (
        <>
          <h2 id="task-conflict-heading" ref={heading} tabIndex={-1} className="text-card font-semibold text-fg outline-none">
            {recovery.kind === "conflict" ? "Your changes have not been saved" : "We couldn't confirm the save"}
          </h2>
          <p role="alert" className="text-table text-fg">
            {recovery.kind === "conflict"
              ? "This task changed while you were editing. Your changes have not been saved."
              : "We couldn't confirm whether this change was saved. Check the latest task before trying again."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={reviewLatest} disabled={busy}>
              <RefreshCw aria-hidden="true" />
              Review latest
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => setRecovery(null)} disabled={busy}>
              Keep editing
            </Button>
          </div>
        </>
      ) : null}

      {recovery.kind === "review" ? (
        <ReviewLatest
          headingRef={heading}
          latest={recovery.latest}
          mine={draft.current ?? base.values}
          choices={recovery.choices}
          labelOf={labelOf}
          onToggle={(key, chosen) => setRecovery({ ...recovery, choices: { ...recovery.choices, [key]: chosen } })}
          onApply={() => applySelected(recovery.latest, recovery.choices)}
          onKeepEditing={() => setRecovery(null)}
        />
      ) : null}

      {recovery.kind === "archived" ? (
        <>
          <h2 id="task-conflict-heading" ref={heading} tabIndex={-1} className="text-card font-semibold text-fg outline-none">
            This task can no longer be edited
          </h2>
          <p role="alert" className="text-table text-fg">
            {recovery.latest.archived
              ? "It was archived while you were editing. Your changes are still in the form, but they can only be saved once the task is restored and you have reviewed it again."
              : "You can no longer edit it. Your changes are still in the form, but they cannot be saved."}
          </p>
          <div className="flex flex-wrap gap-2">
            {recovery.latest.archived && recovery.latest.canRestore ? (
              <Button type="button" size="sm" onClick={() => restore(recovery.latest)} disabled={busy}>
                <ArchiveRestore aria-hidden="true" />
                Restore task
              </Button>
            ) : null}
            <Button asChild size="sm" variant="secondary">
              <Link href={`/tasks/${taskId}`}>Open the task</Link>
            </Button>
          </div>
        </>
      ) : null}

      {recovery.kind === "lost" ? (
        <>
          <h2 id="task-conflict-heading" ref={heading} tabIndex={-1} className="text-card font-semibold text-fg outline-none">
            You can no longer open this task
          </h2>
          <p role="alert" className="text-table text-fg">
            Your changes have not been saved, and the task is no longer available to you.
          </p>
          <div>
            <Button asChild size="sm" variant="secondary">
              <Link href="/tasks">Go to tasks</Link>
            </Button>
          </div>
        </>
      ) : null}
    </section>
  ) : applied ? (
    <p role="status" className="rounded-md border border-info/30 bg-info-soft px-4 py-3 text-table text-fg" data-testid="task-conflict-applied">
      The form now shows the latest version of the task with the changes you chose. Review it and save.
    </p>
  ) : null;

  // A lost task shows nothing of itself any more; the draft stays out of sight too.
  if (recovery?.kind === "lost") {
    return <div className="space-y-5">{notice}</div>;
  }

  return (
    <TaskForm
      key={base.key}
      mode="edit"
      cancelHref={cancelHref}
      projects={projects}
      assignees={assignees}
      mayAssignOthers={mayAssignOthers}
      expectedVersion={base.version}
      baselineValues={base.saved}
      action={action}
      onFailure={onFailure}
      onSuccess={onSuccess}
      notice={notice}
      initial={base.values}
    />
  );
}

function ReviewLatest({
  headingRef,
  latest,
  mine,
  choices,
  labelOf,
  onToggle,
  onApply,
  onKeepEditing,
}: {
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  latest: LatestTask;
  mine: TaskFormValues;
  choices: Partial<Record<FieldKey, boolean>>;
  labelOf: (key: FieldKey, value: string, latest?: LatestTask) => string;
  onToggle: (key: FieldKey, chosen: boolean) => void;
  onApply: () => void;
  onKeepEditing: () => void;
}) {
  const changed = FIELDS.filter(({ key }) => key in choices);
  return (
    <>
      <h2 id="task-conflict-heading" ref={headingRef} tabIndex={-1} className="text-card font-semibold text-fg outline-none">
        Review the latest version
      </h2>
      <p role="status" className="text-table text-fg">
        {changed.length === 0
          ? "You had no unsaved changes. Load the latest version to continue."
          : "Choose which of your changes to apply to the latest version. Fields you did not change keep their latest values."}
      </p>
      {changed.length > 0 ? (
        <fieldset className="space-y-2">
          <legend className="sr-only">Your changes</legend>
          {changed.map(({ key, label }) => (
            <div key={key} className="grid gap-2 rounded-md border border-line bg-surface p-3 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_minmax(0,1fr)]" data-testid={`task-conflict-field-${key}`}>
              <label className="flex items-start gap-2 text-table font-medium text-fg">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 shrink-0 accent-[var(--color-accent)]"
                  checked={choices[key] === true}
                  onChange={(event) => onToggle(key, event.target.checked)}
                  aria-describedby={`conflict-${key}-latest conflict-${key}-mine`}
                />
                <span>Use my {label.toLowerCase()}</span>
              </label>
              <div id={`conflict-${key}-latest`} className="min-w-0">
                <p className="nesto-eyebrow text-fg-subtle">Latest</p>
                <p className="whitespace-pre-wrap break-words text-table text-fg">{labelOf(key, latest.values[key], latest)}</p>
              </div>
              <div id={`conflict-${key}-mine`} className="min-w-0">
                <p className="nesto-eyebrow text-fg-subtle">Yours</p>
                <p className="whitespace-pre-wrap break-words text-table text-fg">{labelOf(key, mine[key], latest)}</p>
              </div>
            </div>
          ))}
        </fieldset>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={onApply}>
          {changed.length === 0 ? "Load the latest version" : "Apply to the latest version"}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={onKeepEditing}>
          Keep editing
        </Button>
      </div>
    </>
  );
}
