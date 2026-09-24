"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "next/navigation";

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
import { isLeavingForWorkspaceSwitch, setWorkspaceDirtyState } from "@/lib/workspace/client";

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
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});
  const [duplicates, setDuplicates] = React.useState<DuplicateMatch[]>([]);
  const [dirty, setDirty] = React.useState(false);

  React.useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      if (!isLeavingForWorkspaceSwitch()) event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  React.useEffect(() => {
    setWorkspaceDirtyState(dirty);
    return () => setWorkspaceDirtyState(false);
  }, [dirty]);

  function submit(formData: FormData, acceptDuplicate: boolean) {
    if (acceptDuplicate) formData.set("acceptDuplicate", "true");
    setError(null);
    setFieldErrors({});

    startTransition(async () => {
      const result = await action(formData);
      if (result && !result.ok) {
        setError(result.error);
        setFieldErrors(result.fieldErrors ?? {});
        setDuplicates(result.duplicates ?? []);
      } else {
        setDirty(false);
        setDuplicates([]);
      }
    });
  }

  const formRef = React.useRef<HTMLFormElement>(null);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submit(new FormData(event.currentTarget), false);
  }

  function createAnyway() {
    if (!formRef.current) return;
    submit(new FormData(formRef.current), true);
  }

  function onCancel() {
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    router.push(cancelHref);
  }

  return (
    <FieldErrorProvider value={fieldErrors}>
      <form ref={formRef} onSubmit={onSubmit} onChange={() => setDirty(true)} className="space-y-5">
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
                ? "A similar client already exists."
                : `${duplicates.length} similar clients already exist.`}
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
                  <span className="text-fg-subtle"> · {DUPLICATE_REASON[match.reason]}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="secondary" onClick={createAnyway} disabled={pending}>
                {mode === "create" ? "Create anyway" : "Save anyway"}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={pending}>
                Cancel
              </Button>
            </div>
          </div>
        ) : error ? (
          <p
            role="alert"
            className="rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-table text-danger-strong"
          >
            {error}
          </p>
        ) : null}

        <FormSection title="Client details">
          <Field label="Client name" name="name" required>
            <NameInput defaultValue={initial.name} />
          </Field>

          <Field label="Legal name" name="legalName" hint="If it differs from the trading name.">
            <Input id="legalName" name="legalName" defaultValue={initial.legalName} maxLength={250} />
          </Field>

          <Field label="Type" name="type" required>
            <select id="type" name="type" defaultValue={initial.type} className={selectClass}>
              {TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Status" name="status" required>
            <select id="status" name="status" defaultValue={initial.status} className={selectClass}>
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Client code"
            name="code"
            hint="Optional, unique inside your company — for example CLI-001."
          >
            <Input id="code" name="code" defaultValue={initial.code} maxLength={50} />
          </Field>
        </FormSection>

        <FormSection title="Contact information">
          <Field label="Email" name="email">
            <Input id="email" name="email" type="email" defaultValue={initial.email} maxLength={254} />
          </Field>

          <Field label="Phone" name="phone">
            <Input id="phone" name="phone" type="tel" defaultValue={initial.phone} maxLength={40} />
          </Field>

          <div className="sm:col-span-2">
            <Field label="Website" name="website" hint="Must start with http:// or https://">
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

        <FormSection title="Address">
          <div className="sm:col-span-2">
            <Field label="Address" name="address">
              <Input id="address" name="address" defaultValue={initial.address} maxLength={300} />
            </Field>
          </div>

          <Field label="City" name="city">
            <Input id="city" name="city" defaultValue={initial.city} maxLength={120} />
          </Field>

          <Field label="Country" name="country">
            <Input id="country" name="country" defaultValue={initial.country} maxLength={120} />
          </Field>
        </FormSection>

        {showPrimaryContact ? (
          <FormSection
            title="Primary contact"
            description="Optional. You can add more contacts once the client exists."
          >
            <Field label="First name" name="contactFirstName">
              <Input id="contactFirstName" name="contactFirstName" maxLength={120} />
            </Field>

            <Field label="Last name" name="contactLastName">
              <Input id="contactLastName" name="contactLastName" maxLength={120} />
            </Field>

            <Field label="Job title" name="contactJobTitle">
              <Input id="contactJobTitle" name="contactJobTitle" maxLength={160} />
            </Field>

            <Field label="Contact email" name="contactEmail">
              <Input id="contactEmail" name="contactEmail" type="email" maxLength={254} />
            </Field>

            <Field label="Contact phone" name="contactPhone">
              <Input id="contactPhone" name="contactPhone" type="tel" maxLength={40} />
            </Field>
          </FormSection>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={pending}>
            {pending
              ? mode === "create"
                ? "Creating…"
                : "Saving…"
              : mode === "create"
                ? "Create client"
                : "Save changes"}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
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
