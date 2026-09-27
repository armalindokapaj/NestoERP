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
import { localDay, localMinute } from "@/components/hr/local-day";
import { useHseTranslations, type HseKey } from "@/components/hse/hse-text";
import { hseLabel } from "@/lib/i18n/modules/hse/labels";

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

/** The local calendar day, not the UTC one (AUD-09 §4, FV-07). */
function today(): string {
  return localDay();
}

function nowLocal(): string {
  return localMinute();
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
  label,
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
  const t = useHseTranslations();
  const heading = label ?? t("forms.risk");
  const both = likelihood !== "" && severity !== "";
  const score = both ? Number(likelihood) * Number(severity) : null;
  const level = score === null ? null : calculateRiskLevel(score);

  return (
    <>
      <Field label={t("forms.likelihoodOf", { label: heading })} name={likelihoodName} required={!optional}>
        <select
          id={likelihoodName}
          name={likelihoodName}
          className={selectClass}
          value={likelihood}
          onChange={(event) => onChange({ likelihood: event.target.value })}
          required={!optional}
        >
          {optional ? <option value="">{t("forms.notAssessed")}</option> : null}
          {AXIS.map((value) => (
            <option key={value} value={value}>
              {value} — {hseLabel(t, "likelihood", value, likelihoodLabels[value])}
            </option>
          ))}
        </select>
      </Field>

      <Field label={t("forms.severityOf", { label: heading })} name={severityName} required={!optional}>
        <select
          id={severityName}
          name={severityName}
          className={selectClass}
          value={severity}
          onChange={(event) => onChange({ severity: event.target.value })}
          required={!optional}
        >
          {optional ? <option value="">{t("forms.notAssessed")}</option> : null}
          {AXIS.map((value) => (
            <option key={value} value={value}>
              {value} — {hseLabel(t, "axisSeverity", value, axisLabels[value])}
            </option>
          ))}
        </select>
      </Field>

      <div className="sm:col-span-2">
        <p className="text-meta text-fg-muted" aria-live="polite">
          {level === null ? (
            optional ? (
              t("forms.giveBoth")
            ) : (
              t("forms.pickBoth")
            )
          ) : (
            <>
              {t("forms.scoreLine", { score: String(score), level: hseLabel(t, "riskLevel", level, riskLevelLabels[level]) })}
              {level === "CRITICAL" ? t("forms.criticalNeedsControl") : ""}
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
  const t = useHseTranslations();
  return (
    <Field label={t("record.project")} name="projectId" required={required} hint={hint}>
      <select
        id="projectId"
        name="projectId"
        className={selectClass}
        defaultValue={value ?? ""}
        required={required}
      >
        {required ? (
          <option value="">{t("forms.chooseProject")}</option>
        ) : (
          <option value="">{t("forms.noProject")}</option>
        )}
        {projects.map((project) => (
          <option key={project.value} value={project.value}>
            {project.label}
          </option>
        ))}
        <CurrentOption value={value} options={projects} />
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
  emptyLabel,
}: {
  members: Option[];
  name: string;
  label: string;
  value?: string;
  required?: boolean;
  emptyLabel?: string;
}) {
  const t = useHseTranslations();
  return (
    <Field label={label} name={name} required={required}>
      <select
        id={name}
        name={name}
        className={selectClass}
        defaultValue={value ?? ""}
        required={required}
      >
        <option value="">{emptyLabel ?? t("forms.nobodyYet")}</option>
        {members.map((member) => (
          <option key={member.value} value={member.value}>
            {member.label}
          </option>
        ))}
        <CurrentOption value={value} options={members} />
      </select>
    </Field>
  );
}

/**
 * The record's own value when the choices no longer hold it — a person who
 * has left, an archived project. Without it the select showed its first
 * option and the save silently emptied the field. It stays chosen, labelled
 * for what it is, and is not offered for anything new (AUD-09 §5, FV-09).
 *
 * AUD-09: candidate for lib/forms.
 */
export function CurrentOption({ value, options }: { value?: string | null; options: Option[] }) {
  const t = useHseTranslations();
  if (!value || options.some((option) => option.value === value)) return null;
  return <option value={value}>{t("forms.currentChoice")}</option>;
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
  const t = useHseTranslations();
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
        title={t("forms.whatDidYouSee")}
        description={t("forms.hazardIntro")}
      >
        <Field label={t("forms.title")} name="title" required className="sm:col-span-2">
          <Input id="title" name="title" defaultValue={values?.title ?? ""} required maxLength={200} />
        </Field>

        <Field label={t("record.description")} name="description" required className="sm:col-span-2">
          <Textarea
            id="description"
            name="description"
            defaultValue={values?.description ?? ""}
            required
            rows={4}
            maxLength={4000}
          />
        </Field>

        <Field label={t("record.category")} name="hazardCategory" required>
          <select
            id="hazardCategory"
            name="hazardCategory"
            className={selectClass}
            defaultValue={values?.hazardCategory ?? "OTHER"}
            required
          >
            {HAZARD_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {hseLabel(t, "hazardCategory", value, hazardCategoryLabels[value])}
              </option>
            ))}
          </select>
        </Field>

        <ProjectField projects={projects} value={values?.projectId} />

        <Field label={t("record.location")} name="locationText">
          <Input
            id="locationText"
            name="locationText"
            defaultValue={values?.locationText ?? ""}
            maxLength={200}
            placeholder={t("forms.locationPlaceholder")}
          />
        </Field>

        <Field label={t("record.observed")} name="observedAt" required>
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
        title={t("forms.risk")}
        description={t("forms.riskIntro")}
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
        title={t("hazard.detail.controls")}
        description={t("forms.controlsIntro")}
      >
        <Field
          label={t("forms.immediateControl")}
          name="immediateControl"
          required={critical}
          className="sm:col-span-2"
          hint={
            critical
              ? t("forms.criticalControlHint")
              : t("forms.straightAway")
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

        <Field label={t("forms.controlMeasure")} name="controlMeasure" className="sm:col-span-2">
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
            label={t("forms.assignTo")}
            value={values?.assignedToMemberId}
            emptyLabel={t("table.unassigned")}
          />
        ) : (
          // Not the reader's to change, so the edit carries the assignee it opened with — the
          // server refuses a different one — rather than "nobody", which read as a reassignment
          // and refused every edit of an assigned hazard (AUD-09 §5, FV-10).
          <input type="hidden" name="assignedToMemberId" value={values?.assignedToMemberId ?? ""} />
        )}

        <Field label={t("record.due")} name="dueDate">
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
  const t = useHseTranslations();
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
        title={t("incident.detail.whatHappened")}
        description={t("forms.incidentIntro")}
      >
        <Field label={t("record.type")} name="incidentType" required>
          <select
            id="incidentType"
            name="incidentType"
            className={selectClass}
            defaultValue={values?.incidentType ?? "INCIDENT"}
            required
          >
            {INCIDENT_TYPES.map((value) => (
              <option key={value} value={value}>
                {hseLabel(t, "incidentType", value, incidentTypeLabels[value])}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t("record.severity")} name="severity" required>
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
                {hseLabel(t, "severity", value, severityLabels[value])}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t("forms.title")} name="title" required className="sm:col-span-2">
          <Input id="title" name="title" defaultValue={values?.title ?? ""} required maxLength={200} />
        </Field>

        <Field label={t("record.description")} name="description" required className="sm:col-span-2">
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

        <Field label={t("record.location")} name="locationText">
          <Input
            id="locationText"
            name="locationText"
            defaultValue={values?.locationText ?? ""}
            maxLength={200}
          />
        </Field>

        <Field label={t("incident.detail.occurred")} name="occurredAt" required>
          <Input
            id="occurredAt"
            name="occurredAt"
            type="datetime-local"
            defaultValue={values?.occurredAt ?? nowLocal()}
            required
          />
        </Field>

        <Field label={t("record.due")} name="dueDate">
          <Input id="dueDate" name="dueDate" type="date" defaultValue={values?.dueDate ?? ""} />
        </Field>
      </FormSection>

      <FormSection
        title={t("incident.detail.whatResulted")}
        // The whole of what V0.1 records about somebody being hurt. No
        // diagnosis field exists to fill in (PRD #22 §22, §87).
        description={t("forms.flagsIntro")}
      >
        <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2">
          <Flag name="injuryOccurred" label={t("forms.flag.injury")} defaultChecked={values?.injuryOccurred} />
          <Flag name="firstAidRequired" label={t("forms.flag.firstAid")} defaultChecked={values?.firstAidRequired} />
          <Flag name="medicalTreatmentRequired" label={t("forms.flag.medical")} defaultChecked={values?.medicalTreatmentRequired} />
          <Flag name="lostTime" label={t("forms.flag.lostTime")} defaultChecked={values?.lostTime} />
          <Flag name="propertyDamage" label={t("forms.flag.property")} defaultChecked={values?.propertyDamage} />
          <Flag name="environmentalImpact" label={t("forms.flag.environment")} defaultChecked={values?.environmentalImpact} />
        </div>

        <Field
          label={t("incident.detail.immediateAction")}
          name="immediateAction"
          required={serious}
          className="sm:col-span-2"
          hint={
            serious
              ? t("forms.seriousActionHint")
              : t("forms.straightAway")
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
  const t = useHseTranslations();
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
        title={t("record.inspection")}
        description={t("forms.inspectionIntro")}
      >
        <Field label={t("record.type")} name="inspectionType" required>
          <select
            id="inspectionType"
            name="inspectionType"
            className={selectClass}
            defaultValue={values?.inspectionType ?? "SITE_SAFETY"}
            required
          >
            {INSPECTION_TYPES.map((value) => (
              <option key={value} value={value}>
                {hseLabel(t, "inspectionType", value, inspectionTypeLabels[value])}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t("inspection.detail.checklist")} name="templateId" hint={t("forms.freeForm")}>
          <select
            id="templateId"
            name="templateId"
            className={selectClass}
            defaultValue={values?.templateId ?? ""}
          >
            <option value="">{t("forms.noChecklist")}</option>
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
          label={t("inspection.detail.inspector")}
          value={values?.assignedInspectorMemberId}
          required
          emptyLabel={t("forms.chooseInspector")}
        />

        <Field label={t("record.location")} name="locationText">
          <Input
            id="locationText"
            name="locationText"
            defaultValue={values?.locationText ?? ""}
            maxLength={200}
          />
        </Field>

        <Field label={t("forms.scheduledFor")} name="scheduledDate">
          <Input
            id="scheduledDate"
            name="scheduledDate"
            type="date"
            defaultValue={values?.scheduledDate ?? ""}
          />
        </Field>

        <Field label={t("record.notes")} name="summary" className="sm:col-span-2">
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
  const t = useHseTranslations();
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
        title={t("forms.permit")}
        description={t("forms.permitIntro")}
      >
        <Field label={t("record.type")} name="permitType" required>
          <select
            id="permitType"
            name="permitType"
            className={selectClass}
            defaultValue={values?.permitType ?? "GENERAL"}
            required
          >
            {PERMIT_TYPES.map((value) => (
              <option key={value} value={value}>
                {hseLabel(t, "permitType", value, permitTypeLabels[value])}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t("forms.title")} name="title" required>
          <Input id="title" name="title" defaultValue={values?.title ?? ""} required maxLength={200} />
        </Field>

        <ProjectField projects={projects} value={values?.projectId} required />

        <Field label={t("record.location")} name="locationText" required>
          <Input
            id="locationText"
            name="locationText"
            defaultValue={values?.locationText ?? ""}
            required
            maxLength={200}
          />
        </Field>

        <Field label={t("permit.detail.validFrom")} name="validFrom" required>
          <Input
            id="validFrom"
            name="validFrom"
            type="datetime-local"
            defaultValue={values?.validFrom ?? nowLocal()}
            required
          />
        </Field>

        <Field label={t("permit.detail.validUntil")} name="validUntil" required>
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
          label={t("forms.responsiblePerson")}
          value={values?.responsibleMemberId}
        />

        <Field label={t("permit.detail.riskAssessment")} name="riskAssessmentId">
          <select
            id="riskAssessmentId"
            name="riskAssessmentId"
            className={selectClass}
            defaultValue={values?.riskAssessmentId ?? ""}
          >
            <option value="">{t("permit.detail.noneCited")}</option>
            {assessments.map((assessment) => (
              <option key={assessment.value} value={assessment.value}>
                {assessment.label}
              </option>
            ))}
            {/* A superseded or unseen assessment the permit already cites is kept, not unlinked (AUD-09 §5, FV-09). */}
            <CurrentOption value={values?.riskAssessmentId} options={assessments} />
          </select>
        </Field>
      </FormSection>

      <FormSection
        title={t("permit.detail.hazardsAndControls")}
        description={t("forms.hazardsControlsIntro")}
      >
        <Field label={t("permit.detail.hazards")} name="hazardsSummary" className="sm:col-span-2">
          <Textarea
            id="hazardsSummary"
            name="hazardsSummary"
            defaultValue={values?.hazardsSummary ?? ""}
            rows={3}
            maxLength={4000}
          />
        </Field>

        <Field label={t("hazard.detail.controls")} name="controlsSummary" className="sm:col-span-2">
          <Textarea
            id="controlsSummary"
            name="controlsSummary"
            defaultValue={values?.controlsSummary ?? ""}
            rows={3}
            maxLength={4000}
          />
        </Field>

        <Field label={t("permit.detail.ppeRequired")} name="ppeRequirements" className="sm:col-span-2">
          <Textarea
            id="ppeRequirements"
            name="ppeRequirements"
            defaultValue={values?.ppeRequirements ?? ""}
            rows={2}
            maxLength={2000}
          />
        </Field>

        <Field label={t("permit.detail.specialConditions")} name="specialConditions" className="sm:col-span-2">
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
  const t = useHseTranslations();
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
        title={t("forms.action")}
        description={t("forms.actionIntro")}
      >
        {parent ? <input type="hidden" name={parent.field} value={parent.id} /> : null}

        {parent ? (
          <div className="sm:col-span-2">
            <p className="text-meta text-fg-muted">{raisedAgainst(t, parent)}</p>
          </div>
        ) : null}

        <Field label={t("record.type")} name="actionType" required>
          <select
            id="actionType"
            name="actionType"
            className={selectClass}
            defaultValue={values?.actionType ?? "CORRECTIVE"}
            required
          >
            {ACTION_TYPES.map((value) => (
              <option key={value} value={value}>
                {hseLabel(t, "actionType", value, actionTypeLabels[value])}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t("record.priority")} name="priority" required>
          <select
            id="priority"
            name="priority"
            className={selectClass}
            defaultValue={values?.priority ?? "MEDIUM"}
            required
          >
            {PRIORITIES.map((value) => (
              <option key={value} value={value}>
                {hseLabel(t, "priority", value, priorityLabels[value])}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t("forms.title")} name="title" required className="sm:col-span-2">
          <Input id="title" name="title" defaultValue={values?.title ?? ""} required maxLength={200} />
        </Field>

        <Field label={t("action.detail.whatNeedsDoing")} name="description" required className="sm:col-span-2">
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
          label={t("permit.detail.responsible")}
          value={values?.assignedToMemberId}
          required
          emptyLabel={t("forms.chooseResponsible")}
        />

        <Field label={t("record.due")} name="dueDate">
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
  const t = useHseTranslations();
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
        title={t("forms.observation")}
        description={t("forms.observationIntro")}
      >
        <Field label={t("record.category")} name="category" required>
          <select
            id="category"
            name="category"
            className={selectClass}
            defaultValue={values?.category ?? "OTHER"}
            required
          >
            {ENVIRONMENTAL_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {hseLabel(t, "environmentalCategory", value, environmentalCategoryLabels[value])}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t("record.severity")} name="severity" required>
          <select
            id="severity"
            name="severity"
            className={selectClass}
            defaultValue={values?.severity ?? "MEDIUM"}
            required
          >
            {SEVERITIES.map((value) => (
              <option key={value} value={value}>
                {hseLabel(t, "severity", value, severityLabels[value])}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t("forms.title")} name="title" required className="sm:col-span-2">
          <Input id="title" name="title" defaultValue={values?.title ?? ""} required maxLength={200} />
        </Field>

        <Field label={t("record.description")} name="description" required className="sm:col-span-2">
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

        <Field label={t("record.location")} name="locationText">
          <Input
            id="locationText"
            name="locationText"
            defaultValue={values?.locationText ?? ""}
            maxLength={200}
          />
        </Field>

        <Field label={t("record.observed")} name="observedAt" required>
          <Input
            id="observedAt"
            name="observedAt"
            type="date"
            defaultValue={values?.observedAt ?? today()}
            required
          />
        </Field>

        <Field label={t("record.due")} name="dueDate">
          <Input id="dueDate" name="dueDate" type="date" defaultValue={values?.dueDate ?? ""} />
        </Field>

        {canAssign ? (
          <MemberField
            members={members}
            name="assignedToMemberId"
            label={t("forms.assignTo")}
            value={values?.assignedToMemberId}
            emptyLabel={t("table.unassigned")}
          />
        ) : (
          // Not the reader's to change, so the edit carries the assignee it opened with — the
          // server refuses a different one — rather than "nobody", which read as a reassignment
          // and refused every edit of an assigned hazard (AUD-09 §5, FV-10).
          <input type="hidden" name="assignedToMemberId" value={values?.assignedToMemberId ?? ""} />
        )}

        <Field label={t("incident.detail.immediateAction")} name="immediateAction" className="sm:col-span-2">
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
  const t = useHseTranslations();
  return (
    <RecordForm
      module="hse"
      action={action}
      cancelHref={cancelHref}
      submitLabel={t("pages.stopWork.title")}
      pendingLabel={t("forms.stopping")}
      // Raising the order is this form's create (AUD-03 §3): the label is a verb, not "Create".
      saveKind="create"
    >
      <FormSection
        title={t("pages.stopWork.title")}
        description={t("forms.stopWorkIntro")}
      >
        {parent ? <input type="hidden" name={parent.field} value={parent.id} /> : null}

        <Field label={t("forms.title")} name="title" required className="sm:col-span-2">
          <Input id="title" name="title" required maxLength={200} />
        </Field>

        <ProjectField projects={projects} value={parent?.projectId} required />

        <Field label={t("record.location")} name="locationText">
          <Input id="locationText" name="locationText" maxLength={200} />
        </Field>

        <Field label={t("forms.why")} name="reason" required className="sm:col-span-2">
          <Textarea id="reason" name="reason" required rows={4} maxLength={4000} />
        </Field>
      </FormSection>
    </RecordForm>
  );
}

/** t("forms.raisedAgainst.hazardId") — one sentence per parent kind, since the article does not translate. */
function raisedAgainst(t: ReturnType<typeof useHseTranslations>, parent: { field: string; label: string }): string {
  const key = `forms.raisedAgainst.${parent.field}` as HseKey;
  const text = t(key);
  return text === key ? t("forms.raisedAgainstOther", { label: parent.label }) : text;
}

export { RiskPicker, ProjectField, MemberField };
