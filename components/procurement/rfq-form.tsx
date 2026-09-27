"use client";

import * as React from "react";

import {
  Field,
  FormSection,
  RecordForm,
  selectClass,
  type FormActionResult,
  type SelectOption,
} from "@/components/forms/record-form";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { currencyOptions } from "@/lib/modules/finance/finance.currency";
import { LineItemsEditor, type LineValue } from "./line-items";
import { withSavedOption } from "@/components/finance/saved-option";
import { useProcurementTranslations } from "./procurement-text";

export type RfqFormValues = {
  title: string;
  purchaseRequestId: string;
  projectId: string;
  currency: string;
  responseDueDate: string;
  supplierIds: string[];
  items: LineValue[];
};

/**
 * Draft or revise an enquiry (PRD #19 §70, §267, §268).
 *
 * At least two suppliers before it can be issued: an enquiry sent to one is a
 * price check, not a comparison, and the product says so rather than producing
 * a one-row comparison screen that looks competitive (PRD #19 §72).
 */
export function RfqForm({
  action,
  suppliers,
  projects,
  requests,
  values,
  versionUpdatedAt,
  cancelHref,
  submitLabel,
  pendingLabel,
}: {
  action: (formData: FormData) => Promise<FormActionResult>;
  suppliers: SelectOption[];
  projects: SelectOption[];
  requests: SelectOption[];
  values?: RfqFormValues;
  versionUpdatedAt?: string;
  cancelHref: string;
  submitLabel: string;
  pendingLabel: string;
}) {
  const t = useProcurementTranslations();
  const [selected, setSelected] = React.useState<string[]>(values?.supplierIds ?? []);
  const offered = selected.filter((id) => suppliers.some((supplier) => supplier.value === id));
  const dropped = selected.length - offered.length;
  // Saved links the pickers no longer offer stay on this enquiry (FV-10).
  const requestOptions = withSavedOption(requests, values?.purchaseRequestId, t("rfqs.savedRequest"));
  const projectOptions = withSavedOption(projects, values?.projectId, t("rfqs.savedProject"));

  return (
    <RecordForm
      action={action}
      module="procurement"
      cancelHref={cancelHref}
      submitLabel={submitLabel}
      pendingLabel={pendingLabel}
      versionUpdatedAt={versionUpdatedAt}
    >
      <FormSection
        title={t("common.enquiry")}
        description={t("rfqs.formDescription")}
      >
        <Field label={t("common.title")} name="title" required className="sm:col-span-2">
          <Input id="title" name="title" defaultValue={values?.title ?? ""} required maxLength={250} />
        </Field>

        <Field label={t("common.currency")} name="currency" required hint={t("rfqs.currencyHint")}>
          <select
            id="currency"
            name="currency"
            className={selectClass}
            defaultValue={values?.currency ?? "EUR"}
            required
          >
            {currencyOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t("rfqs.responsesBy")} name="responseDueDate">
          <Input
            id="responseDueDate"
            name="responseDueDate"
            type="date"
            defaultValue={values?.responseDueDate ?? ""}
          />
        </Field>

        <Field label={t("common.purchaseRequest")} name="purchaseRequestId">
          <select
            id="purchaseRequestId"
            name="purchaseRequestId"
            className={selectClass}
            defaultValue={values?.purchaseRequestId ?? ""}
          >
            <option value="">{t("rfqs.notFromRequest")}</option>
            {requestOptions.map((request) => (
              <option key={request.value} value={request.value}>
                {request.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t("common.project")} name="projectId">
          <select
            id="projectId"
            name="projectId"
            className={selectClass}
            defaultValue={values?.projectId ?? ""}
          >
            <option value="">{t("common.noProject")}</option>
            {projectOptions.map((project) => (
              <option key={project.value} value={project.value}>
                {project.label}
              </option>
            ))}
          </select>
        </Field>
      </FormSection>

      <FormSection
        title={t("rfqs.suppliersSection")}
        description={t("rfqs.suppliersDescription")}
      >
        <div className="sm:col-span-2">
          <fieldset className="space-y-2">
            <legend className="sr-only">{t("rfqs.suppliersLegend")}</legend>
            {suppliers.length === 0 ? (
              <p className="text-table text-fg-subtle">
                {t("rfqs.noSuppliers")}
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {suppliers.map((supplier) => {
                  const checked = selected.includes(supplier.value);
                  return (
                    <label
                      key={supplier.value}
                      className="flex items-center gap-2.5 rounded-md border border-line px-3 py-2.5 text-table text-fg"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(next) =>
                          setSelected((current) =>
                            next === true
                              ? [...current, supplier.value]
                              : current.filter((id) => id !== supplier.value),
                          )
                        }
                      />
                      <span>{supplier.label}</span>
                      {checked ? (
                        <input type="hidden" name="supplierIds" value={supplier.value} />
                      ) : null}
                    </label>
                  );
                })}
              </div>
            )}
            <p className="text-meta text-fg-subtle" aria-live="polite">
              {t("rfqs.selected", { count: offered.length })}
              {offered.length < 2 ? t("rfqs.needTwo") : "."}
            </p>
            {/* An invited supplier who has since become inactive cannot stay
                invited (the server refuses inactive suppliers): said, not done
                silently (AUD-09 §5, FV-10). */}
            {dropped > 0 ? (
              <p className="text-meta text-warning-strong" role="status">
                {t("rfqs.dropped", { count: dropped })}
              </p>
            ) : null}
          </fieldset>
        </div>
      </FormSection>

      <FormSection
        title={t("common.lines")}
        description={t("rfqs.linesDescription")}
      >
        <div className="sm:col-span-2">
          <LineItemsEditor initial={values?.items} columns={["quantity", "unit"]} />
        </div>
      </FormSection>
    </RecordForm>
  );
}
