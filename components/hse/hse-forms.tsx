"use client";

import * as React from "react";

import {
  Field,
  FormSection,
  RecordForm,
  selectClass,
  type FormActionResult,
} from "@/components/forms/record-form";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  calculateRiskLevel,
  likelihoodLabels,
  riskLevelLabels,
  severityLabels as axisLabels,
} from "@/lib/modules/hse/hse.risk";
import {
  ACTION_TYPES,
  ENVIRONMENTAL_CATEGORIES,
  HAZARD_CATEGORIES,
  INCIDENT_TYPES,
  INSPECTION_TYPES,
  PERMIT_TYPES,
  PRIORITIES,
  SEVERITIES,
  actionTypeLabels,
  environmentalCategoryLabels,
  hazardCategoryLabels,
  incidentTypeLabels,
  inspectionTypeLabels,
  permitTypeLabels,
  priorityLabels,
  severityLabels,
} from "@/lib/modules/hse/hse.status";

/**
 * The HSE record forms (PRD #22 §311–§324).
 *
 * Two rules run through all of them.
 *
 * **No form carries a status.** Records move through named actions — submit,
 * approve, activate, close — so there is nothing here for a dropdown to set,
 * and no way to type your way past a permit approval.
 *
 * **No form posts a risk score.** The two axes go up; the server multiplies
 * them (PRD #22 §243). The preview below the pickers is exactly that — a
 * preview, computed with the same function the server uses so the two can never
 * disagree, and never sent.
 */

export type Option = { value: string; label: string };

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function nowLocal(): string {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

const AXIS = [1, 2, 3, 4, 5];

/** A checkbox with its words beside it, which is the only way a flag reads. */
function Flag({
  name,
  label,
  defaultChecked,
}: {
  name: string;
  label: string;
  defaultChecked?: boolean;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Checkbox id={name} name={name} defaultChecked={defaultChecked} className="mt-0.5" />
      <Label htmlFor={name} className="text-body font-normal text-fg-muted">
        {label}
      </Label>
    </div>
  );
}

/**
 * The two axes, with a live preview of where they land (PRD #22 §315, §357).
 *
 * The preview uses `calculateRiskLevel` — the same function the server runs —
 * so a reporter sees the band their answer produces before they save, and the
 * page and the database can never disagree about what CRITICAL means.
 */
function RiskPicker({
  likelihoodName,
  severityName,
  likelihood,
  severity,
  onChange,
  label = "Risk",
  optional = false,
}: {
  likelihoodName: string;
  severityName: string;
  likelihood: string;
  severity: string;
  onChange: (next: { likelihood?: string; severity?: string }) => void;
  label?: string;
  optional?: boolean;
}) {
  const both = likelihood !== "" && severity !== "";
  const score = both ? Number(likelihood) * Number(severity) : null;
  const level = score === null ? null : calculateRiskLevel(score);

  return (
    <>
      <Field label={`${label} — likelihood`} name={likelihoodName} required={!optional}>
        <select
          id={likelihoodName}
          name={likelihoodName}
          className={selectClass}
          value={likelihood}
          onChange={(event) => onChange({ likelihood: event.target.value })}
          required={!optional}
        >
          {optional ? <option value="">Not assessed</option> : null}
          {AXIS.map((value) => (
            <option key={value} value={value}>
              {value} — {likelihoodLabels[value]}
            </option>
          ))}
        </select>
      </Field>

      <Field label={`${label} — severity`} name={severityName} required={!optional}>
        <select
          id={severityName}
          name={severityName}
          className={selectClass}
          value={severity}
          onChange={(event) => onChange({ severity: event.target.value })}
          required={!optional}
        >
          {optional ? <option value="">Not assessed</option> : null}
          {AXIS.map((value) => (
            <option key={value} value={value}>
              {value} — {axisLabels[value]}
            </option>
          ))}
        </select>
      </Field>

      <div className="sm:col-span-2">
        <p className="text-meta text-fg-muted" aria-live="polite">
          {level === null ? (
            optional ? (
              "Give both to record the risk left after the controls."
            ) : (
              "Pick a likelihood and a severity."
            )
          ) : (
            <>
              Score <strong className="text-fg">{score}</strong> ·{" "}
              <strong className="text-fg">{riskLevelLabels[level]}</strong> risk
              {level === "CRITICAL" ? " — an immediate control is required." : ""}
            </>
          )}
        </p>
      </div>
    </>
  );
}

function ProjectField({
  projects,
  value,
  required = false,
  hint,
}: {
  projects: Option[];
  value?: string;
  required?: boolean;
  hint?: string;
}) {
  return (
    <Field label="Project" name="projectId" required={required} hint={hint}>
      <select
        id="projectId"
        name="projectId"
        className={selectClass}
        defaultValue={value ?? ""}
        required={required}
      >
        {required ? (
          <option value="">Choose a project</option>
        ) : (
          <option value="">No project — company-wide</option>
        )}
        {projects.map((project) => (
          <option key={project.value} value={project.value}>
            {project.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

function MemberField({
  members,
  name,
  label,
  value,
  required = false,
  emptyLabel = "Nobody yet",
}: {
  members: Option[];
  name: string;
  label: string;
  value?: string;
  required?: boolean;
  emptyLabel?: string;
}) {
  return (
    <Field label={label} name={name} required={required}>
      <select
        id={name}
        name={name}
        className={selectClass}
        defaultValue={value ?? ""}
        required={required}
      >
        <option value="">{emptyLabel}</option>
        {members.map((member) => (
          <option key={member.value} value={member.value}>
            {member.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

/* -------------------------------------------------------------------------- */
/* Hazard                                                                      */
/* -------------------------------------------------------------------------- */

export type HazardFormValues = {
  title: string;
  description: string;
  projectId: string;
  hazardCategory: string;
  likelihood: string;
  severity: string;
  observedAt: string;
  locationText: string;
  assignedToMemberId: string;
  immediateControl: string;
  controlMeasure: string;
  dueDate: string;
};

export function HazardForm({
  action,
  values,
  versionUpdatedAt,
  cancelHref,
  submitLabel,
  pendingLabel,
  projects,
  members,
  canAssign,
}: {
  action: (formData: FormData) => Promise<FormActionResult>;
  values?: HazardFormValues;
  versionUpdatedAt?: string;
  cancelHref: string;
  submitLabel: string;
  pendingLabel: string;
  projects: Option[];
  members: Option[];
  canAssign: boolean;
}) {
  const [likelihood, setLikelihood] = React.useState(values?.likelihood ?? "3");
  const [severity, setSeverity] = React.useState(values?.severity ?? "3");

  const critical = Number(likelihood) * Number(severity) >= 17;

  return (
    <RecordForm
      module="hse"
      action={action}
      cancelHref={cancelHref}
      submitLabel={submitLabel}
      pendingLabel={pendingLabel}
      versionUpdatedAt={versionUpdatedAt}
    >
      <FormSection
        title="What did you see"
        description="Anybody on site can report a hazard. Say what it is and where; the risk score decides how fast it gets dealt with."
      >
        <Field label="Title" name="title" required className="sm:col-span-2">
          <Input id="title" name="title" defaultValue={values?.title ?? ""} required maxLength={200} />
        </Field>

        <Field label="Description" name="description" required className="sm:col-span-2">
          <Textarea
            id="description"
            name="description"
            defaultValue={values?.description ?? ""}
            required
            rows={4}
            maxLength={4000}
          />
        </Field>

        <Field label="Category" name="hazardCategory" required>
          <select
            id="hazardCategory"
            name="hazardCategory"
            className={selectClass}
            defaultValue={values?.hazardCategory ?? "OTHER"}
            required
          >
            {HAZARD_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {hazardCategoryLabels[value]}
              </option>
            ))}
          </select>
        </Field>

        <ProjectField projects={projects} value={values?.projectId} />

        <Field label="Location" name="locationText">
          <Input
            id="locationText"
            name="locationText"
            defaultValue={values?.locationText ?? ""}
            maxLength={200}
            placeholder="Level 3, east stair"
          />
        </Field>

        <Field label="Observed" name="observedAt" required>
          <Input
            id="observedAt"
            name="observedAt"
            type="date"
            defaultValue={values?.observedAt ?? today()}
            required
          />
        </Field>
      </FormSection>

      <FormSection
        title="Risk"
        description="How likely is it to happen, and how bad would it be. The score and the band are worked out from these two."
      >
        <RiskPicker
          likelihoodName="likelihood"
          severityName="severity"
          likelihood={likelihood}
          severity={severity}
          onChange={(next) => {
            if (next.likelihood !== undefined) setLikelihood(next.likelihood);
            if (next.severity !== undefined) setSeverity(next.severity);
          }}
        />
      </FormSection>

      <FormSection
        title="Controls"
        description="What was done about it, and what will be."
      >
        <Field
          label="Immediate control"
          name="immediateControl"
          required={critical}
          className="sm:col-span-2"
          hint={
            critical
              ? "A critical hazard needs the control that was put in place now — barricade, isolation, stop work."
              : "What was done straight away, if anything."
          }
        >
          <Textarea
            id="immediateControl"
            name="immediateControl"
            defaultValue={values?.immediateControl ?? ""}
            rows={2}
            required={critical}
            maxLength={2000}
          />
        </Field>

        <Field label="Control measure" name="controlMeasure" className="sm:col-span-2">
          <Textarea
            id="controlMeasure"
            name="controlMeasure"
            defaultValue={values?.controlMeasure ?? ""}
            rows={2}
            maxLength={2000}
          />
        </Field>

        {canAssign ? (
          <MemberField
            members={members}
            name="assignedToMemberId"
            label="Assign to"
            value={values?.assignedToMemberId}
            emptyLabel="Unassigned"
          />
        ) : null}

        <Field label="Due" name="dueDate">
          <Input id="dueDate" name="dueDate" type="date" defaultValue={values?.dueDate ?? ""} />
        </Field>
      </FormSection>
    </RecordForm>
  );
}

/* -------------------------------------------------------------------------- */
/* Incident                                                                    */
/* -------------------------------------------------------------------------- */

export type IncidentFormValues = {
  incidentType: string;
  title: string;
  description: string;
  projectId: string;
  occurredAt: string;
  locationText: string;
  severity: string;
  injuryOccurred: boolean;
  firstAidRequired: boolean;
  medicalTreatmentRequired: boolean;
  lostTime: boolean;
  propertyDamage: boolean;
  environmentalImpact: boolean;
  immediateAction: string;
  dueDate: string;
};

export function IncidentForm({
  action,
  values,
  versionUpdatedAt,
  cancelHref,
  submitLabel,
  pendingLabel,
  projects,
}: {
  action: (formData: FormData) => Promise<FormActionResult>;
  values?: IncidentFormValues;
  versionUpdatedAt?: string;
  cancelHref: string;
  submitLabel: string;
  pendingLabel: string;
  projects: Option[];
}) {
  const [severity, setSeverity] = React.useState(values?.severity ?? "MEDIUM");
  const serious = severity === "HIGH" || severity === "CRITICAL";

  return (
    <RecordForm
      module="hse"
      action={action}
      cancelHref={cancelHref}
      submitLabel={submitLabel}
      pendingLabel={pendingLabel}
      versionUpdatedAt={versionUpdatedAt}
    >
      <FormSection
        title="What happened"
        description="A near miss goes here too — same record, different type. It is the one worth reporting before it becomes the other."
      >
        <Field label="Type" name="incidentType" required>
          <select
            id="incidentType"
            name="incidentType"
            className={selectClass}
            defaultValue={values?.incidentType ?? "INCIDENT"}
            required
          >
            {INCIDENT_TYPES.map((value) => (
              <option key={value} value={value}>
                {incidentTypeLabels[value]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Severity" name="severity" required>
          <select
            id="severity"
            name="severity"
            className={selectClass}
            value={severity}
            onChange={(event) => setSeverity(event.target.value)}
            required
          >
            {SEVERITIES.map((value) => (
              <option key={value} value={value}>
                {severityLabels[value]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Title" name="title" required className="sm:col-span-2">
          <Input id="title" name="title" defaultValue={values?.title ?? ""} required maxLength={200} />
        </Field>

        <Field label="Description" name="description" required className="sm:col-span-2">
          <Textarea
            id="description"
            name="description"
            defaultValue={values?.description ?? ""}
            required
            rows={4}
            maxLength={4000}
          />
        </Field>

        <ProjectField projects={projects} value={values?.projectId} />

        <Field label="Location" name="locationText">
          <Input
            id="locationText"
            name="locationText"
            defaultValue={values?.locationText ?? ""}
            maxLength={200}
          />
        </Field>

        <Field label="Occurred" name="occurredAt" required>
          <Input
            id="occurredAt"
            name="occurredAt"
            type="datetime-local"
            defaultValue={values?.occurredAt ?? nowLocal()}
            required
          />
        </Field>

        <Field label="Due" name="dueDate">
          <Input id="dueDate" name="dueDate" type="date" defaultValue={values?.dueDate ?? ""} />
        </Field>
      </FormSection>

      <FormSection
        title="What resulted"
        // The whole of what V0.1 records about somebody being hurt. No
        // diagnosis field exists to fill in (PRD #22 §22, §87).
        description="Operational flags only. NESTO does not hold medical details, and this is not the place to write any."
      >
        <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2">
          <Flag name="injuryOccurred" label="Somebody was injured" defaultChecked={values?.injuryOccurred} />
          <Flag name="firstAidRequired" label="First aid was needed" defaultChecked={values?.firstAidRequired} />
          <Flag name="medicalTreatmentRequired" label="Medical treatment was needed" defaultChecked={values?.medicalTreatmentRequired} />
          <Flag name="lostTime" label="Time was lost" defaultChecked={values?.lostTime} />
          <Flag name="propertyDamage" label="Property was damaged" defaultChecked={values?.propertyDamage} />
          <Flag name="environmentalImpact" label="There was an environmental impact" defaultChecked={values?.environmentalImpact} />
        </div>

        <Field
          label="Immediate action"
          name="immediateAction"
          required={serious}
          className="sm:col-span-2"
          hint={
            serious
              ? "A high or critical incident needs what was done about it straight away."
              : "What was done straight away, if anything."
          }
        >
          <Textarea
            id="immediateAction"
            name="immediateAction"
            defaultValue={values?.immediateAction ?? ""}
            rows={3}
            required={serious}
            maxLength={2000}
          />
        </Field>
      </FormSection>
    </RecordForm>
  );
}

/* -------------------------------------------------------------------------- */
/* Inspection                                                                  */
/* -------------------------------------------------------------------------- */

export type InspectionFormValues = {
  inspectionType: string;
  projectId: string;
  templateId: string;
  assignedInspectorMemberId: string;
  scheduledDate: string;
  locationText: string;
  summary: string;
};

export function InspectionForm({
  action,
  values,
  versionUpdatedAt,
  cancelHref,
  submitLabel,
  pendingLabel,
  projects,
  members,
  templates,
}: {
  action: (formData: FormData) => Promise<FormActionResult>;
  values?: InspectionFormValues;
  versionUpdatedAt?: string;
  cancelHref: string;
  submitLabel: string;
  pendingLabel: string;
  projects: Option[];
  members: Option[];
  templates: Option[];
}) {
  return (
    <RecordForm
      module="hse"
      action={action}
      cancelHref={cancelHref}
      submitLabel={submitLabel}
      pendingLabel={pendingLabel}
      versionUpdatedAt={versionUpdatedAt}
    >
      <FormSection
        title="Inspection"
        description="Choosing a checklist copies it onto this inspection. Editing the checklist afterwards will not change what you answered here."
      >
        <Field label="Type" name="inspectionType" required>
          <select
            id="inspectionType"
            name="inspectionType"
            className={selectClass}
            defaultValue={values?.inspectionType ?? "SITE_SAFETY"}
            required
          >
            {INSPECTION_TYPES.map((value) => (
              <option key={value} value={value}>
                {inspectionTypeLabels[value]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Checklist" name="templateId" hint="Leave blank for a free-form inspection.">
          <select
            id="templateId"
            name="templateId"
            className={selectClass}
            defaultValue={values?.templateId ?? ""}
          >
            <option value="">No checklist</option>
            {templates.map((template) => (
              <option key={template.value} value={template.value}>
                {template.label}
              </option>
            ))}
          </select>
        </Field>

        <ProjectField projects={projects} value={values?.projectId} />

        <MemberField
          members={members}
          name="assignedInspectorMemberId"
          label="Inspector"
          value={values?.assignedInspectorMemberId}
          required
          emptyLabel="Choose an inspector"
        />

        <Field label="Location" name="locationText">
          <Input
            id="locationText"
            name="locationText"
            defaultValue={values?.locationText ?? ""}
            maxLength={200}
          />
        </Field>

        <Field label="Scheduled for" name="scheduledDate">
          <Input
            id="scheduledDate"
            name="scheduledDate"
            type="date"
            defaultValue={values?.scheduledDate ?? ""}
          />
        </Field>

        <Field label="Notes" name="summary" className="sm:col-span-2">
          <Textarea
            id="summary"
            name="summary"
            defaultValue={values?.summary ?? ""}
            rows={3}
            maxLength={4000}
          />
        </Field>
      </FormSection>
    </RecordForm>
  );
}

/* -------------------------------------------------------------------------- */
/* Work permit                                                                 */
/* -------------------------------------------------------------------------- */

export type PermitFormValues = {
  permitType: string;
  title: string;
  projectId: string;
  locationText: string;
  riskAssessmentId: string;
  validFrom: string;
  validUntil: string;
  responsibleMemberId: string;
  hazardsSummary: string;
  controlsSummary: string;
  ppeRequirements: string;
  specialConditions: string;
};

export function PermitForm({
  action,
  values,
  versionUpdatedAt,
  cancelHref,
  submitLabel,
  pendingLabel,
  projects,
  members,
  assessments,
}: {
  action: (formData: FormData) => Promise<FormActionResult>;
  values?: PermitFormValues;
  versionUpdatedAt?: string;
  cancelHref: string;
  submitLabel: string;
  pendingLabel: string;
  projects: Option[];
  members: Option[];
  assessments: Option[];
}) {
  return (
    <RecordForm
      module="hse"
      action={action}
      cancelHref={cancelHref}
      submitLabel={submitLabel}
      pendingLabel={pendingLabel}
      versionUpdatedAt={versionUpdatedAt}
    >
      <FormSection
        title="Permit"
        description="A permit authorises specific work in a specific place for a fixed window. Outside that window it authorises nothing."
      >
        <Field label="Type" name="permitType" required>
          <select
            id="permitType"
            name="permitType"
            className={selectClass}
            defaultValue={values?.permitType ?? "GENERAL"}
            required
          >
            {PERMIT_TYPES.map((value) => (
              <option key={value} value={value}>
                {permitTypeLabels[value]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Title" name="title" required>
          <Input id="title" name="title" defaultValue={values?.title ?? ""} required maxLength={200} />
        </Field>

        <ProjectField projects={projects} value={values?.projectId} required />

        <Field label="Location" name="locationText" required>
          <Input
            id="locationText"
            name="locationText"
            defaultValue={values?.locationText ?? ""}
            required
            maxLength={200}
          />
        </Field>

        <Field label="Valid from" name="validFrom" required>
          <Input
            id="validFrom"
            name="validFrom"
            type="datetime-local"
            defaultValue={values?.validFrom ?? nowLocal()}
            required
          />
        </Field>

        <Field label="Valid until" name="validUntil" required>
          <Input
            id="validUntil"
            name="validUntil"
            type="datetime-local"
            defaultValue={values?.validUntil ?? ""}
            required
          />
        </Field>

        <MemberField
          members={members}
          name="responsibleMemberId"
          label="Responsible person"
          value={values?.responsibleMemberId}
        />

        <Field label="Risk assessment" name="riskAssessmentId">
          <select
            id="riskAssessmentId"
            name="riskAssessmentId"
            className={selectClass}
            defaultValue={values?.riskAssessmentId ?? ""}
          >
            <option value="">None cited</option>
            {assessments.map((assessment) => (
              <option key={assessment.value} value={assessment.value}>
                {assessment.label}
              </option>
            ))}
          </select>
        </Field>
      </FormSection>

      <FormSection
        title="Hazards and controls"
        description="What could go wrong, and what is in place so it does not."
      >
        <Field label="Hazards" name="hazardsSummary" className="sm:col-span-2">
          <Textarea
            id="hazardsSummary"
            name="hazardsSummary"
            defaultValue={values?.hazardsSummary ?? ""}
            rows={3}
            maxLength={4000}
          />
        </Field>

        <Field label="Controls" name="controlsSummary" className="sm:col-span-2">
          <Textarea
            id="controlsSummary"
            name="controlsSummary"
            defaultValue={values?.controlsSummary ?? ""}
            rows={3}
            maxLength={4000}
          />
        </Field>

        <Field label="PPE required" name="ppeRequirements" className="sm:col-span-2">
          <Textarea
            id="ppeRequirements"
            name="ppeRequirements"
            defaultValue={values?.ppeRequirements ?? ""}
            rows={2}
            maxLength={2000}
          />
        </Field>

        <Field label="Special conditions" name="specialConditions" className="sm:col-span-2">
          <Textarea
            id="specialConditions"
            name="specialConditions"
            defaultValue={values?.specialConditions ?? ""}
            rows={2}
            maxLength={4000}
          />
        </Field>
      </FormSection>
    </RecordForm>
  );
}

/* -------------------------------------------------------------------------- */
/* HSE action                                                                  */
/* -------------------------------------------------------------------------- */

export type ActionFormValues = {
  actionType: string;
  title: string;
  description: string;
  projectId: string;
  assignedToMemberId: string;
  priority: string;
  dueDate: string;
};

export function ActionForm({
  action,
  values,
  versionUpdatedAt,
  cancelHref,
  submitLabel,
  pendingLabel,
  projects,
  members,
  parent,
}: {
  action: (formData: FormData) => Promise<FormActionResult>;
  values?: ActionFormValues;
  versionUpdatedAt?: string;
  cancelHref: string;
  submitLabel: string;
  pendingLabel: string;
  projects: Option[];
  members: Option[];
  /** The record it came out of, carried through as a hidden field. */
  parent?: { field: string; id: string; label: string };
}) {
  return (
    <RecordForm
      module="hse"
      action={action}
      cancelHref={cancelHref}
      submitLabel={submitLabel}
      pendingLabel={pendingLabel}
      versionUpdatedAt={versionUpdatedAt}
    >
      <FormSection
        title="Action"
        description="An action is the safety obligation. The Task is how somebody discharges it — they are not the same thing, and this is what gets verified."
      >
        {parent ? <input type="hidden" name={parent.field} value={parent.id} /> : null}

        {parent ? (
          <div className="sm:col-span-2">
            <p className="text-meta text-fg-muted">Raised against {parent.label}.</p>
          </div>
        ) : null}

        <Field label="Type" name="actionType" required>
          <select
            id="actionType"
            name="actionType"
            className={selectClass}
            defaultValue={values?.actionType ?? "CORRECTIVE"}
            required
          >
            {ACTION_TYPES.map((value) => (
              <option key={value} value={value}>
                {actionTypeLabels[value]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Priority" name="priority" required>
          <select
            id="priority"
            name="priority"
            className={selectClass}
            defaultValue={values?.priority ?? "MEDIUM"}
            required
          >
            {PRIORITIES.map((value) => (
              <option key={value} value={value}>
                {priorityLabels[value]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Title" name="title" required className="sm:col-span-2">
          <Input id="title" name="title" defaultValue={values?.title ?? ""} required maxLength={200} />
        </Field>

        <Field label="What needs doing" name="description" required className="sm:col-span-2">
          <Textarea
            id="description"
            name="description"
            defaultValue={values?.description ?? ""}
            required
            rows={4}
            maxLength={4000}
          />
        </Field>

        {parent ? null : <ProjectField projects={projects} value={values?.projectId} />}

        <MemberField
          members={members}
          name="assignedToMemberId"
          label="Responsible"
          value={values?.assignedToMemberId}
          required
          emptyLabel="Choose who is responsible"
        />

        <Field label="Due" name="dueDate">
          <Input id="dueDate" name="dueDate" type="date" defaultValue={values?.dueDate ?? ""} />
        </Field>
      </FormSection>
    </RecordForm>
  );
}

/* -------------------------------------------------------------------------- */
/* Environmental observation                                                   */
/* -------------------------------------------------------------------------- */

export type ObservationFormValues = {
  category: string;
  title: string;
  description: string;
  projectId: string;
  observedAt: string;
  locationText: string;
  severity: string;
  assignedToMemberId: string;
  immediateAction: string;
  dueDate: string;
};

export function ObservationForm({
  action,
  values,
  versionUpdatedAt,
  cancelHref,
  submitLabel,
  pendingLabel,
  projects,
  members,
  canAssign,
}: {
  action: (formData: FormData) => Promise<FormActionResult>;
  values?: ObservationFormValues;
  versionUpdatedAt?: string;
  cancelHref: string;
  submitLabel: string;
  pendingLabel: string;
  projects: Option[];
  members: Option[];
  canAssign: boolean;
}) {
  return (
    <RecordForm
      module="hse"
      action={action}
      cancelHref={cancelHref}
      submitLabel={submitLabel}
      pendingLabel={pendingLabel}
      versionUpdatedAt={versionUpdatedAt}
    >
      <FormSection
        title="Observation"
        description="A spill, dust, noise, waste going astray. Recorded here, dealt with, and closed out."
      >
        <Field label="Category" name="category" required>
          <select
            id="category"
            name="category"
            className={selectClass}
            defaultValue={values?.category ?? "OTHER"}
            required
          >
            {ENVIRONMENTAL_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {environmentalCategoryLabels[value]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Severity" name="severity" required>
          <select
            id="severity"
            name="severity"
            className={selectClass}
            defaultValue={values?.severity ?? "MEDIUM"}
            required
          >
            {SEVERITIES.map((value) => (
              <option key={value} value={value}>
                {severityLabels[value]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Title" name="title" required className="sm:col-span-2">
          <Input id="title" name="title" defaultValue={values?.title ?? ""} required maxLength={200} />
        </Field>

        <Field label="Description" name="description" required className="sm:col-span-2">
          <Textarea
            id="description"
            name="description"
            defaultValue={values?.description ?? ""}
            required
            rows={4}
            maxLength={4000}
          />
        </Field>

        <ProjectField projects={projects} value={values?.projectId} />

        <Field label="Location" name="locationText">
          <Input
            id="locationText"
            name="locationText"
            defaultValue={values?.locationText ?? ""}
            maxLength={200}
          />
        </Field>

        <Field label="Observed" name="observedAt" required>
          <Input
            id="observedAt"
            name="observedAt"
            type="date"
            defaultValue={values?.observedAt ?? today()}
            required
          />
        </Field>

        <Field label="Due" name="dueDate">
          <Input id="dueDate" name="dueDate" type="date" defaultValue={values?.dueDate ?? ""} />
        </Field>

        {canAssign ? (
          <MemberField
            members={members}
            name="assignedToMemberId"
            label="Assign to"
            value={values?.assignedToMemberId}
            emptyLabel="Unassigned"
          />
        ) : null}

        <Field label="Immediate action" name="immediateAction" className="sm:col-span-2">
          <Textarea
            id="immediateAction"
            name="immediateAction"
            defaultValue={values?.immediateAction ?? ""}
            rows={3}
            maxLength={2000}
          />
        </Field>
      </FormSection>
    </RecordForm>
  );
}

/* -------------------------------------------------------------------------- */
/* Stop work                                                                   */
/* -------------------------------------------------------------------------- */

export function StopWorkForm({
  action,
  cancelHref,
  projects,
  parent,
}: {
  action: (formData: FormData) => Promise<FormActionResult>;
  cancelHref: string;
  projects: Option[];
  parent?: { field: string; id: string; label: string; projectId?: string };
}) {
  return (
    <RecordForm
      module="hse"
      action={action}
      cancelHref={cancelHref}
      submitLabel="Stop work"
      pendingLabel="Stopping…"
      // Raising the order is this form's create (AUD-03 §3): the label is a verb, not "Create".
      saveKind="create"
    >
      <FormSection
        title="Stop work"
        description="This halts the job until somebody with the authority to release it says otherwise. It does not lock the project's other records."
      >
        {parent ? <input type="hidden" name={parent.field} value={parent.id} /> : null}

        <Field label="Title" name="title" required className="sm:col-span-2">
          <Input id="title" name="title" required maxLength={200} />
        </Field>

        <ProjectField projects={projects} value={parent?.projectId} required />

        <Field label="Location" name="locationText">
          <Input id="locationText" name="locationText" maxLength={200} />
        </Field>

        <Field label="Why" name="reason" required className="sm:col-span-2">
          <Textarea id="reason" name="reason" required rows={4} maxLength={4000} />
        </Field>
      </FormSection>
    </RecordForm>
  );
}

export { RiskPicker, ProjectField, MemberField };
