"use client";

import * as React from "react";
import { useRouter } from "@/components/navigation/guarded-router";

import {
  Field,
  FieldErrorProvider,
  FormSection,
  selectClass,
} from "@/components/forms/record-form";
import { useFinanceTranslations } from "@/components/finance/finance-text";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { SaveMessages, UnsavedIndicator } from "@/components/unsaved/editor-status";
import { useEditorSave } from "@/components/unsaved/use-editor-save";
import { updateFinanceSettingsAction } from "@/lib/actions/finance";
import { SUPPORTED_CURRENCIES } from "@/lib/modules/finance/finance.currency";
import type { FinanceSettingsDTO } from "@/lib/modules/finance/finance.settings";

const MONTHS = ["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8", "m9", "m10", "m11", "m12"] as const;

/** Company finance configuration (PRD #15 §394–§398). */
export function FinanceSettingsForm({
  settings,
  canManage,
}: {
  settings: FinanceSettingsDTO;
  canManage: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const t = useFinanceTranslations();
  const formRef = React.useRef<HTMLFormElement>(null);
  // AUD-03 §3: registered with the tab's coordinator; dirtiness is what the
  // form would submit, and only a committed answer moves the baseline.
  const save = useEditorSave({
    formRef,
    action: updateFinanceSettingsAction,
    module: "finance",
    saveKind: "save",
    label: t("settings.label"),
    onCommitted: (result) => {
      // The action's English confirmation, in the reader's language.
      toast({ title: result?.message ? t("settings.savedMessage") : t("settings.saved"), tone: "success" });
      router.refresh();
      return true;
    },
  });
  const { pending, fieldErrors } = save;

  return (
    <FieldErrorProvider value={fieldErrors}>
      <form ref={formRef} onSubmit={save.onSubmit} className="space-y-5">
        <SaveMessages save={save} />

        <fieldset disabled={pending || Boolean(save.saved)} className="m-0 min-w-0 space-y-5 border-0 p-0">
          <FormSection
            title={t("settings.currencyTerms")}
            description={t("settings.currencyTermsHint")}
          >
            <Field
              label={t("settings.baseCurrency")}
              name="baseCurrency"
              required
              hint={t("settings.baseCurrencyHint")}
            >
              <select
                id="baseCurrency"
                name="baseCurrency"
                className={selectClass}
                defaultValue={settings.baseCurrency}
                disabled={!canManage}
              >
                {SUPPORTED_CURRENCIES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </Field>

            <Field label={t("settings.paymentTerms")} name="defaultPaymentTermsDays" required hint={t("settings.days")}>
              <Input
                id="defaultPaymentTermsDays"
                name="defaultPaymentTermsDays"
                type="number"
                inputMode="numeric"
                min={0}
                max={365}
                required
                defaultValue={settings.defaultPaymentTermsDays}
                disabled={!canManage}
              />
            </Field>

            <Field label={t("settings.fiscalYear")} name="fiscalYearStartMonth" required>
              <select
                id="fiscalYearStartMonth"
                name="fiscalYearStartMonth"
                className={selectClass}
                defaultValue={settings.fiscalYearStartMonth}
                disabled={!canManage}
              >
                {MONTHS.map((month, index) => (
                  <option key={month} value={index + 1}>
                    {t(`months.${month}`)}
                  </option>
                ))}
              </select>
            </Field>

            <Field label={t("settings.taxRate")} name="defaultTaxRate" hint={t("settings.taxRateHint")}>
              <Input
                id="defaultTaxRate"
                name="defaultTaxRate"
                inputMode="decimal"
                defaultValue={settings.defaultTaxRate ?? ""}
                disabled={!canManage}
                placeholder="20"
              />
            </Field>

            <Field
              label={t("settings.invoicePrefix")}
              name="invoicePrefix"
              hint={t("settings.invoicePrefixHint")}
            >
              <Input
                id="invoicePrefix"
                name="invoicePrefix"
                maxLength={20}
                defaultValue={settings.invoicePrefix ?? ""}
                disabled={!canManage}
              />
            </Field>
          </FormSection>
        </fieldset>

        {canManage ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? t("settings.saving") : t("settings.save")}
            </Button>
            <UnsavedIndicator save={save} />
          </div>
        ) : (
          <p className="text-table text-fg-subtle">
            {t("settings.readOnly")}
          </p>
        )}
      </form>
    </FieldErrorProvider>
  );
}
