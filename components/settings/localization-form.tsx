"use client";

import * as React from "react";
import { useRouter } from "@/components/navigation/guarded-router";

import { Field, FormSection, selectClass } from "@/components/forms/record-form";
import { useTranslations } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { SaveMessages, UnsavedIndicator } from "@/components/unsaved/editor-status";
import { useEditorSave } from "@/components/unsaved/use-editor-save";
import { updateCompanySettingsAction } from "@/lib/actions/settings";
import type { CompanySettingsDTO } from "@/lib/modules/settings/company-settings.service";
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

/*
 * Month names come from the dictionary, not Intl.DateTimeFormat: the server's
 * and the browser's ICU data do not always agree on a language (a headless
 * Chromium answers "January" where Node answers "janar"), and a disagreement
 * here is a hydration mismatch.
 */
const MONTHS = ["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8", "m9", "m10", "m11", "m12"] as const;

const CURRENCIES = ["EUR", "USD", "GBP", "ALL", "CHF"];

/**
 * Company localisation and finance defaults (PRD #24 §182).
 *
 * Base currency is disabled once money exists: without an FX engine, changing it
 * would silently reinterpret every amount already recorded (PRD #24 §186, §226).
 *
 * The locale here is the company's, not the language anybody reads NESTO in —
 * that is each person's own choice on the Settings page, and the hint says so,
 * because two controls both called "Language" would leave an administrator
 * wondering which one did nothing.
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

      <FormSection
        title={t("localization.financeTitle")}
        description={t("localization.financeDescription")}
      >
        <Field
          label={t("localization.baseCurrency")}
          name="baseCurrency"
          hint={currencyLocked ? t("localization.currencyLocked") : t("localization.currencyHint")}
        >
          <FormSelect
            id="baseCurrency"
            name="baseCurrency"
            defaultValue={settings.baseCurrency}
            className={selectClass}
            disabled={!canUpdate || currencyLocked}
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </FormSelect>
          {currencyLocked ? (
            <input type="hidden" name="baseCurrency" value={settings.baseCurrency} />
          ) : null}
        </Field>

        <Field label={t("localization.fiscalYearStart")} name="fiscalYearStartMonth">
          <FormSelect
            id="fiscalYearStartMonth"
            name="fiscalYearStartMonth"
            defaultValue={String(settings.fiscalYearStartMonth)}
            className={selectClass}
            disabled={!canUpdate}
          >
            {MONTHS.map((m, i) => (
              <option key={m} value={String(i + 1)}>{t(`localization.months.${m}`)}</option>
            ))}
          </FormSelect>
        </Field>

        <Field label={t("localization.paymentTerms")} name="defaultPaymentTermsDays">
          <Input
            id="defaultPaymentTermsDays"
            name="defaultPaymentTermsDays"
            type="number"
            inputMode="numeric"
            min={0}
            max={3650}
            defaultValue={settings.defaultPaymentTermsDays}
            disabled={!canUpdate}
          />
        </Field>

        <Field label={t("localization.taxRate")} name="defaultTaxRate" hint={t("localization.taxRateHint")}>
          <Input
            id="defaultTaxRate"
            name="defaultTaxRate"
            defaultValue={settings.defaultTaxRate ?? ""}
            placeholder="20"
            disabled={!canUpdate}
          />
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
