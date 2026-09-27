"use client";

import * as React from "react";

import {
  Field,
  FormSection,
  RecordForm,
  selectClass,
  useFieldErrors,
  type FormActionResult,
  type SelectOption,
} from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { taskAssigneeOptionsAction } from "@/lib/actions/tasks";

/**
 * Create / edit task form (PRD #11 §42, §43, §61).
 *
 * Three groups — details, assignment, schedule — rather than one long column
 * of inputs. Completion and archiving are absent on purpose: they are dedicated
 * actions on the record page, not form fields (PRD #11 §61).
 */
export type TaskFormValues = {
  title: string;
  description: string;
  projectId: string;
  assigneeMemberId: string;
  status: string;
  priority: string;
  startDate: string;
  dueDate: string;
};

const STATUS_OPTIONS: SelectOption[] = [
  { value: "TODO", label: "To Do" },
  { value: "IN_PROGRESS", label: "In Progress" },
  { value: "BLOCKED", label: "Blocked" },
  { value: "COMPLETED", label: "Completed" },
];

const PRIORITY_OPTIONS: SelectOption[] = [
  { value: "LOW", label: "Low" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High" },
  { value: "CRITICAL", label: "Critical" },
];

export function TaskForm({
  mode,
  initial,
  projects,
  assignees,
  mayAssignOthers,
  statuses = STATUS_OPTIONS,
  cancelHref,
  expectedVersion,
  action,
  onFailure,
  onSuccess,
  notice,
  parent,
  baselineValues,
  legacyProject,
  legacyAssignee,
  assigneesFor,
}: {
  mode: "create" | "edit";
  initial: TaskFormValues;
  projects: SelectOption[];
  assignees: SelectOption[];
  /** Without task.assign the picker offers the current user only (PRD #11 §122). */
  mayAssignOthers: boolean;
  statuses?: SelectOption[];
  cancelHref: string;
  /** The version the person is editing (AUD-02 §3); every save names it. */
  expectedVersion?: number;
  action: (formData: FormData) => Promise<FormActionResult>;
  onFailure?: (result: Extract<FormActionResult, { ok: false }>, submitted: FormData) => void | boolean;
  onSuccess?: (result: Extract<FormActionResult, { ok: true }>, mode: "normal" | "continue") => void | boolean;
  /** The saved values when the form opens on reapplied changes (AUD-03 §3 rule 7). */
  baselineValues?: TaskFormValues;
  /** Shown above the fields: the conflict review, when a save lost to another change. */
  notice?: React.ReactNode;
  /**
   * The record this task is raised from (PRD #38 §45-§47). Either locked — the
   * page was opened from that record — or chosen from records the server
   * offered. Submitted as `type:id`; the server re-reads it either way.
   */
  parent?: { locked: { value: string; label: string } } | { options: SelectOption[]; label: string };
  /**
   * The saved project or assignee when the pickers can no longer offer it — an
   * archived project, an inactive member (AUD-09 §5, FV-10). Shown so a save
   * nobody touched cannot quietly clear it; never offered for a new choice.
   */
  legacyProject?: SelectOption;
  legacyAssignee?: SelectOption;
  /** The project `assignees` was read for, when it may not be `initial.projectId`; they are read again if not. */
  assigneesFor?: string;
}) {
  return (
    <RecordForm
      action={action}
      cancelHref={cancelHref}
      onFailure={onFailure}
      onSuccess={onSuccess}
      module="tasks"
      saveKind={mode === "create" ? "create" : "save"}
      baselineValues={baselineValues}
      submitLabel={mode === "create" ? "Create task" : "Save changes"}
      pendingLabel={mode === "create" ? "Creating…" : "Saving…"}
    >
      {expectedVersion !== undefined ? <input type="hidden" name="expectedVersion" value={expectedVersion} /> : null}
      {notice}
      <FormSection title="Task details">
        {parent && "locked" in parent ? (
          <div className="sm:col-span-2">
            <input type="hidden" name="parent" value={parent.locked.value} />
            <p className="rounded-md bg-surface-muted px-3 py-2 text-table text-fg" data-testid="task-parent-locked">
              <span className="text-fg-muted">Raised from </span>
              {parent.locked.label}
            </p>
          </div>
        ) : null}
        {parent && "options" in parent ? (
          <div className="sm:col-span-2">
            <Field label={parent.label} name="parent" required>
              <select id="parent" name="parent" defaultValue="" required className={selectClass}>
                <option value="" disabled>
                  Choose a record
                </option>
                {parent.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        ) : null}
        <div className="sm:col-span-2">
          <Field label="Title" name="title" required>
            <TitleInput defaultValue={initial.title} />
          </Field>
        </div>

        <div className="sm:col-span-2">
          <Field label="Description" name="description">
            <Textarea
              id="description"
              name="description"
              rows={4}
              defaultValue={initial.description}
              maxLength={10_000}
            />
          </Field>
        </div>

        <Field label="Status" name="status" required>
          <select id="status" name="status" defaultValue={initial.status} className={selectClass}>
            {/* Blocked is set by Mark blocked, which asks why (PRD #38 §44). */}
            {statuses.filter((option) => option.value !== "BLOCKED" || initial.status === "BLOCKED").map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Priority" name="priority" required>
          <select
            id="priority"
            name="priority"
            defaultValue={initial.priority}
            className={selectClass}
          >
            {PRIORITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      </FormSection>

      <AssignmentFields
        key={`${initial.projectId}:${initial.assigneeMemberId}`}
        projects={projects}
        assignees={assignees}
        mayAssignOthers={mayAssignOthers}
        initialProjectId={initial.projectId}
        initialAssigneeId={initial.assigneeMemberId}
        legacyProject={legacyProject}
        legacyAssignee={legacyAssignee}
        assigneesFor={assigneesFor ?? initial.projectId}
      />

      <ScheduleFields initialStart={initial.startDate} initialDue={initial.dueDate} />
    </RecordForm>
  );
}

/** Split out so the invalid state can read the shared field-error context. */
function TitleInput({ defaultValue }: { defaultValue: string }) {
  const errors = useFieldErrors();
  return (
    <Input
      id="title"
      name="title"
      defaultValue={defaultValue}
      required
      maxLength={200}
      aria-invalid={Boolean(errors.title)}
      aria-describedby={errors.title ? "title-error" : undefined}
    />
  );
}

type PickerState =
  | { state: "ready"; options: SelectOption[] }
  | { state: "loading" }
  | { state: "error"; message: string };

/**
 * Project → assignee, a dependent picker (AUD-09 §5, FV-08, FV-09).
 *
 * The assignee options are the chosen project's team, asked for again each
 * time the project changes. While they load, or when they could not be read,
 * the assignee cannot be changed — the value shown is still what is sent, in a
 * hidden input, so a save meanwhile sends exactly what the person sees and the
 * server judges it. A slow answer for an earlier project is ignored (request
 * generation). An assignee still on the new team is kept; one who is not is
 * cleared, with a note saying so. Nothing is ever selected on the person's
 * behalf. The server re-checks the pair regardless (PRD #11 §48).
 */
function AssignmentFields({
  projects,
  assignees,
  mayAssignOthers,
  initialProjectId,
  initialAssigneeId,
  legacyProject,
  legacyAssignee,
  assigneesFor,
}: {
  projects: SelectOption[];
  assignees: SelectOption[];
  mayAssignOthers: boolean;
  initialProjectId: string;
  initialAssigneeId: string;
  legacyProject?: SelectOption;
  legacyAssignee?: SelectOption;
  assigneesFor: string;
}) {
  const [projectId, setProjectId] = React.useState(initialProjectId);
  const [assigneeId, setAssigneeId] = React.useState(initialAssigneeId);
  const [picker, setPicker] = React.useState<PickerState>({ state: "ready", options: assignees });
  const [note, setNote] = React.useState<string | null>(null);
  const generation = React.useRef(0);
  const assigneeRef = React.useRef(initialAssigneeId);
  assigneeRef.current = assigneeId;

  // The saved assignee the team list no longer offers stays visible on the
  // saved project only; on another project the server would refuse it.
  const showLegacyAssignee = Boolean(legacyAssignee) && projectId === initialProjectId;

  const labelOf = React.useCallback(
    (value: string, options: SelectOption[]) =>
      options.find((option) => option.value === value)?.label ??
      (legacyAssignee?.value === value ? legacyAssignee.label : null) ??
      assignees.find((option) => option.value === value)?.label ??
      "The assignee",
    [assignees, legacyAssignee],
  );

  const load = React.useCallback(
    (nextProjectId: string) => {
      const mine = ++generation.current;
      setPicker({ state: "loading" });
      taskAssigneeOptionsAction(nextProjectId || null).then(
        (result) => {
          if (mine !== generation.current) return; // an older project's answer
          if (!result.ok) {
            setPicker({ state: "error", message: result.error });
            return;
          }
          setPicker({ state: "ready", options: result.options });
          const current = assigneeRef.current;
          const keep =
            current === "" ||
            result.options.some((option) => option.value === current) ||
            (legacyAssignee?.value === current && nextProjectId === initialProjectId);
          if (!keep) {
            setNote(`${labelOf(current, result.options).replace(/ — .*$/, "")} is not on this project's team, so the assignee was cleared.`);
            setAssigneeId("");
          }
        },
        () => {
          if (mine !== generation.current) return;
          setPicker({ state: "error", message: "Couldn't load the people for this project." });
        },
      );
    },
    [initialProjectId, labelOf, legacyAssignee],
  );

  // Options read for another project than the one the form opens on — a
  // conflict review that reloaded the latest task — are read again.
  const stale = assigneesFor !== initialProjectId;
  React.useEffect(() => {
    if (stale) load(initialProjectId);
    // Once, on mount: the form remounts (keyed) when its initial values change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onProjectChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const next = event.target.value;
    setProjectId(next);
    setNote(null);
    load(next);
  }

  const options = picker.state === "ready" ? picker.options : [];
  const unresolved = picker.state !== "ready";
  const legacyShown = showLegacyAssignee && legacyAssignee && !options.some((option) => option.value === legacyAssignee.value);

  return (
    <FormSection title="Assignment">
      <Field label="Project" name="projectId" hint="Leave empty for a personal task that belongs to no project.">
        <select id="projectId" name="projectId" value={projectId} onChange={onProjectChange} className={selectClass}>
          <option value="">No project</option>
          {legacyProject && !projects.some((option) => option.value === legacyProject.value) ? (
            <option value={legacyProject.value} disabled={projectId !== legacyProject.value}>
              {legacyProject.label}
            </option>
          ) : null}
          {projects.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Assignee"
        name="assigneeMemberId"
        hint={
          mayAssignOthers
            ? "Project work can only go to a member of that project."
            : "You can take this task yourself or leave it unassigned."
        }
      >
        {/* Disabled controls are not submitted: the shown value still is. */}
        {unresolved ? <input type="hidden" name="assigneeMemberId" value={assigneeId} /> : null}
        <select
          id="assigneeMemberId"
          name={unresolved ? undefined : "assigneeMemberId"}
          value={assigneeId}
          onChange={(event) => {
            setAssigneeId(event.target.value);
            setNote(null);
          }}
          disabled={unresolved}
          aria-busy={picker.state === "loading" || undefined}
          aria-describedby="assigneeMemberId-state"
          className={selectClass}
          data-picker-state={picker.state === "ready" ? (options.length === 0 ? "empty" : "ready") : picker.state}
        >
          <option value="">Unassigned</option>
          {legacyShown ? (
            <option value={legacyAssignee.value} disabled={assigneeId !== legacyAssignee.value}>
              {legacyAssignee.label}
            </option>
          ) : null}
          {unresolved && assigneeId && !legacyShown ? <option value={assigneeId}>{labelOf(assigneeId, [])}</option> : null}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <div id="assigneeMemberId-state" className="text-meta" aria-live="polite">
          {picker.state === "loading" ? <p className="text-fg-subtle">Loading the people on this project…</p> : null}
          {picker.state === "ready" && options.length === 0 ? (
            <p className="text-fg-subtle">No one on this project can take tasks yet. Leave it unassigned or add people to the project.</p>
          ) : null}
          {legacyShown && assigneeId === legacyAssignee.value ? (
            <p className="text-fg-subtle">The current assignee is no longer active. They stay on this task until you change it, but can&apos;t be chosen again.</p>
          ) : null}
          {note ? <p className="text-warning-strong" data-testid="task-assignee-cleared">{note}</p> : null}
        </div>
        {picker.state === "error" ? (
          <div role="alert" className="flex flex-wrap items-center gap-2 text-meta text-danger-strong">
            <span>{picker.message}</span>
            <Button type="button" size="sm" variant="secondary" onClick={() => load(projectId)}>
              Retry
            </Button>
          </div>
        ) : null}
      </Field>
    </FormSection>
  );
}

/**
 * Start and due date (PRD #11 §50). The due date cannot be before the start:
 * the browser is told (`min`), the server refuses it regardless, and its
 * message lands on the due date (AUD-09 §3, FV-04).
 */
function ScheduleFields({ initialStart, initialDue }: { initialStart: string; initialDue: string }) {
  const [start, setStart] = React.useState(initialStart);
  const errors = useFieldErrors();
  return (
    <FormSection title="Schedule">
      <Field label="Start date" name="startDate">
        <Input
          id="startDate"
          name="startDate"
          type="date"
          defaultValue={initialStart}
          onChange={(event) => setStart(event.target.value)}
          aria-invalid={Boolean(errors.startDate) || undefined}
          aria-describedby={errors.startDate ? "startDate-error" : undefined}
        />
      </Field>

      <Field label="Due date" name="dueDate" hint="On or after the start date.">
        <Input
          id="dueDate"
          name="dueDate"
          type="date"
          defaultValue={initialDue}
          min={start || undefined}
          aria-invalid={Boolean(errors.dueDate) || undefined}
          aria-describedby={errors.dueDate ? "dueDate-error" : undefined}
        />
      </Field>
    </FormSection>
  );
}
