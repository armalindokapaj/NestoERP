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
import { procurementLabel } from "@/lib/i18n/modules/procurement/labels";
import { useProcurementTranslations } from "./procurement-text";

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
  const t = useProcurementTranslations();
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
        title={t("common.supplier")}
        description={t("suppliers.formDescription")}
      >
        <Field label={t("suppliers.name")} name="name" required className="sm:col-span-2">
          <Input id="name" name="name" defaultValue={values?.name ?? ""} required maxLength={200} />
        </Field>

        <Field label={t("suppliers.legalName")} name="legalName" className="sm:col-span-2">
          <Input
            id="legalName"
            name="legalName"
            defaultValue={values?.legalName ?? ""}
            maxLength={250}
          />
        </Field>

        <Field label={t("suppliers.sortCode")} name="code">
          <Input id="code" name="code" defaultValue={values?.code ?? ""} maxLength={40} />
        </Field>

        <Field label={t("common.type")} name="supplierType" required>
          <select
            id="supplierType"
            name="supplierType"
            className={selectClass}
            defaultValue={values?.supplierType ?? "COMPANY"}
          >
            {SUPPLIER_TYPES.map((type) => (
              <option key={type} value={type}>
                {procurementLabel(t, "supplierType", type, supplierTypeLabels[type])}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t("common.status")} name="status" required>
          <select
            id="status"
            name="status"
            className={selectClass}
            defaultValue={values?.status === "ARCHIVED" ? "INACTIVE" : (values?.status ?? "ACTIVE")}
          >
            <option value="ACTIVE">{t("suppliers.active")}</option>
            <option value="INACTIVE">{t("suppliers.inactive")}</option>
          </select>
        </Field>
      </FormSection>

      <FormSection title={t("suppliers.contact")}>
        <Field label={t("suppliers.email")} name="email">
          <Input id="email" name="email" type="email" defaultValue={values?.email ?? ""} />
        </Field>

        <Field label={t("suppliers.phone")} name="phone">
          <Input id="phone" name="phone" type="tel" autoComplete="tel" defaultValue={values?.phone ?? ""} maxLength={40} />
        </Field>

        <Field label={t("suppliers.website")} name="website" className="sm:col-span-2" hint={t("suppliers.websiteHint")}>
          <Input id="website" name="website" inputMode="url" autoComplete="url" defaultValue={values?.website ?? ""} />
        </Field>
      </FormSection>

      <FormSection title={t("suppliers.registration")}>
        <Field label={t("suppliers.taxNumber")} name="taxId">
          <Input id="taxId" name="taxId" defaultValue={values?.taxId ?? ""} maxLength={60} />
        </Field>

        <Field label={t("suppliers.registrationNumber")} name="registrationNumber">
          <Input
            id="registrationNumber"
            name="registrationNumber"
            defaultValue={values?.registrationNumber ?? ""}
            maxLength={60}
          />
        </Field>

        <Field label={t("suppliers.paymentTerms")} name="paymentTermsDays" hint={t("suppliers.paymentTermsHint")}>
          <Input
            id="paymentTermsDays"
            name="paymentTermsDays"
            type="number"
            inputMode="numeric"
            min={0}
            max={365}
            defaultValue={values?.paymentTermsDays ?? ""}
          />
        </Field>

        <Field label={t("suppliers.defaultCurrency")} name="defaultCurrency">
          <select
            id="defaultCurrency"
            name="defaultCurrency"
            className={selectClass}
            defaultValue={values?.defaultCurrency ?? ""}
          >
            <option value="">{t("common.notSet")}</option>
            {currencyOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      </FormSection>

      <FormSection title={t("suppliers.address")}>
        <Field label={t("suppliers.address")} name="address" className="sm:col-span-2">
          <Input id="address" name="address" defaultValue={values?.address ?? ""} maxLength={400} />
        </Field>

        <Field label={t("suppliers.city")} name="city">
          <Input id="city" name="city" defaultValue={values?.city ?? ""} maxLength={120} />
        </Field>

        <Field label={t("common.country")} name="country">
          <Input id="country" name="country" defaultValue={values?.country ?? ""} maxLength={120} />
        </Field>
      </FormSection>

      <FormSection title={t("common.notes")}>
        <Field label={t("suppliers.internalNotes")} name="notes" className="sm:col-span-2">
          <Textarea id="notes" name="notes" rows={4} defaultValue={values?.notes ?? ""} maxLength={4000} />
        </Field>
      </FormSection>
    </RecordForm>
  );
}
