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
import { useTranslations } from "@/components/i18n/i18n-provider";
import { FormSelect } from "@/components/ui/form-select";

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

const STATUS_VALUES = ["TODO", "IN_PROGRESS", "BLOCKED", "COMPLETED"] as const;
const PRIORITY_VALUES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

export function TaskForm({
  mode,
  initial,
  projects,
  assignees,
  mayAssignOthers,
  statuses: statusesProp,
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
  const t = useTranslations("tasks");
  const statuses = statusesProp ?? STATUS_VALUES.map((value) => ({ value, label: t(`status.${value}`) }));
  const priorities = PRIORITY_VALUES.map((value) => ({ value, label: t(`priority.${value}`) }));
  return (
    <RecordForm
      action={action}
      cancelHref={cancelHref}
      onFailure={onFailure}
      onSuccess={onSuccess}
      module="tasks"
      saveKind={mode === "create" ? "create" : "save"}
      baselineValues={baselineValues}
      submitLabel={mode === "create" ? t("common.createTask") : t("form.saveChanges")}
      pendingLabel={mode === "create" ? t("form.creating") : t("common.saving")}
    >
      {expectedVersion !== undefined ? <input type="hidden" name="expectedVersion" value={expectedVersion} /> : null}
      {notice}
      <FormSection title={t("form.details")}>
        {parent && "locked" in parent ? (
          <div className="sm:col-span-2">
            <input type="hidden" name="parent" value={parent.locked.value} />
            <p className="rounded-md bg-surface-muted px-3 py-2 text-table text-fg" data-testid="task-parent-locked">
              <span className="text-fg-muted">{t("form.raisedFrom")}</span>
              {parent.locked.label}
            </p>
          </div>
        ) : null}
        {parent && "options" in parent ? (
          <div className="sm:col-span-2">
            <Field label={parent.label} name="parent" required>
              <FormSelect id="parent" name="parent" defaultValue="" required className={selectClass}>
                <option value="" disabled>
                  {t("form.chooseRecord")}
                </option>
                {parent.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </FormSelect>
            </Field>
          </div>
        ) : null}
        <div className="sm:col-span-2">
          <Field label={t("fields.title")} name="title" required>
            <TitleInput defaultValue={initial.title} />
          </Field>
        </div>

        <div className="sm:col-span-2">
          <Field label={t("fields.description")} name="description">
            <Textarea
              id="description"
              name="description"
              rows={4}
              defaultValue={initial.description}
              maxLength={10_000}
            />
          </Field>
        </div>

        <Field label={t("fields.status")} name="status" required>
          <FormSelect id="status" name="status" defaultValue={initial.status} className={selectClass}>
            {/* Blocked is set by Mark blocked, which asks why (PRD #38 §44). */}
            {statuses.filter((option) => option.value !== "BLOCKED" || initial.status === "BLOCKED").map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </FormSelect>
        </Field>

        <Field label={t("fields.priority")} name="priority" required>
          <FormSelect
            id="priority"
            name="priority"
            defaultValue={initial.priority}
            className={selectClass}
          >
            {priorities.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </FormSelect>
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
  const t = useTranslations("tasks");
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
      t("form.theAssignee"),
    [assignees, legacyAssignee, t],
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
            setNote(t("form.assigneeCleared", { name: labelOf(current, result.options).replace(/ — .*$/, "") }));
            setAssigneeId("");
          }
        },
        () => {
          if (mine !== generation.current) return;
          setPicker({ state: "error", message: t("form.loadPeopleFailed") });
        },
      );
    },
    [initialProjectId, labelOf, legacyAssignee, t],
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
    <FormSection title={t("form.assignment")}>
      <Field label={t("fields.project")} name="projectId" hint={t("form.projectHint")}>
        <FormSelect id="projectId" name="projectId" value={projectId} onChange={onProjectChange} className={selectClass}>
          <option value="">{t("common.noProject")}</option>
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
        </FormSelect>
      </Field>

      <Field
        label={t("fields.assignee")}
        name="assigneeMemberId"
        hint={
          mayAssignOthers
            ? t("form.assigneeHintOthers")
            : t("form.assigneeHintSelf")
        }
      >
        {/* Disabled controls are not submitted: the shown value still is. */}
        {unresolved ? <input type="hidden" name="assigneeMemberId" value={assigneeId} /> : null}
        <FormSelect
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
          <option value="">{t("common.unassigned")}</option>
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
        </FormSelect>
        <div id="assigneeMemberId-state" className="text-meta" aria-live="polite">
          {picker.state === "loading" ? <p className="text-fg-subtle">{t("form.loadingPeople")}</p> : null}
          {picker.state === "ready" && options.length === 0 ? (
            <p className="text-fg-subtle">{t("form.noPeople")}</p>
          ) : null}
          {legacyShown && assigneeId === legacyAssignee.value ? (
            <p className="text-fg-subtle">{t("form.legacyAssignee")}</p>
          ) : null}
          {note ? <p className="text-warning-strong" data-testid="task-assignee-cleared">{note}</p> : null}
        </div>
        {picker.state === "error" ? (
          <div role="alert" className="flex flex-wrap items-center gap-2 text-meta text-danger-strong">
            <span>{picker.message}</span>
            <Button type="button" size="sm" variant="secondary" onClick={() => load(projectId)}>
              {t("form.retry")}
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
  const t = useTranslations("tasks");
  const [start, setStart] = React.useState(initialStart);
  const errors = useFieldErrors();
  return (
    <FormSection title={t("form.schedule")}>
      <Field label={t("fields.startDate")} name="startDate">
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

      <Field label={t("fields.dueDate")} name="dueDate" hint={t("form.dueHint")}>
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
