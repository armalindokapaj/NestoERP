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
import { withSavedOption } from "@/components/finance/saved-option";
import { LineItemsEditor, type LineValue } from "./line-items";
import { useProcurementTranslations } from "./procurement-text";
import { FormSelect } from "@/components/ui/form-select";

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
  // Saved links the pickers no longer offer stay on this order (FV-10).
  const t = useProcurementTranslations();
  const supplierOptions = withSavedOption(suppliers, values?.supplierId, t("orders.savedSupplier"));
  const requestOptions = withSavedOption(requests, values?.purchaseRequestId, t("orders.savedRequest"));
  const projectOptions = withSavedOption(projects, values?.projectId, t("orders.savedProject"));
  const contractOptions = withSavedOption(contracts, values?.contractId, t("orders.savedContract"));

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
        title={t("orders.formSection")}
        description={t("orders.formDescription")}
      >
        <Field label={t("common.supplier")} name="supplierId" required>
          <FormSelect
            id="supplierId"
            name="supplierId"
            className={selectClass}
            defaultValue={values?.supplierId ?? ""}
            required
          >
            <option value="">{t("common.chooseSupplier")}</option>
            {supplierOptions.map((supplier) => (
              <option key={supplier.value} value={supplier.value}>
                {supplier.label}
              </option>
            ))}
          </FormSelect>
        </Field>

        <Field label={t("common.currency")} name="currency" required>
          <FormSelect
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
          </FormSelect>
        </Field>

        <Field label={t("orders.orderDate")} name="orderDate" required>
          <Input
            id="orderDate"
            name="orderDate"
            type="date"
            defaultValue={values?.orderDate ?? ""}
            required
          />
        </Field>

        <Field label={t("orders.requiredBy")} name="requiredDate" hint={t("orders.requiredHint")}>
          <Input
            id="requiredDate"
            name="requiredDate"
            type="date"
            defaultValue={values?.requiredDate ?? ""}
          />
        </Field>
      </FormSection>

      <FormSection title={t("common.whereItBelongs")}>
        <Field label={t("common.purchaseRequest")} name="purchaseRequestId">
          <FormSelect
            id="purchaseRequestId"
            name="purchaseRequestId"
            className={selectClass}
            defaultValue={values?.purchaseRequestId ?? ""}
          >
            <option value="">{t("orders.directOrder")}</option>
            {requestOptions.map((request) => (
              <option key={request.value} value={request.value}>
                {request.label}
              </option>
            ))}
          </FormSelect>
        </Field>

        <Field label={t("common.project")} name="projectId">
          <FormSelect
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
          </FormSelect>
        </Field>

        {/* Not rendered for someone who may not see contracts: the key is then
            absent and the server keeps the saved contract (AUD-09 §5, FV-10). */}
        {contractOptions.length > 0 ? (
          <Field label={t("common.contract")} name="contractId" hint={t("orders.contractHint")}>
            <FormSelect
              id="contractId"
              name="contractId"
              className={selectClass}
              defaultValue={values?.contractId ?? ""}
            >
              <option value="">{t("common.none")}</option>
              {contractOptions.map((contract) => (
                <option key={contract.value} value={contract.value}>
                  {contract.label}
                </option>
              ))}
            </FormSelect>
          </Field>
        ) : null}

        <Field label={t("common.notes")} name="notes" className="sm:col-span-2">
          <Textarea id="notes" name="notes" rows={3} defaultValue={values?.notes ?? ""} maxLength={4000} />
        </Field>
      </FormSection>

      <FormSection
        title={t("common.lines")}
        description={t("orders.linesDescription")}
      >
        <div className="sm:col-span-2">
          <LineItemsEditor
            initial={values?.items}
            columns={["quantity", "unit", "unitPrice", "taxRate"]}
            priceLabel={t("common.unitPrice")}
            priceField="unitPrice"
            currency={values?.currency}
          />
        </div>
      </FormSection>
    </RecordForm>
  );
}
