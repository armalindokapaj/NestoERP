"use client";

import * as React from "react";
import { useRouter } from "@/components/navigation/guarded-router";

import { Field, FormSection, selectClass } from "@/components/forms/record-form";
import { useTranslations } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { SaveMessages, UnsavedIndicator } from "@/components/unsaved/editor-status";
import { useEditorSave } from "@/components/unsaved/use-editor-save";
import { updateCompanySettingsAction } from "@/lib/actions/settings";
import type { CompanySettingsView } from "@/lib/modules/settings/company-settings.service";
import { FormSelect } from "@/components/ui/form-select";

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
  const t = useTranslations("settings");
  const formRef = React.useRef<HTMLFormElement>(null);
  // Under the unsaved-work contract (AUD-03 §3, §6): a refusal stays on the
  // form in the action's words, and only an explicit success is a save.
  const save = useEditorSave({
    formRef,
    action: async (formData: FormData) => {
      const result = await updateCompanySettingsAction(formData);
      return result.ok ? result : { ok: false as const, error: result.message };
    },
    module: "settings",
    saveKind: "save",
    label: t("localization.sectionTitle"),
    onCommitted: () => {
      toast({ title: t("localization.updated"), tone: "success" });
      router.refresh();
    },
  });
  const { pending } = save;

  return (
    <form ref={formRef} onSubmit={save.onSubmit} className="space-y-5">
      <SaveMessages save={save} />
      <fieldset disabled={pending || Boolean(save.saved)} className="m-0 min-w-0 space-y-5 border-0 p-0">
      <FormSection
        title={t("localization.sectionTitle")}
        description={t("localization.sectionDescription")}
      >
        <Field label={t("localization.locale")} name="locale" hint={t("localization.localeHint")}>
          <FormSelect id="locale" name="locale" defaultValue={settings.locale} className={selectClass} disabled={!canUpdate}>
            {COMPANY_LOCALES.map((l) => (
              <option key={l.value} value={l.value}>{t(`localization.locales.${l.key}`)}</option>
            ))}
          </FormSelect>
        </Field>

        <Field label={t("localization.timezone")} name="timezone" hint={t("localization.timezoneHint")}>
          <FormSelect id="timezone" name="timezone" defaultValue={settings.timezone} className={selectClass} disabled={!canUpdate}>
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </FormSelect>
        </Field>

        <Field label={t("localization.dateFormat")} name="dateFormat">
          <FormSelect id="dateFormat" name="dateFormat" defaultValue={settings.dateFormat} className={selectClass} disabled={!canUpdate}>
            {["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"].map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </FormSelect>
        </Field>
      </FormSection>

      </fieldset>

      {canUpdate ? (
        <div className="flex items-center justify-end gap-3">
          <UnsavedIndicator save={save} />
          <Button type="submit" disabled={pending}>
            {pending ? t("saving") : t("localization.submit")}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
