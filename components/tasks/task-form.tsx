"use client";

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
  versionUpdatedAt,
  action,
}: {
  mode: "create" | "edit";
  initial: TaskFormValues;
  projects: SelectOption[];
  assignees: SelectOption[];
  /** Without task.assign the picker offers the current user only (PRD #11 §122). */
  mayAssignOthers: boolean;
  statuses?: SelectOption[];
  cancelHref: string;
  versionUpdatedAt?: string;
  action: (formData: FormData) => Promise<FormActionResult>;
}) {
  return (
    <RecordForm
      action={action}
      cancelHref={cancelHref}
      versionUpdatedAt={versionUpdatedAt}
      submitLabel={mode === "create" ? "Create task" : "Save changes"}
      pendingLabel={mode === "create" ? "Creating…" : "Saving…"}
    >
      <FormSection title="Task details">
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
            {statuses.map((option) => (
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
