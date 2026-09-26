"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";

import {
  Field,
  FormSection,
  RecordForm,
  selectClass,
  useFieldErrors,
  type FormActionResult,
} from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  calculateRiskLevel,
  likelihoodLabels,
  riskLevelLabels,
  severityLabels as axisLabels,
} from "@/lib/modules/hse/hse.risk";
import type { Option } from "./hse-forms";

/**
 * A risk assessment, line by line (PRD #22 §101, §104, §318).
 *
 * Each line is a hazard, what already controls it, what the risk is, what else
 * will be done, and what is left after that. The two little previews are
 * computed with the same functions the server runs, so the page and the
 * database can never disagree about what CRITICAL means — and neither number is
 * ever posted (PRD #22 §105, §243).
 *
 * Residual risk is all-or-nothing per line: both axes or neither. Half an
 * assessment renders as a number that means nothing.
 */

export type RiskItemValue = {
  hazardDescription: string;
  existingControls?: string;
  likelihood: string;
  severity: string;
  additionalControls?: string;
  residualLikelihood?: string;
  residualSeverity?: string;
  responsibleMemberId?: string;
  dueDate?: string;
};

export type RiskAssessmentFormValues = {
  title: string;
  description: string;
  projectId: string;
  activityType: string;
  locationText: string;
  ownerMemberId: string;
  assessmentDate: string;
  reviewDate: string;
  items: RiskItemValue[];
};

const EMPTY: RiskItemValue = {
  hazardDescription: "",
  existingControls: "",
  likelihood: "3",
  severity: "3",
  additionalControls: "",
  residualLikelihood: "",
  residualSeverity: "",
  responsibleMemberId: "",
  dueDate: "",
};

const AXIS = [1, 2, 3, 4, 5];

function Preview({ likelihood, severity }: { likelihood: string; severity: string }) {
  if (!likelihood || !severity) {
    return <span className="text-fg-subtle">Not assessed</span>;
  }
  const score = Number(likelihood) * Number(severity);
  return (
    <span>
      <strong className="text-fg">{score}</strong> · {riskLevelLabels[calculateRiskLevel(score)]}
    </span>
  );
}

export function RiskAssessmentForm({
  action,
  values,
  versionUpdatedAt,
  cancelHref,
  submitLabel,
  pendingLabel,
  projects,
  members,
  willVersion = false,
  currentVersion = 1,
}: {
  action: (formData: FormData) => Promise<FormActionResult>;
  values?: RiskAssessmentFormValues;
  versionUpdatedAt?: string;
  cancelHref: string;
  submitLabel: string;
  pendingLabel: string;
  projects: Option[];
  members: Option[];
  willVersion?: boolean;
  currentVersion?: number;
}) {
  const [items, setItems] = React.useState<RiskItemValue[]>(
    values?.items && values.items.length > 0 ? values.items : [{ ...EMPTY }],
  );
  const errors = useFieldErrors();
  const itemError = errors.items?.[0];

  function update(index: number, patch: Partial<RiskItemValue>) {
    setItems((current) =>
      current.map((item, position) => (position === index ? { ...item, ...patch } : item)),
    );
  }

  return (
    <RecordForm
      module="hse"
      action={action}
      cancelHref={cancelHref}
      submitLabel={submitLabel}
      pendingLabel={pendingLabel}
      versionUpdatedAt={versionUpdatedAt}
    >
      {willVersion ? (
        <p className="rounded-md border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted">
          This assessment has been approved. Saving creates version {currentVersion + 1} and
          leaves version {currentVersion} exactly as it is — site work was carried out against
          it, and a method statement may quote it.
        </p>
      ) : null}

      <FormSection
        title="Assessment"
        description="A structured look at one activity: what could hurt somebody, and what is being done about it."
      >
        <Field label="Title" name="title" required className="sm:col-span-2">
          <Input id="title" name="title" defaultValue={values?.title ?? ""} required maxLength={200} />
        </Field>

        <Field label="Activity" name="activityType">
          <Input
            id="activityType"
            name="activityType"
            defaultValue={values?.activityType ?? ""}
            maxLength={200}
            placeholder="Steel erection, level 4"
          />
        </Field>

        <Field label="Location" name="locationText">
          <Input
            id="locationText"
            name="locationText"
            defaultValue={values?.locationText ?? ""}
            maxLength={200}
          />
        </Field>

        <Field label="Project" name="projectId">
          <select
            id="projectId"
            name="projectId"
            className={selectClass}
            defaultValue={values?.projectId ?? ""}
          >
            <option value="">No project — company-wide</option>
            {projects.map((project) => (
              <option key={project.value} value={project.value}>
                {project.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Owner" name="ownerMemberId">
          <select
            id="ownerMemberId"
            name="ownerMemberId"
            className={selectClass}
            defaultValue={values?.ownerMemberId ?? ""}
          >
            <option value="">Nobody yet</option>
            {members.map((member) => (
              <option key={member.value} value={member.value}>
                {member.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Assessed on" name="assessmentDate" required>
          <Input
            id="assessmentDate"
            name="assessmentDate"
            type="date"
            defaultValue={values?.assessmentDate ?? new Date().toISOString().slice(0, 10)}
            required
          />
        </Field>

        <Field
          label="Review by"
          name="reviewDate"
          hint="Flagged for attention when it passes. Nothing expires by itself."
        >
          <Input
            id="reviewDate"
            name="reviewDate"
            type="date"
            defaultValue={values?.reviewDate ?? ""}
          />
        </Field>

        <Field label="Description" name="description" className="sm:col-span-2">
          <Textarea
            id="description"
            name="description"
            rows={3}
            defaultValue={values?.description ?? ""}
            maxLength={4000}
          />
        </Field>
      </FormSection>

      <section className="nesto-card p-5">
        <h2 className="text-card font-semibold text-fg">Hazards</h2>
        <p className="mt-1 text-meta text-fg-subtle">
          One line per hazard. Score it as it is now, then again as it will be once the extra
          controls are in.
        </p>

        {itemError ? <p className="mt-3 text-meta text-danger-strong">{itemError}</p> : null}

        <div className="mt-4 space-y-3">
          {items.map((item, index) => (
            <div key={index} className="rounded-md border border-line p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="nesto-eyebrow text-fg-subtle">Hazard {index + 1}</p>
                {items.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setItems((current) => current.filter((_, position) => position !== index))
                    }
                  >
                    <Trash2 aria-hidden="true" />
                    <span className="sr-only">Remove hazard {index + 1}</span>
                  </Button>
                ) : null}
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-4">
                <div className="space-y-1.5 sm:col-span-4">
                  <Label htmlFor={`item-hazard-${index}`}>Hazard</Label>
                  <Textarea
                    id={`item-hazard-${index}`}
                    name={`items[${index}][hazardDescription]`}
                    rows={2}
                    value={item.hazardDescription}
                    onChange={(event) =>
                      update(index, { hazardDescription: event.target.value })
                    }
                    required
                    maxLength={2000}
                  />
                </div>

                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor={`item-existing-${index}`}>Controls already in place</Label>
                  <Textarea
                    id={`item-existing-${index}`}
                    name={`items[${index}][existingControls]`}
                    rows={2}
                    value={item.existingControls ?? ""}
                    onChange={(event) => update(index, { existingControls: event.target.value })}
                    maxLength={2000}
                  />
                </div>

                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor={`item-additional-${index}`}>Further controls</Label>
                  <Textarea
                    id={`item-additional-${index}`}
                    name={`items[${index}][additionalControls]`}
                    rows={2}
                    value={item.additionalControls ?? ""}
                    onChange={(event) =>
                      update(index, { additionalControls: event.target.value })
                    }
                    maxLength={2000}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor={`item-likelihood-${index}`}>Likelihood</Label>
                  <select
                    id={`item-likelihood-${index}`}
                    name={`items[${index}][likelihood]`}
                    className={selectClass}
                    value={item.likelihood}
                    onChange={(event) => update(index, { likelihood: event.target.value })}
                    required
                  >
                    {AXIS.map((value) => (
                      <option key={value} value={value}>
                        {value} — {likelihoodLabels[value]}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor={`item-severity-${index}`}>Severity</Label>
                  <select
                    id={`item-severity-${index}`}
                    name={`items[${index}][severity]`}
                    className={selectClass}
                    value={item.severity}
                    onChange={(event) => update(index, { severity: event.target.value })}
                    required
                  >
                    {AXIS.map((value) => (
                      <option key={value} value={value}>
                        {value} — {axisLabels[value]}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5 sm:col-span-2">
                  <span className="block text-meta font-medium text-fg-muted">Risk</span>
                  <p className="pt-2 text-table" aria-live="polite">
                    <Preview likelihood={item.likelihood} severity={item.severity} />
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor={`item-res-likelihood-${index}`}>Residual likelihood</Label>
                  <select
                    id={`item-res-likelihood-${index}`}
                    name={`items[${index}][residualLikelihood]`}
                    className={selectClass}
                    value={item.residualLikelihood ?? ""}
                    onChange={(event) =>
                      update(index, { residualLikelihood: event.target.value })
                    }
                  >
                    <option value="">Not assessed</option>
                    {AXIS.map((value) => (
                      <option key={value} value={value}>
                        {value} — {likelihoodLabels[value]}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor={`item-res-severity-${index}`}>Residual severity</Label>
                  <select
                    id={`item-res-severity-${index}`}
                    name={`items[${index}][residualSeverity]`}
                    className={selectClass}
                    value={item.residualSeverity ?? ""}
                    onChange={(event) => update(index, { residualSeverity: event.target.value })}
                  >
                    <option value="">Not assessed</option>
                    {AXIS.map((value) => (
                      <option key={value} value={value}>
                        {value} — {axisLabels[value]}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5 sm:col-span-2">
                  <span className="block text-meta font-medium text-fg-muted">
                    Risk after controls
                  </span>
                  <p className="pt-2 text-table" aria-live="polite">
                    <Preview
                      likelihood={item.residualLikelihood ?? ""}
                      severity={item.residualSeverity ?? ""}
                    />
                  </p>
                </div>

                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor={`item-responsible-${index}`}>Responsible</Label>
                  <select
                    id={`item-responsible-${index}`}
                    name={`items[${index}][responsibleMemberId]`}
                    className={selectClass}
                    value={item.responsibleMemberId ?? ""}
                    onChange={(event) =>
                      update(index, { responsibleMemberId: event.target.value })
                    }
                  >
                    <option value="">Nobody yet</option>
                    {members.map((member) => (
                      <option key={member.value} value={member.value}>
                        {member.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor={`item-due-${index}`}>By when</Label>
                  <Input
                    id={`item-due-${index}`}
                    name={`items[${index}][dueDate]`}
                    type="date"
                    value={item.dueDate ?? ""}
                    onChange={(event) => update(index, { dueDate: event.target.value })}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="mt-4"
          onClick={() => setItems((current) => [...current, { ...EMPTY }])}
        >
          <Plus aria-hidden="true" />
          Add a hazard
        </Button>
      </section>
    </RecordForm>
  );
}
