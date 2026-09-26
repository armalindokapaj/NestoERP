"use client";

import * as React from "react";
import { checkLeadDuplicatesAction } from "@/lib/actions/sales";

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
import { LEAD_SOURCES } from "@/lib/modules/sales/leads/lead.schema";
import { leadSourceLabels } from "@/lib/modules/sales/leads/lead.status";
import type { LeadDuplicateMatch } from "@/lib/modules/sales/sales.types";

export type LeadFormValues = {
  name: string;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  source: string;
  ownerMemberId: string | null;
  estimatedValue: string | null;
  currency: string | null;
  notes: string | null;
};

/**
 * Capture and edit a lead (PRD #17 §42, §43, §408).
 *
 * The duplicate warning is a warning: the matches are listed, and a second
 * submission with "add anyway" ticked goes through. Two salespeople chasing the
 * same building company is a real situation, and the product's job is to say so
 * rather than to decide which of them is wrong (PRD #17 §44).
 */
export function LeadForm({
  action,
  owners,
  values,
  versionUpdatedAt,
  duplicates,
  excludeLeadId,
  cancelHref,
  submitLabel,
  pendingLabel,
}: {
  action: (formData: FormData) => Promise<FormActionResult>;
  owners?: SelectOption[];
  values?: LeadFormValues;
  versionUpdatedAt?: string;
  duplicates?: LeadDuplicateMatch[];
  /** On edit, so the lead being edited is not reported against itself. */
  excludeLeadId?: string;
  cancelHref: string;
  submitLabel: string;
  pendingLabel: string;
}) {
  const [warned, setWarned] = React.useState(false);
  /**
   * Matches found while typing, before anything is submitted (PRD #17 §44).
   *
   * A courtesy, not a gate: the same check runs again on the server, and the
   * action swallows its own failures, so a slow or failed lookup can never be
   * the reason somebody cannot record a lead.
   */
  const [liveMatches, setLiveMatches] = React.useState<LeadDuplicateMatch[]>([]);

  React.useEffect(() => {
    if (duplicates && duplicates.length > 0) setWarned(true);
  }, [duplicates]);

  const [name, setName] = React.useState(values?.name ?? "");
  const [companyName, setCompanyName] = React.useState(values?.companyName ?? "");

  React.useEffect(() => {
    const term = `${name} ${companyName}`.trim();
    if (term.length < 3) {
      setLiveMatches([]);
      return;
    }

    // Debounced: a lookup on every keystroke would ask the database about half
    // a word, repeatedly, and answer about none of them usefully.
    let cancelled = false;
    const timer = setTimeout(() => {
      void checkLeadDuplicatesAction({
        name: name || undefined,
        companyName: companyName || undefined,
        excludeLeadId,
      }).then((matches) => {
        if (!cancelled) setLiveMatches(matches);
      });
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [name, companyName, excludeLeadId]);

  // What came back from a rejected submit wins: it is the authoritative answer.
  const shownDuplicates = duplicates && duplicates.length > 0 ? duplicates : liveMatches;

  return (
    <RecordForm
      action={action}
      module="sales"
      cancelHref={cancelHref}
      submitLabel={submitLabel}
      pendingLabel={pendingLabel}
      versionUpdatedAt={versionUpdatedAt}
    >
      {shownDuplicates.length > 0 ? (
        <section
          role="alert"
          className="rounded-md border border-warning/40 bg-warning-soft px-4 py-3"
        >
          <h2 className="text-table font-semibold text-warning-strong">
            This may already be in NESTO
          </h2>
          <ul className="mt-2 space-y-1 text-meta text-fg-muted">
            {shownDuplicates.map((match) => (
              <li key={`${match.kind}-${match.id}`}>
                <span className="font-medium text-fg">{match.label}</span> — {match.reason}
              </li>
            ))}
          </ul>
          {/* Only offered once the server has actually refused: a live match
              is a hint, and there is nothing yet to override. */}
          {duplicates && duplicates.length > 0 ? (
            <label className="mt-3 flex items-center gap-2 text-table text-fg">
              <input type="checkbox" name="acceptDuplicate" value="on" defaultChecked={warned} />
              Save it anyway
            </label>
          ) : null}
        </section>
      ) : null}

      <FormSection title="Lead" description="Who got in touch, and what it might be worth.">
        <Field label="Name" name="name" required>
          <Input
            id="name"
            name="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={200}
          />
        </Field>

        <Field label="Company" name="companyName" hint="Leave empty for an individual.">
          <Input
            id="companyName"
            name="companyName"
            value={companyName}
            onChange={(event) => setCompanyName(event.target.value)}
            maxLength={200}
          />
        </Field>

        <Field label="Source" name="source" required>
          <select
            id="source"
            name="source"
            className={selectClass}
            defaultValue={values?.source ?? "WEBSITE"}
          >
            {LEAD_SOURCES.map((source) => (
              <option key={source} value={source}>
                {leadSourceLabels[source]}
              </option>
            ))}
          </select>
        </Field>

        {owners ? (
          <Field label="Owner" name="ownerMemberId" hint="Who is following this up.">
            <select
              id="ownerMemberId"
              name="ownerMemberId"
              className={selectClass}
              defaultValue={values?.ownerMemberId ?? ""}
            >
              <option value="">Unassigned</option>
              {owners.map((owner) => (
                <option key={owner.value} value={owner.value}>
                  {owner.label}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
      </FormSection>

      <FormSection title="Contact" description="However they can be reached.">
        <Field label="Email" name="email">
          <Input
            id="email"
            name="email"
            type="email"
            defaultValue={values?.email ?? ""}
            maxLength={254}
          />
        </Field>

        <Field label="Phone" name="phone">
          <Input id="phone" name="phone" defaultValue={values?.phone ?? ""} maxLength={40} />
        </Field>

        <Field
          label="Website"
          name="website"
          className="sm:col-span-2"
          hint="A full address, beginning http:// or https://"
        >
          <Input id="website" name="website" defaultValue={values?.website ?? ""} />
        </Field>
      </FormSection>

      <FormSection
        title="Commercial"
        description="A first estimate. It becomes the opportunity's value at conversion."
      >
        <Field label="Estimated value" name="estimatedValue">
          <Input
            id="estimatedValue"
            name="estimatedValue"
            inputMode="decimal"
            defaultValue={values?.estimatedValue ?? ""}
          />
        </Field>

        <Field label="Currency" name="currency" hint="Required once there is a value.">
          <select
            id="currency"
            name="currency"
            className={selectClass}
            defaultValue={values?.currency ?? "EUR"}
          >
            {currencyOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Notes" name="notes" className="sm:col-span-2">
          <Textarea id="notes" name="notes" rows={4} defaultValue={values?.notes ?? ""} maxLength={5000} />
        </Field>
      </FormSection>
    </RecordForm>
  );
}
