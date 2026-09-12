"use client";

import {
  Field,
  FormSection,
  RecordForm,
  selectClass,
  type FormActionResult,
  type SelectOption,
} from "@/components/forms/record-form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { currencyOptions } from "@/lib/modules/finance/finance.currency";
import { LineItemsEditor, type LineValue } from "./line-items";

export type OrderFormValues = {
  supplierId: string;
  purchaseRequestId: string;
  projectId: string;
  contractId: string;
  orderDate: string;
  requiredDate: string;
  currency: string;
  notes: string;
  items: LineValue[];
};

/**
 * Raise or revise a purchase order (PRD #19 §108, §109, §272).
 *
 * The lines are the commitment, which is why they can only be edited while the
 * order is a draft. Every total is recalculated on the server from what it
 * receives: a header figure a browser sent is a number nobody checked
 * (PRD #19 §105).
 */
export function OrderForm({
  action,
  suppliers,
  projects,
  requests,
  contracts,
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
  contracts: SelectOption[];
  values?: OrderFormValues;
  versionUpdatedAt?: string;
  cancelHref: string;
  submitLabel: string;
  pendingLabel: string;
}) {
  return (
    <RecordForm
      action={action}
      cancelHref={cancelHref}
      submitLabel={submitLabel}
      pendingLabel={pendingLabel}
      versionUpdatedAt={versionUpdatedAt}
    >
      <FormSection
        title="Order"
        description="Issuing an order is the moment the company owes a supplier money. It is saved as a draft until somebody approves it."
      >
        <Field label="Supplier" name="supplierId" required>
          <select
            id="supplierId"
            name="supplierId"
            className={selectClass}
            defaultValue={values?.supplierId ?? ""}
            required
          >
            <option value="">Choose a supplier</option>
            {suppliers.map((supplier) => (
              <option key={supplier.value} value={supplier.value}>
                {supplier.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Currency" name="currency" required>
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

        <Field label="Order date" name="orderDate" required>
          <Input
            id="orderDate"
            name="orderDate"
            type="date"
            defaultValue={values?.orderDate ?? ""}
            required
          />
        </Field>

        <Field label="Required by" name="requiredDate">
          <Input
            id="requiredDate"
            name="requiredDate"
            type="date"
            defaultValue={values?.requiredDate ?? ""}
          />
        </Field>
      </FormSection>

      <FormSection title="Where it belongs">
        <Field label="Purchase request" name="purchaseRequestId">
          <select
            id="purchaseRequestId"
            name="purchaseRequestId"
            className={selectClass}
            defaultValue={values?.purchaseRequestId ?? ""}
          >
            <option value="">Direct order</option>
            {requests.map((request) => (
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
            {projects.map((project) => (
              <option key={project.value} value={project.value}>
                {project.label}
              </option>
            ))}
          </select>
        </Field>

        {contracts.length > 0 ? (
          <Field label="Contract" name="contractId" hint="If this order sits under an agreement">
            <select
              id="contractId"
              name="contractId"
              className={selectClass}
              defaultValue={values?.contractId ?? ""}
            >
              <option value="">None</option>
              {contracts.map((contract) => (
                <option key={contract.value} value={contract.value}>
                  {contract.label}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        <Field label="Notes" name="notes" className="sm:col-span-2">
          <Textarea id="notes" name="notes" rows={3} defaultValue={values?.notes ?? ""} maxLength={4000} />
        </Field>
      </FormSection>

      <FormSection
        title="Lines"
        description="What is being ordered, at the price agreed. Tax is a fraction — 0.2 is twenty per cent."
      >
        <div className="sm:col-span-2">
          <LineItemsEditor
            initial={values?.items}
            columns={["quantity", "unit", "unitPrice", "taxRate"]}
            priceLabel="Unit price"
            priceField="unitPrice"
          />
        </div>
      </FormSection>
    </RecordForm>
  );
}
