"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";

import { selectClass } from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { SaveOutcome } from "@/lib/unsaved/coordinator";
import { MILESTONE_STATUSES, MILESTONE_TYPES, STATUS_LABELS, TYPE_LABELS, type MilestoneStatus, type MilestoneType, type Option, type PhaseStatus } from "@/lib/modules/project-planning/planning.types";
import { cn } from "@/lib/utils/cn";
import { failureMessage, isFailure, planningApi } from "./planning-api";
import { COMMITTED, failureOutcome, INVALID, useValuesEditor } from "./use-values-editor";

/**
 * Adding and editing a milestone (PRD #44 §141-§146) — and a phase (§9, §114).
 *
 * Progressive: the name, phase, type, owner and dates first; the baseline,
 * flags and description a click away. The baseline is only offered where it
 * is really being set for the first time, by someone who holds the grant;
 * afterwards it moves through its own command in the drawer.
 *
 * Each form mounts when its dialog opens and registers with the tab's
 * unsaved-work coordinator (AUD-03 §5): the X, Escape, the backdrop and Cancel
 * ask before throwing typed values away, and Save and continue runs the same
 * save as the form's own button.
 */

export type MilestoneFormValues = {
  name: string;
  phaseId: string;
  milestoneType: MilestoneType;
  ownerMemberId: string;
  baselineDate: string;
  plannedDate: string;
  forecastDate: string;
  actualDate: string;
  status: MilestoneStatus;
  progressPercent: string;
  critical: boolean;
  externallyCommitted: boolean;
  description: string;
};

export const EMPTY_MILESTONE: MilestoneFormValues = { name: "", phaseId: "", milestoneType: "OTHER", ownerMemberId: "", baselineDate: "", plannedDate: "", forecastDate: "", actualDate: "", status: "NOT_STARTED", progressPercent: "", critical: false, externallyCommitted: false, description: "" };

function Field({ label, htmlFor, error, hint, children, className }: { label: string; htmlFor: string; error?: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <label htmlFor={htmlFor} className="text-meta font-medium text-fg-muted">
        {label}
      </label>
      {children}
      {error ? <p className="text-meta text-danger-strong">{error}</p> : hint ? <p className="text-meta text-fg-subtle">{hint}</p> : null}
    </div>
  );
}

function fieldErrors(error: unknown): Record<string, string> {
  if (!isFailure(error)) return {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(error.details)) if (Array.isArray(value) && typeof value[0] === "string") result[key] = value[0];
  if (typeof error.details.field === "string") result[error.details.field] = error.message;
  return result;
}

export function MilestoneFormDialog({
  open,
  onOpenChange,
  projectId,
  milestoneId,
  version,
  initial,
  phases,
  members,
  canSetBaseline,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  milestoneId?: string;
  version?: number;
  initial: MilestoneFormValues;
  phases: Option[];
  members: Option[];
  canSetBaseline: boolean;
  onSaved: (id: string) => void;
}) {
  const editing = Boolean(milestoneId);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] max-w-xl overflow-y-auto">
        <DialogTitle>{editing ? "Edit milestone" : "New milestone"}</DialogTitle>
        <DialogDescription>{editing ? "Dates, owner and status. The baseline and completion have their own actions." : "A key achievement or date on this project."}</DialogDescription>
        {/* Mounted per opening: it opens on `initial` as it was then. */}
        <MilestoneForm projectId={projectId} milestoneId={milestoneId} version={version} initial={initial} phases={phases} members={members} canSetBaseline={canSetBaseline} onSaved={onSaved} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function MilestoneForm({
  projectId,
  milestoneId,
  version,
  initial,
  phases,
  members,
  canSetBaseline,
  onSaved,
  onDone,
}: {
  projectId: string;
  milestoneId?: string;
  version?: number;
  initial: MilestoneFormValues;
  phases: Option[];
  members: Option[];
  canSetBaseline: boolean;
  onSaved: (id: string) => void;
  onDone: () => void;
}) {
  const editing = Boolean(milestoneId);
  const [values, setValues] = React.useState(initial);
  const [more, setMore] = React.useState(editing && Boolean(initial.description));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const persist = React.useRef<() => Promise<SaveOutcome>>(async () => INVALID);
  const editor = useValuesEditor(values, { module: "planning", saveKind: editing ? "save" : "create", label: editing ? `Milestone ${initial.name}` : "New milestone", save: () => persist.current() });

  const set = <K extends keyof MilestoneFormValues>(key: K, value: MilestoneFormValues[K]) => setValues((current) => ({ ...current, [key]: value }));
  const id = (name: string) => `milestone-${name}`;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    void persist.current();
  }

  persist.current = async () => {
    if (!values.name.trim()) {
      setErrors({ name: "Give it a name." });
      return INVALID;
    }
    setPending(true);
    setFormError(null);
    setErrors({});
    const common = {
      name: values.name,
      description: values.description || null,
      phaseId: values.phaseId || null,
      milestoneType: values.milestoneType,
      ownerMemberId: values.ownerMemberId || null,
      plannedDate: values.plannedDate || null,
      forecastDate: values.forecastDate || null,
      progressPercent: values.progressPercent === "" ? null : Number(values.progressPercent),
      critical: values.critical,
      externallyCommitted: values.externallyCommitted,
    };
    try {
      if (editing) {
        await editor.track(() => planningApi(`/api/project-milestones/${milestoneId}`, { method: "PATCH", body: { ...common, expectedVersion: version, status: values.status, actualDate: values.actualDate || null } }));
        onSaved(milestoneId!);
      } else {
        const created = await editor.track(() => planningApi<{ id: string }>(`/api/projects/${projectId}/milestones`, { body: { ...common, baselineDate: canSetBaseline ? values.baselineDate || null : null } }));
        onSaved(created.id);
      }
      onDone();
      return COMMITTED;
    } catch (error) {
      setErrors(fieldErrors(error));
      setFormError(failureMessage(error, "The milestone could not be saved."));
      return failureOutcome(error);
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-4 space-y-4" noValidate>
      <Field label="Name" htmlFor={id("name")} error={errors.name}>
        <Input id={id("name")} value={values.name} onChange={(event) => set("name", event.target.value)} maxLength={200} autoFocus placeholder="e.g. Structure Complete" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Phase" htmlFor={id("phase")} error={errors.phaseId}>
          <select id={id("phase")} className={selectClass} value={values.phaseId} onChange={(event) => set("phaseId", event.target.value)}>
            <option value="">No phase</option>
            {phases.map((phase) => (
              <option key={phase.id} value={phase.id}>
                {phase.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Type" htmlFor={id("type")}>
          <select id={id("type")} className={selectClass} value={values.milestoneType} onChange={(event) => set("milestoneType", event.target.value as MilestoneType)}>
            {MILESTONE_TYPES.map((type) => (
              <option key={type} value={type}>
                {TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Owner" htmlFor={id("owner")} error={errors.ownerMemberId}>
          <select id={id("owner")} className={selectClass} value={values.ownerMemberId} onChange={(event) => set("ownerMemberId", event.target.value)}>
            <option value="">Unassigned</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.label}
              </option>
            ))}
          </select>
        </Field>
        {editing ? (
          <Field label="Status" htmlFor={id("status")} error={errors.status}>
            <select id={id("status")} className={selectClass} value={values.status} onChange={(event) => set("status", event.target.value as MilestoneStatus)} disabled={values.status === "COMPLETED"}>
              {MILESTONE_STATUSES.filter((status) => status !== "COMPLETED" || values.status === "COMPLETED").map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <span className="hidden sm:block" />
        )}
        <Field label="Planned date" htmlFor={id("planned")} error={errors.plannedDate}>
          <Input id={id("planned")} type="date" value={values.plannedDate} onChange={(event) => set("plannedDate", event.target.value)} />
        </Field>
        <Field label="Forecast date" htmlFor={id("forecast")} error={errors.forecastDate} hint={editing ? undefined : "Defaults to the planned date."}>
          <Input id={id("forecast")} type="date" value={values.forecastDate} onChange={(event) => set("forecastDate", event.target.value)} />
        </Field>
        {editing && values.status === "COMPLETED" ? (
          <Field label="Actual date" htmlFor={id("actual")} error={errors.actualDate}>
            <Input id={id("actual")} type="date" value={values.actualDate} onChange={(event) => set("actualDate", event.target.value)} />
          </Field>
        ) : null}
      </div>

      <button type="button" onClick={() => setMore((value) => !value)} aria-expanded={more} className="flex items-center gap-1.5 text-table font-medium text-accent-strong">
        <ChevronDown aria-hidden="true" className={cn("size-4 transition-transform", !more && "-rotate-90")} />
        {more ? "Fewer details" : "More details"}
      </button>
      {more ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {!editing && canSetBaseline ? (
              <Field label="Baseline date" htmlFor={id("baseline")} error={errors.baselineDate} hint="The approved reference. Defaults to the planned date.">
                <Input id={id("baseline")} type="date" value={values.baselineDate} onChange={(event) => set("baselineDate", event.target.value)} />
              </Field>
            ) : null}
            <Field label="Progress %" htmlFor={id("progress")} error={errors.progressPercent}>
              <Input id={id("progress")} type="number" min={0} max={100} step={1} inputMode="numeric" value={values.progressPercent} onChange={(event) => set("progressPercent", event.target.value)} />
            </Field>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <label className="flex items-center gap-2 text-table text-fg">
              <Checkbox checked={values.critical} onCheckedChange={(checked) => set("critical", checked === true)} aria-label="Critical" />
              Critical
            </label>
            <label className="flex items-center gap-2 text-table text-fg">
              <Checkbox checked={values.externallyCommitted} onCheckedChange={(checked) => set("externallyCommitted", checked === true)} aria-label="Externally committed" />
              Externally committed
            </label>
          </div>
          <Field label="Description" htmlFor={id("description")} error={errors.description}>
            <Textarea id={id("description")} value={values.description} onChange={(event) => set("description", event.target.value)} rows={3} maxLength={5000} />
          </Field>
        </div>
      ) : null}

      {formError ? (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-table text-danger-strong">
          {formError}
        </p>
      ) : null}
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="secondary">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : editing ? "Save changes" : "Add milestone"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/* Phase                                                                       */
/* -------------------------------------------------------------------------- */

export type PhaseFormValues = {
  name: string;
  status: PhaseStatus;
  ownerMemberId: string;
  progressPercent: string;
  plannedStartDate: string;
  plannedEndDate: string;
  forecastStartDate: string;
  forecastEndDate: string;
  actualStartDate: string;
  actualEndDate: string;
  description: string;
};

export const EMPTY_PHASE: PhaseFormValues = { name: "", status: "NOT_STARTED", ownerMemberId: "", progressPercent: "", plannedStartDate: "", plannedEndDate: "", forecastStartDate: "", forecastEndDate: "", actualStartDate: "", actualEndDate: "", description: "" };

export function PhaseFormDialog({
  open,
  onOpenChange,
  projectId,
  phaseId,
  version,
  initial,
  members,
  suggestedProgress,
  milestones,
  canArchive,
  canEdit,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  phaseId?: string;
  version?: number;
  initial: PhaseFormValues;
  members: Option[];
  suggestedProgress?: number | null;
  milestones?: Array<{ id: string; name: string; status: MilestoneStatus }>;
  canArchive?: boolean;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const editing = Boolean(phaseId);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] max-w-xl overflow-y-auto">
        <DialogTitle>{editing ? initial.name || "Phase" : "New phase"}</DialogTitle>
        <DialogDescription>{editing ? "Dates, status, owner and progress for this part of the plan." : "A planning segment that groups milestones."}</DialogDescription>
        {/* Mounted per opening: it opens on `initial` as it was then. */}
        <PhaseForm projectId={projectId} phaseId={phaseId} version={version} initial={initial} members={members} suggestedProgress={suggestedProgress} milestones={milestones} canArchive={canArchive} canEdit={canEdit} onSaved={onSaved} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function PhaseForm({
  projectId,
  phaseId,
  version,
  initial,
  members,
  suggestedProgress,
  milestones,
  canArchive,
  canEdit,
  onSaved,
  onDone,
}: {
  projectId: string;
  phaseId?: string;
  version?: number;
  initial: PhaseFormValues;
  members: Option[];
  suggestedProgress?: number | null;
  milestones?: Array<{ id: string; name: string; status: MilestoneStatus }>;
  canArchive?: boolean;
  canEdit: boolean;
  onSaved: () => void;
  onDone: () => void;
}) {
  const editing = Boolean(phaseId);
  const [values, setValues] = React.useState(initial);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const persist = React.useRef<() => Promise<SaveOutcome>>(async () => INVALID);
  // A reader who may not edit holds nothing to lose: nothing to save, nothing to ask.
  const editor = useValuesEditor(values, { module: "planning", saveKind: canEdit ? (editing ? "save" : "create") : "none", label: editing ? `Phase ${initial.name}` : "New phase", save: canEdit ? () => persist.current() : undefined });

  const set = <K extends keyof PhaseFormValues>(key: K, value: PhaseFormValues[K]) => setValues((current) => ({ ...current, [key]: value }));
  const id = (name: string) => `phase-${name}`;
  const date = (key: keyof PhaseFormValues, label: string) => (
    <Field label={label} htmlFor={id(key)} error={errors[key]}>
      <Input id={id(key)} type="date" value={values[key] as string} onChange={(event) => set(key, event.target.value as never)} disabled={!canEdit} />
    </Field>
  );

  function submit(event: React.FormEvent) {
    event.preventDefault();
    void persist.current();
  }

  persist.current = async () => {
    if (!values.name.trim()) {
      setErrors({ name: "Give it a name." });
      return INVALID;
    }
    setPending(true);
    setFormError(null);
    const body = {
      name: values.name,
      description: values.description || null,
      status: values.status,
      ownerMemberId: values.ownerMemberId || null,
      progressPercent: values.progressPercent === "" ? null : Number(values.progressPercent),
      plannedStartDate: values.plannedStartDate || null,
      plannedEndDate: values.plannedEndDate || null,
      forecastStartDate: values.forecastStartDate || null,
      forecastEndDate: values.forecastEndDate || null,
      actualStartDate: values.actualStartDate || null,
      actualEndDate: values.actualEndDate || null,
    };
    try {
      if (editing) await editor.track(() => planningApi(`/api/project-phases/${phaseId}`, { method: "PATCH", body: { ...body, expectedVersion: version } }));
      else await editor.track(() => planningApi(`/api/projects/${projectId}/phases`, { body }));
      onSaved();
      onDone();
      return COMMITTED;
    } catch (error) {
      setErrors(fieldErrors(error));
      setFormError(failureMessage(error, "The phase could not be saved."));
      return failureOutcome(error);
    } finally {
      setPending(false);
    }
  };

  async function archive() {
    setPending(true);
    setFormError(null);
    try {
      await planningApi(`/api/project-phases/${phaseId}`, { method: "DELETE" });
      onSaved();
      onDone();
    } catch (error) {
      setFormError(failureMessage(error, "The phase could not be archived."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-4" noValidate>
      <Field label="Name" htmlFor={id("name")} error={errors.name}>
        <Input id={id("name")} value={values.name} onChange={(event) => set("name", event.target.value)} maxLength={200} disabled={!canEdit} autoFocus={!editing} placeholder="e.g. Superstructure" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Status" htmlFor={id("status")}>
          <select id={id("status")} className={selectClass} value={values.status} onChange={(event) => set("status", event.target.value as PhaseStatus)} disabled={!canEdit}>
            {MILESTONE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Owner" htmlFor={id("owner")} error={errors.ownerMemberId}>
          <select id={id("owner")} className={selectClass} value={values.ownerMemberId} onChange={(event) => set("ownerMemberId", event.target.value)} disabled={!canEdit}>
            <option value="">Unassigned</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.label}
              </option>
            ))}
          </select>
        </Field>
        {date("plannedStartDate", "Planned start")}
        {date("plannedEndDate", "Planned end")}
        {date("forecastStartDate", "Forecast start")}
        {date("forecastEndDate", "Forecast end")}
        {date("actualStartDate", "Actual start")}
        {date("actualEndDate", "Actual end")}
        <Field label="Progress %" htmlFor={id("progress")} error={errors.progressPercent} hint={suggestedProgress !== undefined && suggestedProgress !== null ? `Milestones suggest ${suggestedProgress}%.` : undefined}>
          <span className="flex gap-2">
            <Input id={id("progress")} type="number" min={0} max={100} inputMode="numeric" value={values.progressPercent} onChange={(event) => set("progressPercent", event.target.value)} disabled={!canEdit} />
            {canEdit && suggestedProgress !== undefined && suggestedProgress !== null && String(suggestedProgress) !== values.progressPercent ? (
              <Button type="button" variant="secondary" size="sm" className="h-10" onClick={() => set("progressPercent", String(suggestedProgress))}>
                Use {suggestedProgress}%
              </Button>
            ) : null}
          </span>
        </Field>
      </div>
      <Field label="Description" htmlFor={id("description")}>
        <Textarea id={id("description")} value={values.description} onChange={(event) => set("description", event.target.value)} rows={2} maxLength={5000} disabled={!canEdit} />
      </Field>
      {milestones?.length ? (
        <div>
          <p className="text-meta font-medium text-fg-muted">Milestones</p>
          <ul className="mt-1 divide-y divide-line rounded-md border border-line">
            {milestones.map((milestone) => (
              <li key={milestone.id} className="flex items-center justify-between gap-3 px-3 py-2 text-table">
                <span className="truncate text-fg">{milestone.name}</span>
                <span className="shrink-0 text-meta text-fg-muted">{STATUS_LABELS[milestone.status]}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {formError ? (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-table text-danger-strong">
          {formError}
        </p>
      ) : null}
      <DialogFooter className="flex-wrap">
        {editing && canArchive ? (
          <Button type="button" variant="ghost" className="mr-auto text-danger-strong" onClick={archive} disabled={pending}>
            Archive phase
          </Button>
        ) : null}
        <DialogClose asChild>
          <Button type="button" variant="secondary">
            {canEdit ? "Cancel" : "Close"}
          </Button>
        </DialogClose>
        {canEdit ? (
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : editing ? "Save phase" : "Add phase"}
          </Button>
        ) : null}
      </DialogFooter>
    </form>
  );
}
