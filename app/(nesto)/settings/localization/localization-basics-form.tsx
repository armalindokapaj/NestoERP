"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { Field, FormSection, selectClass } from "@/components/forms/record-form";
import { useTranslations } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { updateCompanySettingsAction } from "@/lib/actions/settings";
import type { CompanySettingsView } from "@/lib/modules/settings/company-settings.service";

const TIMEZONES = [
  "UTC", "Europe/Tirane", "Europe/Berlin", "Europe/London", "Europe/Paris",
  "Europe/Rome", "Europe/Madrid", "Europe/Athens", "Europe/Istanbul",
  "America/New_York", "America/Chicago", "America/Los_Angeles", "Asia/Dubai",
];

const COMPANY_LOCALES = [
  { value: "en", key: "en" },
  { value: "en-US", key: "enUS" },
  { value: "de-DE", key: "deDE" },
  { value: "sq-AL", key: "sqAL" },
  { value: "it-IT", key: "itIT" },
] as const;

/**
 * Company localisation without the finance defaults (PRD #24 §182, PRD #47 §61).
 *
 * Shown to somebody who configures the company but does not hold
 * `company.finance_settings.view` — an Admin, or IT. The finance section is
 * left off the page rather than rendered with placeholder values, and since
 * its fields are never posted, the server leaves the stored defaults exactly
 * as they are.
 */
export function LocalizationBasicsForm({
  settings,
  canUpdate,
}: {
  settings: Pick<CompanySettingsView, "locale" | "timezone" | "dateFormat">;
  canUpdate: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = React.useTransition();
  const t = useTranslations("settings");

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await updateCompanySettingsAction(formData);
      if (result.ok) {
        toast({ title: t("localization.updated"), tone: "success" });
        router.refresh();
      } else {
        toast({ title: result.message, tone: "danger" });
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <FormSection
        title={t("localization.sectionTitle")}
        description={t("localization.sectionDescription")}
      >
        <Field label={t("localization.locale")} name="locale" hint={t("localization.localeHint")}>
          <select id="locale" name="locale" defaultValue={settings.locale} className={selectClass} disabled={!canUpdate}>
            {COMPANY_LOCALES.map((l) => (
              <option key={l.value} value={l.value}>{t(`localization.locales.${l.key}`)}</option>
            ))}
          </select>
        </Field>

        <Field label={t("localization.timezone")} name="timezone" hint={t("localization.timezoneHint")}>
          <select id="timezone" name="timezone" defaultValue={settings.timezone} className={selectClass} disabled={!canUpdate}>
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </select>
        </Field>

        <Field label={t("localization.dateFormat")} name="dateFormat">
          <select id="dateFormat" name="dateFormat" defaultValue={settings.dateFormat} className={selectClass} disabled={!canUpdate}>
            {["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"].map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </Field>
      </FormSection>

      {canUpdate ? (
        <div className="flex justify-end">
          <Button type="submit" disabled={pending}>
            {pending ? t("saving") : t("localization.submit")}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
