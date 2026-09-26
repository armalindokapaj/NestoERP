"use client";

import * as React from "react";
import type { InspectionResponseType } from "@prisma/client";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  INSPECTION_TYPES,
  RESPONSE_TYPES,
  inspectionTypeLabels,
  isVerdictResponse,
  responseTypeLabels,
} from "@/lib/modules/qaqc/qaqc.status";

/**
 * Building an inspection checklist (PRD #21 §50, §54–§57).
 *
 * Editing a template that has already been used writes a new version rather
 * than changing the old one, and the form says so — because somebody editing
 * "the concrete checklist" needs to know that past inspections keep the wording
 * they were actually held to (§53).
 */

export type TemplateItemValue = {
  code?: string;
  label: string;
  description?: string;
  responseType: string;
  required: boolean;
  passCriteriaText?: string;
  requiresEvidenceOnFail: boolean;
};

export type TemplateFormValues = {
  code: string;
  name: string;
  inspectionType: string;
  description: string;
  status: string;
  items: TemplateItemValue[];
};

const EMPTY: TemplateItemValue = {
  code: "",
  label: "",
  description: "",
  responseType: "PASS_FAIL",
  required: true,
  passCriteriaText: "",
  requiresEvidenceOnFail: false,
};

export function TemplateForm({
  action,
  values,
  versionUpdatedAt,
  cancelHref,
  submitLabel,
  pendingLabel,
  usageCount = 0,
  currentVersion = 1,
}: {
  action: (formData: FormData) => Promise<FormActionResult>;
  values?: TemplateFormValues;
  versionUpdatedAt?: string;
  cancelHref: string;
  submitLabel: string;
  pendingLabel: string;
  usageCount?: number;
  currentVersion?: number;
}) {
  const [items, setItems] = React.useState<TemplateItemValue[]>(
    values?.items && values.items.length > 0 ? values.items : [{ ...EMPTY }],
  );
  const errors = useFieldErrors();
  const itemError = errors.items?.[0];

  function update(index: number, patch: Partial<TemplateItemValue>) {
    setItems((current) =>
      current.map((item, position) => (position === index ? { ...item, ...patch } : item)),
    );
  }

  return (
    <RecordForm
      module="qaqc"
      action={action}
      cancelHref={cancelHref}
      submitLabel={submitLabel}
      pendingLabel={pendingLabel}
      versionUpdatedAt={versionUpdatedAt}
    >
      {usageCount > 0 ? (
        <p className="rounded-md border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted">
          {usageCount} inspection{usageCount === 1 ? " has" : "s have"} already been run against
          version {currentVersion}. Saving creates version {currentVersion + 1} and leaves the
          earlier one exactly as it is, so those inspections still read against what they were
          actually checked with.
        </p>
      ) : null}

      <FormSection
        title="Template"
        description="The checklist a company inspects against. Keeping one list means two sites cannot quietly hold the same work to different standards."
      >
        <Field label="Code" name="code" required>
          <Input id="code" name="code" defaultValue={values?.code ?? ""} required maxLength={40} />
        </Field>

        <Field label="Type" name="inspectionType" required>
          <select
            id="inspectionType"
            name="inspectionType"
            className={selectClass}
            defaultValue={values?.inspectionType ?? "WORK"}
          >
            {INSPECTION_TYPES.map((type) => (
              <option key={type} value={type}>
                {inspectionTypeLabels[type]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Name" name="name" required className="sm:col-span-2">
          <Input id="name" name="name" defaultValue={values?.name ?? ""} required maxLength={200} />
        </Field>

        <Field label="Status" name="status" required>
          <select
            id="status"
            name="status"
            className={selectClass}
            defaultValue={values?.status === "ARCHIVED" ? "INACTIVE" : (values?.status ?? "ACTIVE")}
          >
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </Field>

        <Field label="Description" name="description" className="sm:col-span-2">
          <Textarea
            id="description"
            name="description"
            rows={3}
            defaultValue={values?.description ?? ""}
            maxLength={2000}
          />
        </Field>
      </FormSection>

      <section className="nesto-card p-5">
        <h2 className="text-card font-semibold text-fg">Checks</h2>
        <p className="mt-1 text-meta text-fg-subtle">
          Each one is a question the inspector answers on site. A check that fails and needs
          evidence cannot be left blank when the inspection is submitted.
        </p>

        {itemError ? <p className="mt-3 text-meta text-danger-strong">{itemError}</p> : null}

        <div className="mt-4 space-y-3">
          {items.map((item, index) => (
            <div key={index} className="rounded-md border border-line p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="nesto-eyebrow text-fg-subtle">Check {index + 1}</p>
                {items.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove check ${index + 1}`}
                    onClick={() => setItems((current) => current.filter((_, i) => i !== index))}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                ) : null}
              </div>

              <div className="mt-3 space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor={`items-${index}-label`}>What is checked</Label>
                  <Input
                    id={`items-${index}-label`}
                    name={`items[${index}][label]`}
                    value={item.label}
                    onChange={(event) => update(index, { label: event.target.value })}
                    required
                    maxLength={300}
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor={`items-${index}-responseType`}>Answer</Label>
                    <select
                      id={`items-${index}-responseType`}
                      name={`items[${index}][responseType]`}
                      className={selectClass}
                      value={item.responseType}
                      onChange={(event) => update(index, { responseType: event.target.value })}
                    >
                      {RESPONSE_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {responseTypeLabels[type]}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor={`items-${index}-code`}>Reference</Label>
                    <Input
                      id={`items-${index}-code`}
                      name={`items[${index}][code]`}
                      value={item.code ?? ""}
                      onChange={(event) => update(index, { code: event.target.value })}
                      maxLength={40}
                      placeholder="Clause or item number"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor={`items-${index}-criteria`}>Passes when</Label>
                  <Input
                    id={`items-${index}-criteria`}
                    name={`items[${index}][passCriteriaText]`}
                    value={item.passCriteriaText ?? ""}
                    onChange={(event) => update(index, { passCriteriaText: event.target.value })}
                    maxLength={1000}
                    placeholder="The criterion the inspector holds it to"
                  />
                </div>

                <div className="flex flex-wrap gap-5">
                  <label className="flex items-center gap-2 text-table text-fg">
                    <Checkbox
                      name={`items[${index}][required]`}
                      checked={item.required}
                      onCheckedChange={(checked) => update(index, { required: checked === true })}
                    />
                    Must be answered
                  </label>

                  {isVerdictResponse(item.responseType as InspectionResponseType) ? (
                    <label className="flex items-center gap-2 text-table text-fg">
                      <Checkbox
                        name={`items[${index}][requiresEvidenceOnFail]`}
                        checked={item.requiresEvidenceOnFail}
                        onCheckedChange={(checked) =>
                          update(index, { requiresEvidenceOnFail: checked === true })
                        }
                      />
                      Needs a note if it fails
                    </label>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>

        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="mt-3"
          onClick={() => setItems((current) => [...current, { ...EMPTY }])}
        >
          <Plus aria-hidden="true" />
          Add a check
        </Button>
      </section>
    </RecordForm>
  );
}
