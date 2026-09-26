"use client";

import type * as React from "react";

import {
  Field,
  FormSection,
  RecordForm,
  selectClass,
  useFieldErrors,
  type FormActionResult,
  type SelectOption,
} from "@/components/forms/record-form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

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

      <FormSection title="Assignment">
        <Field
          label="Project"
          name="projectId"
          hint="Leave empty for a personal task that belongs to no project."
        >
          <select
            id="projectId"
            name="projectId"
            defaultValue={initial.projectId}
            className={selectClass}
          >
            <option value="">No project</option>
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
          <select
            id="assigneeMemberId"
            name="assigneeMemberId"
            defaultValue={initial.assigneeMemberId}
            className={selectClass}
          >
            <option value="">Unassigned</option>
            {assignees.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      </FormSection>

      <FormSection title="Schedule">
        <Field label="Start date" name="startDate">
          <Input id="startDate" name="startDate" type="date" defaultValue={initial.startDate} />
        </Field>

        <Field label="Due date" name="dueDate">
          <Input id="dueDate" name="dueDate" type="date" defaultValue={initial.dueDate} />
        </Field>
      </FormSection>
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
