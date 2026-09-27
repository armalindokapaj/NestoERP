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
  const [selected, setSelected] = React.useState<string[]>(values?.supplierIds ?? []);
  const offered = selected.filter((id) => suppliers.some((supplier) => supplier.value === id));
  const dropped = selected.length - offered.length;
  // Saved links the pickers no longer offer stay on this enquiry (FV-10).
  const requestOptions = withSavedOption(requests, values?.purchaseRequestId, "Current request (no longer open for sourcing)");
  const projectOptions = withSavedOption(projects, values?.projectId, "Current project (no longer available for new enquiries)");

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
        title="Enquiry"
        description="The same ask, sent to several suppliers, so their answers compare line by line."
      >
        <Field label="Title" name="title" required className="sm:col-span-2">
          <Input id="title" name="title" defaultValue={values?.title ?? ""} required maxLength={250} />
        </Field>

        <Field label="Currency" name="currency" required hint="Every quote is priced in this currency">
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

        <Field label="Responses by" name="responseDueDate">
          <Input
            id="responseDueDate"
            name="responseDueDate"
            type="date"
            defaultValue={values?.responseDueDate ?? ""}
          />
        </Field>

        <Field label="Purchase request" name="purchaseRequestId">
          <select
            id="purchaseRequestId"
            name="purchaseRequestId"
            className={selectClass}
            defaultValue={values?.purchaseRequestId ?? ""}
          >
            <option value="">Not from a request</option>
            {requestOptions.map((request) => (
              <option key={request.value} value={request.value}>
                {request.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Project" name="projectId">
          <select
            id="projectId"
            name="projectId"
            className={selectClass}
            defaultValue={values?.projectId ?? ""}
          >
            <option value="">No project</option>
            {projectOptions.map((project) => (
              <option key={project.value} value={project.value}>
                {project.label}
              </option>
            ))}
          </select>
        </Field>
      </FormSection>

      <FormSection
        title="Suppliers to ask"
        description="At least two before it can be issued. You can invite more after it goes out."
      >
        <div className="sm:col-span-2">
          <fieldset className="space-y-2">
            <legend className="sr-only">Suppliers to invite</legend>
            {suppliers.length === 0 ? (
              <p className="text-table text-fg-subtle">
                No active suppliers yet. Add one before raising an enquiry.
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
              {offered.length} selected
              {offered.length < 2 ? " — two are needed to issue this enquiry." : "."}
            </p>
            {/* An invited supplier who has since become inactive cannot stay
                invited (the server refuses inactive suppliers): said, not done
                silently (AUD-09 §5, FV-10). */}
            {dropped > 0 ? (
              <p className="text-meta text-warning-strong" role="status">
                {dropped === 1 ? "One invited supplier is" : `${dropped} invited suppliers are`} no longer active and will
                be removed from this enquiry when you save.
              </p>
            ) : null}
          </fieldset>
        </div>
      </FormSection>

      <FormSection
        title="Lines"
        description="What every supplier is being asked to price. No prices here — those come back on their quotes."
      >
        <div className="sm:col-span-2">
          <LineItemsEditor initial={values?.items} columns={["quantity", "unit"]} />
        </div>
      </FormSection>
    </RecordForm>
  );
}
