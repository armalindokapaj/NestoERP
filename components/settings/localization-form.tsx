"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { Field, FormSection, selectClass } from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { updateCompanySettingsAction } from "@/lib/actions/settings";
import type { CompanySettingsDTO } from "@/lib/modules/settings/company-settings.service";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const TIMEZONES = [
  "UTC", "Europe/Tirane", "Europe/Berlin", "Europe/London", "Europe/Paris",
  "Europe/Rome", "Europe/Madrid", "Europe/Athens", "Europe/Istanbul",
  "America/New_York", "America/Chicago", "America/Los_Angeles", "Asia/Dubai",
];

const LOCALES = [
  { value: "en", label: "English" },
  { value: "en-US", label: "English (United States)" },
  { value: "de-DE", label: "German (Germany)" },
  { value: "sq-AL", label: "Albanian (Albania)" },
  { value: "it-IT", label: "Italian (Italy)" },
];

const CURRENCIES = ["EUR", "USD", "GBP", "ALL", "CHF"];

/**
 * Company localisation and finance defaults (PRD #24 §182).
 *
 * Base currency is disabled once money exists: without an FX engine, changing it
 * would silently reinterpret every amount already recorded (PRD #24 §186, §226).
 */
export function LocalizationForm({
  settings,
  currencyLocked,
  canUpdate,
}: {
  settings: CompanySettingsDTO;
  currencyLocked: boolean;
  canUpdate: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = React.useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await updateCompanySettingsAction(formData);
      if (result.ok) {
        toast({ title: "Company settings updated.", tone: "success" });
        router.refresh();
      } else {
        toast({ title: result.message, tone: "danger" });
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <FormSection title="Localization" description="How dates, numbers and language appear across NESTO.">
        <Field label="Language" name="locale">
          <select id="locale" name="locale" defaultValue={settings.locale} className={selectClass} disabled={!canUpdate}>
            {LOCALES.map((l) => (
              <option key={l.value} value={l.value}>{l.label}</option>
            ))}
          </select>
        </Field>

        <Field label="Timezone" name="timezone" hint="Business dates and due states resolve in this zone. Timestamps stay UTC.">
          <select id="timezone" name="timezone" defaultValue={settings.timezone} className={selectClass} disabled={!canUpdate}>
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </select>
        </Field>

        <Field label="Date format" name="dateFormat">
          <select id="dateFormat" name="dateFormat" defaultValue={settings.dateFormat} className={selectClass} disabled={!canUpdate}>
            {["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"].map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </Field>
      </FormSection>

      <FormSection title="Finance defaults" description="Company-wide defaults every module reads.">
        <Field
          label="Base currency"
          name="baseCurrency"
          hint={currencyLocked
            ? "Locked: financial records already exist, and NESTO does not convert between currencies."
            : "Amounts are never converted between currencies."}
        >
          <select
            id="baseCurrency"
            name="baseCurrency"
            defaultValue={settings.baseCurrency}
            className={selectClass}
            disabled={!canUpdate || currencyLocked}
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          {currencyLocked ? (
            <input type="hidden" name="baseCurrency" value={settings.baseCurrency} />
          ) : null}
        </Field>

        <Field label="Fiscal year starts" name="fiscalYearStartMonth">
          <select
            id="fiscalYearStartMonth"
            name="fiscalYearStartMonth"
            defaultValue={String(settings.fiscalYearStartMonth)}
            className={selectClass}
            disabled={!canUpdate}
          >
            {MONTHS.map((m, i) => (
              <option key={m} value={String(i + 1)}>{m}</option>
            ))}
          </select>
        </Field>

        <Field label="Default payment terms (days)" name="defaultPaymentTermsDays">
          <Input
            id="defaultPaymentTermsDays"
            name="defaultPaymentTermsDays"
            type="number"
            min={0}
            max={3650}
            defaultValue={settings.defaultPaymentTermsDays}
            disabled={!canUpdate}
          />
        </Field>

        <Field label="Default tax rate (%)" name="defaultTaxRate" hint="A form prefill only — not a tax engine.">
          <Input
            id="defaultTaxRate"
            name="defaultTaxRate"
            defaultValue={settings.defaultTaxRate ?? ""}
            placeholder="20"
            disabled={!canUpdate}
          />
        </Field>
      </FormSection>

      {canUpdate ? (
        <div className="flex justify-end">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save settings"}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
