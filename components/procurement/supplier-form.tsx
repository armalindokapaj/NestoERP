"use client";

import {
  Field,
  FormSection,
  RecordForm,
  selectClass,
  type FormActionResult,
} from "@/components/forms/record-form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { currencyOptions } from "@/lib/modules/finance/finance.currency";
import {
  SUPPLIER_TYPES,
  supplierTypeLabels,
} from "@/lib/modules/procurement/procurement.status";

export type SupplierFormValues = {
  code: string;
  name: string;
  legalName: string;
  supplierType: string;
  status: string;
  email: string;
  phone: string;
  website: string;
  taxId: string;
  registrationNumber: string;
  address: string;
  city: string;
  country: string;
  paymentTermsDays: string;
  defaultCurrency: string;
  notes: string;
};

/**
 * Create and edit a supplier (PRD #19 §26–§40).
 *
 * The archive is not a status on this form: archiving is a separate action with
 * its own rule — an order still running blocks it — and a dropdown would make
 * it look like an ordinary edit (PRD #19 §37).
 */
export function SupplierForm({
  action,
  values,
  versionUpdatedAt,
  cancelHref,
  submitLabel,
  pendingLabel,
}: {
  action: (formData: FormData) => Promise<FormActionResult>;
  values?: SupplierFormValues;
  versionUpdatedAt?: string;
  cancelHref: string;
  submitLabel: string;
  pendingLabel: string;
}) {
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
        title="Supplier"
        description="Who the company buys from. A supplier is not a client — the same organisation can be both, recorded twice."
      >
        <Field label="Name" name="name" required className="sm:col-span-2">
          <Input id="name" name="name" defaultValue={values?.name ?? ""} required maxLength={200} />
        </Field>

        <Field label="Legal name" name="legalName" className="sm:col-span-2">
          <Input
            id="legalName"
            name="legalName"
            defaultValue={values?.legalName ?? ""}
            maxLength={250}
          />
        </Field>

        <Field label="Supplier code" name="code">
          <Input id="code" name="code" defaultValue={values?.code ?? ""} maxLength={40} />
        </Field>

        <Field label="Type" name="supplierType" required>
          <select
            id="supplierType"
            name="supplierType"
            className={selectClass}
            defaultValue={values?.supplierType ?? "COMPANY"}
          >
            {SUPPLIER_TYPES.map((type) => (
              <option key={type} value={type}>
                {supplierTypeLabels[type]}
              </option>
            ))}
          </select>
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
      </FormSection>

      <FormSection title="Contact">
        <Field label="Email" name="email">
          <Input id="email" name="email" type="email" defaultValue={values?.email ?? ""} />
        </Field>

        <Field label="Phone" name="phone">
          <Input id="phone" name="phone" defaultValue={values?.phone ?? ""} maxLength={40} />
        </Field>

        <Field label="Website" name="website" className="sm:col-span-2" hint="Starting http:// or https://">
          <Input id="website" name="website" defaultValue={values?.website ?? ""} />
        </Field>
      </FormSection>

      <FormSection title="Registration and terms">
        <Field label="Tax number" name="taxId">
          <Input id="taxId" name="taxId" defaultValue={values?.taxId ?? ""} maxLength={60} />
        </Field>

        <Field label="Registration number" name="registrationNumber">
          <Input
            id="registrationNumber"
            name="registrationNumber"
            defaultValue={values?.registrationNumber ?? ""}
            maxLength={60}
          />
        </Field>

        <Field label="Payment terms" name="paymentTermsDays" hint="Days from invoice">
          <Input
            id="paymentTermsDays"
            name="paymentTermsDays"
            type="number"
            min={0}
            max={365}
            defaultValue={values?.paymentTermsDays ?? ""}
          />
        </Field>

        <Field label="Default currency" name="defaultCurrency">
          <select
            id="defaultCurrency"
            name="defaultCurrency"
            className={selectClass}
            defaultValue={values?.defaultCurrency ?? ""}
          >
            <option value="">Not set</option>
            {currencyOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      </FormSection>

      <FormSection title="Address">
        <Field label="Address" name="address" className="sm:col-span-2">
          <Input id="address" name="address" defaultValue={values?.address ?? ""} maxLength={400} />
        </Field>

        <Field label="City" name="city">
          <Input id="city" name="city" defaultValue={values?.city ?? ""} maxLength={120} />
        </Field>

        <Field label="Country" name="country">
          <Input id="country" name="country" defaultValue={values?.country ?? ""} maxLength={120} />
        </Field>
      </FormSection>

      <FormSection title="Notes">
        <Field label="Internal notes" name="notes" className="sm:col-span-2">
          <Textarea id="notes" name="notes" rows={4} defaultValue={values?.notes ?? ""} maxLength={4000} />
        </Field>
      </FormSection>
    </RecordForm>
  );
}
