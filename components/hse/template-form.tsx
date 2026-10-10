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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  INSPECTION_TYPES,
  RESPONSE_TYPES,
  SEVERITIES,
  inspectionTypeLabels,
  responseTypeLabels,
  severityLabels,
} from "@/lib/modules/hse/hse.status";
import { useHseTranslations } from "@/components/hse/hse-text";
import { hseLabel } from "@/lib/i18n/modules/hse/labels";
import { FormSelect } from "@/components/ui/form-select";

/**
 * Building a safety checklist (PRD #22 §43, §45, §349).
 *
 * Editing a version that has already been used writes a new version rather than
 * changing the old one, and the form says so — because somebody editing "the
 * scaffold checklist" needs to know that past inspections keep the wording they
 * were actually held to.
 *
 * Each check may carry the risk its failure represents, which is what lets an
 * inspector see on site that a blank fire-exit check is not the same as a blank
 * housekeeping one (§45, §48).
 */

export type TemplateItemValue = {
  code?: string;
  label: string;
  description?: string;
  responseType: string;
  required: boolean;
  riskIfFailed?: string;
  requiresNoteOnFail: boolean;
};

export type TemplateFormValues = {
  code: string;
  name: string;
  inspectionType: string;
  description: string;
  items: TemplateItemValue[];
};

const EMPTY: TemplateItemValue = {
  code: "",
  label: "",
  description: "",
  responseType: "PASS_FAIL",
  required: true,
  riskIfFailed: "",
  requiresNoteOnFail: true,
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
  const t = useHseTranslations();
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
      module="hse"
      action={action}
      cancelHref={cancelHref}
      submitLabel={submitLabel}
      pendingLabel={pendingLabel}
      versionUpdatedAt={versionUpdatedAt}
    >
      {usageCount > 0 ? (
        <p className="rounded-md border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted">
          {t("forms.usageVersion", { count: usageCount, current: currentVersion, next: currentVersion + 1 })}
        </p>
      ) : null}

      <FormSection
        title={t("record.checklist")}
        description={t("forms.checklistIntro")}
      >
        <Field label={t("forms.code")} name="code" required>
          <Input id="code" name="code" defaultValue={values?.code ?? ""} required maxLength={40} />
        </Field>

        <Field label={t("record.type")} name="inspectionType" required>
          <FormSelect
            id="inspectionType"
            name="inspectionType"
            className={selectClass}
            defaultValue={values?.inspectionType ?? "SITE_SAFETY"}
          >
            {INSPECTION_TYPES.map((type) => (
              <option key={type} value={type}>
                {hseLabel(t, "inspectionType", type, inspectionTypeLabels[type])}
              </option>
            ))}
          </FormSelect>
        </Field>

        <Field label={t("forms.name")} name="name" required className="sm:col-span-2">
          <Input id="name" name="name" defaultValue={values?.name ?? ""} required maxLength={200} />
        </Field>

        <Field label={t("record.description")} name="description" className="sm:col-span-2">
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
        <h2 className="text-card font-semibold text-fg">{t("template.detail.checks")}</h2>
        <p className="mt-1 text-meta text-fg-subtle">
          Each one is a question the inspector answers on site. A check that fails and needs a
          note cannot be left blank when the inspection is submitted.
        </p>

        {itemError ? <p className="mt-3 text-meta text-danger-strong">{itemError}</p> : null}

        <div className="mt-4 space-y-3">
          {items.map((item, index) => (
            <div key={index} className="rounded-md border border-line p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="nesto-eyebrow text-fg-subtle">{t("forms.checkN", { n: index + 1 })}</p>
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
                    <span className="sr-only">{t("forms.removeCheckN", { n: index + 1 })}</span>
                  </Button>
                ) : null}
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-6">
                <div className="space-y-1.5 sm:col-span-1">
                  <Label htmlFor={`item-code-${index}`}>{t("forms.ref")}</Label>
                  <Input
                    id={`item-code-${index}`}
                    name={`items[${index}][code]`}
                    value={item.code ?? ""}
                    onChange={(event) => update(index, { code: event.target.value })}
                    maxLength={40}
                  />
                </div>

                <div className="space-y-1.5 sm:col-span-5">
                  <Label htmlFor={`item-label-${index}`}>{t("forms.whatIsChecked")}</Label>
                  <Input
                    id={`item-label-${index}`}
                    name={`items[${index}][label]`}
                    value={item.label}
                    onChange={(event) => update(index, { label: event.target.value })}
                    required
                    maxLength={300}
                    placeholder={t("forms.checkPlaceholder")}
                  />
                </div>

                <div className="space-y-1.5 sm:col-span-6">
                  <Label htmlFor={`item-description-${index}`}>{t("forms.guidance")}</Label>
                  <Textarea
                    id={`item-description-${index}`}
                    name={`items[${index}][description]`}
                    rows={2}
                    value={item.description ?? ""}
                    onChange={(event) => update(index, { description: event.target.value })}
                    maxLength={2000}
                  />
                </div>

                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor={`item-response-${index}`}>{t("forms.answerType")}</Label>
                  <FormSelect
                    id={`item-response-${index}`}
                    name={`items[${index}][responseType]`}
                    className={selectClass}
                    value={item.responseType}
                    onChange={(event) => update(index, { responseType: event.target.value })}
                  >
                    {RESPONSE_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {hseLabel(t, "responseType", type, responseTypeLabels[type])}
                      </option>
                    ))}
                  </FormSelect>
                </div>

                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor={`item-risk-${index}`}>{t("forms.riskIfFails")}</Label>
                  <FormSelect
                    id={`item-risk-${index}`}
                    name={`items[${index}][riskIfFailed]`}
                    className={selectClass}
                    value={item.riskIfFailed ?? ""}
                    onChange={(event) => update(index, { riskIfFailed: event.target.value })}
                  >
                    <option value="">{t("forms.notRated")}</option>
                    {SEVERITIES.map((value) => (
                      <option key={value} value={value}>
                        {hseLabel(t, "severity", value, severityLabels[value])}
                      </option>
                    ))}
                  </FormSelect>
                </div>

                <div className="flex flex-col justify-end gap-2 sm:col-span-2">
                  <div className="flex items-center gap-2.5">
                    <Checkbox
                      id={`item-required-${index}`}
                      name={`items[${index}][required]`}
                      checked={item.required}
                      onCheckedChange={(checked) =>
                        update(index, { required: checked === true })
                      }
                    />
                    <Label
                      htmlFor={`item-required-${index}`}
                      className="text-body font-normal text-fg-muted"
                    >
                      {t("forms.mustBeAnswered")}
                    </Label>
                  </div>

                  <div className="flex items-center gap-2.5">
                    <Checkbox
                      id={`item-note-${index}`}
                      name={`items[${index}][requiresNoteOnFail]`}
                      checked={item.requiresNoteOnFail}
                      onCheckedChange={(checked) =>
                        update(index, { requiresNoteOnFail: checked === true })
                      }
                    />
                    <Label
                      htmlFor={`item-note-${index}`}
                      className="text-body font-normal text-fg-muted"
                    >
                      {t("template.detail.needsNote")}
                    </Label>
                  </div>
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
          {t("forms.addCheck")}
        </Button>
      </section>
    </RecordForm>
  );
}
