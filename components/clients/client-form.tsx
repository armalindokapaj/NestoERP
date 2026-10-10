"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "@/components/navigation/guarded-router";

import {
  Field,
  FieldErrorProvider,
  FormSection,
  selectClass,
  useFieldErrors,
  type SelectOption,
} from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ClientActionResult } from "@/lib/actions/clients";
import type { DuplicateMatch } from "@/lib/modules/clients/client.duplicate";
import { SaveMessages, UnsavedIndicator } from "@/components/unsaved/editor-status";
import { useEditorSave } from "@/components/unsaved/use-editor-save";
import { clientsLabel } from "@/lib/i18n/modules/clients/labels";
import { useClientsTranslations } from "./clients-text";
import { FormSelect } from "@/components/ui/form-select";

/**
 * Create / edit client form (PRD #12 §41, §53, §66).
 *
 * The duplicate warning is the interesting part. A soft match does not block
 * the save — it interrupts it once, shows what was found and offers
 * "Create anyway", because only a person can tell "ACME Development" from
 * "ACME Developments" (PRD #12 §52, §53).
 */
export type ClientFormValues = {
  code: string;
  name: string;
  legalName: string;
  type: string;
  email: string;
  phone: string;
  website: string;
  address: string;
  city: string;
  country: string;
  status: string;
};

const TYPE_OPTIONS: SelectOption[] = [
  { value: "COMPANY", label: "Company" },
  { value: "INDIVIDUAL", label: "Individual" },
  { value: "PUBLIC_ENTITY", label: "Public Entity" },
  { value: "OTHER", label: "Other" },
];

const STATUS_OPTIONS: SelectOption[] = [
  { value: "ACTIVE", label: "Active" },
  { value: "INACTIVE", label: "Inactive" },
];

const DUPLICATE_REASON: Record<DuplicateMatch["reason"], string> = {
  name: "same name",
  legalName: "same legal name",
  email: "same email address",
  phone: "same phone number",
};

export function ClientForm({
  mode,
  initial,
  cancelHref,
  versionUpdatedAt,
  showPrimaryContact = false,
  action,
}: {
  mode: "create" | "edit";
  initial: ClientFormValues;
  cancelHref: string;
  versionUpdatedAt?: string;
  /** Offered on create only: one contact, in the same transaction (PRD #12 §49). */
  showPrimaryContact?: boolean;
  action: (formData: FormData) => Promise<ClientActionResult>;
}) {
  const router = useRouter();
  const t = useClientsTranslations();
  const formRef = React.useRef<HTMLFormElement>(null);
  const [duplicates, setDuplicates] = React.useState<DuplicateMatch[]>([]);
  // Set only by "Create anyway": the person's own answer to the warning, for
  // that one submission. Save and continue never sets it (AUD-03 §4, UW-10).
  const acceptDuplicate = React.useRef(false);

  const save = useEditorSave({
    formRef,
    action,
    module: "clients",
    saveKind: mode === "create" ? "create" : "save",
    prepare: (formData) => {
      if (acceptDuplicate.current) formData.set("acceptDuplicate", "true");
      acceptDuplicate.current = false;
    },
    onRefused: (result) => {
      const found = (result.duplicates ?? []) as DuplicateMatch[];
      setDuplicates(found);
      // The warning is the message: it names what was found and asks.
      return found.length > 0;
    },
    onCommitted: () => {
      setDuplicates([]);
    },
  });
  const { pending, fieldErrors } = save;

  function createAnyway() {
    acceptDuplicate.current = true;
    void save.submit("normal");
  }

  function onCancel() {
    router.push(cancelHref);
  }

  return (
    <FieldErrorProvider value={fieldErrors}>
      <form ref={formRef} onSubmit={save.onSubmit} className="space-y-5">
        {versionUpdatedAt ? (
          <input type="hidden" name="versionUpdatedAt" value={versionUpdatedAt} />
        ) : null}

        {duplicates.length > 0 ? (
          <div
            role="alert"
            className="rounded-md border border-warning/40 bg-warning-soft px-4 py-3.5"
          >
            <p className="text-table font-medium text-fg">
              {duplicates.length === 1
                ? t("form.similarOne")
                : t("form.similarMany", { count: duplicates.length })}
            </p>
            <ul className="mt-2 space-y-1.5">
              {duplicates.map((match) => (
                <li key={match.id} className="text-table text-fg-muted">
                  <Link
                    href={`/clients/${match.id}`}
                    className="font-medium text-accent-strong hover:underline"
                  >
                    {match.name}
                  </Link>
                  {match.code ? <span className="text-fg-subtle"> · {match.code}</span> : null}
                  <span className="text-fg-subtle"> · {clientsLabel(t, "duplicateReason", match.reason, DUPLICATE_REASON[match.reason])}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="secondary" onClick={createAnyway} disabled={pending}>
                {mode === "create" ? t("form.createAnyway") : t("form.saveAnyway")}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={pending}>
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        ) : (
          <SaveMessages save={save} />
        )}

        {/* The submitted snapshot saves as it was (AUD-03 §6). */}
        <fieldset disabled={pending || Boolean(save.saved)} aria-busy={pending || undefined} className="m-0 min-w-0 space-y-5 border-0 p-0">
        <FormSection title={t("form.clientDetails")}>
          <Field label={t("form.clientName")} name="name" required>
            <NameInput defaultValue={initial.name} />
          </Field>

          <Field label={t("form.legalName")} name="legalName" hint={t("form.legalNameHint")}>
            <Input id="legalName" name="legalName" defaultValue={initial.legalName} maxLength={250} />
          </Field>

          <Field label={t("form.type")} name="type" required>
            <FormSelect id="type" name="type" defaultValue={initial.type} className={selectClass}>
              {TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {clientsLabel(t, "clientType", option.value, option.label)}
                </option>
              ))}
            </FormSelect>
          </Field>

          <Field label={t("form.status")} name="status" required>
            <FormSelect id="status" name="status" defaultValue={initial.status} className={selectClass}>
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {clientsLabel(t, "status", option.value, option.label)}
                </option>
              ))}
            </FormSelect>
          </Field>

          <Field
            label={t("form.clientCode")}
            name="code"
            hint={t("form.clientCodeHint")}
          >
            <Input id="code" name="code" defaultValue={initial.code} maxLength={50} />
          </Field>
        </FormSection>

        <FormSection title={t("form.contactInformation")}>
          <Field label={t("form.email")} name="email">
            <Input id="email" name="email" type="email" defaultValue={initial.email} maxLength={254} />
          </Field>

          <Field label={t("form.phone")} name="phone">
            <Input id="phone" name="phone" type="tel" defaultValue={initial.phone} maxLength={40} />
          </Field>

          <div className="sm:col-span-2">
            <Field label={t("form.website")} name="website" hint={t("form.websiteHint")}>
              <Input
                id="website"
                name="website"
                type="url"
                defaultValue={initial.website}
                maxLength={300}
              />
            </Field>
          </div>
        </FormSection>

        <FormSection title={t("form.address")}>
          <div className="sm:col-span-2">
            <Field label={t("form.address")} name="address">
              <Input id="address" name="address" defaultValue={initial.address} maxLength={300} />
            </Field>
          </div>

          <Field label={t("form.city")} name="city">
            <Input id="city" name="city" defaultValue={initial.city} maxLength={120} />
          </Field>

          <Field label={t("form.country")} name="country">
            <Input id="country" name="country" defaultValue={initial.country} maxLength={120} />
          </Field>
        </FormSection>

        {showPrimaryContact ? (
          <FormSection
            title={t("form.primaryContact")}
            description={t("form.primaryContactDescription")}
          >
            <Field label={t("form.firstName")} name="contactFirstName">
              <Input id="contactFirstName" name="contactFirstName" maxLength={120} />
            </Field>

            <Field label={t("form.lastName")} name="contactLastName">
              <Input id="contactLastName" name="contactLastName" maxLength={120} />
            </Field>

            <Field label={t("form.jobTitle")} name="contactJobTitle">
              <Input id="contactJobTitle" name="contactJobTitle" maxLength={160} />
            </Field>

            <Field label={t("form.contactEmail")} name="contactEmail">
              <Input id="contactEmail" name="contactEmail" type="email" maxLength={254} />
            </Field>

            <Field label={t("form.contactPhone")} name="contactPhone">
              <Input id="contactPhone" name="contactPhone" type="tel" maxLength={40} />
            </Field>
          </FormSection>
        ) : null}
        </fieldset>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={pending || Boolean(save.saved)}>
            {pending
              ? mode === "create"
                ? t("form.creating")
                : t("form.saving")
              : mode === "create"
                ? t("form.createClient")
                : t("form.saveChanges")}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel} disabled={pending}>
            {t("common.cancel")}
          </Button>
          <UnsavedIndicator save={save} />
        </div>
      </form>
    </FieldErrorProvider>
  );
}

function NameInput({ defaultValue }: { defaultValue: string }) {
  const errors = useFieldErrors();
  return (
    <Input
      id="name"
      name="name"
      defaultValue={defaultValue}
      required
      maxLength={200}
      aria-invalid={Boolean(errors.name)}
      aria-describedby={errors.name ? "name-error" : undefined}
    />
  );
}
