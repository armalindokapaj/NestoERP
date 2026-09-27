"use client";

import * as React from "react";
import { useRouter } from "@/components/navigation/guarded-router";

import {
  Field,
  FieldErrorProvider,
  FormSection,
  selectClass,
} from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { SaveMessages, UnsavedIndicator } from "@/components/unsaved/editor-status";
import { useEditorSave } from "@/components/unsaved/use-editor-save";
import { updateFinanceSettingsAction } from "@/lib/actions/finance";
import { SUPPORTED_CURRENCIES } from "@/lib/modules/finance/finance.currency";
import type { FinanceSettingsDTO } from "@/lib/modules/finance/finance.settings";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

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
  const formRef = React.useRef<HTMLFormElement>(null);
  // AUD-03 §3: registered with the tab's coordinator; dirtiness is what the
  // form would submit, and only a committed answer moves the baseline.
  const save = useEditorSave({
    formRef,
    action: updateFinanceSettingsAction,
    module: "finance",
    saveKind: "save",
    label: "Finance settings",
    onCommitted: (result) => {
      toast({ title: result?.message ?? "Saved.", tone: "success" });
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
            title="Currency and terms"
            description="Defaults applied to new records. Existing records keep what they were saved with."
          >
            <Field
              label="Base currency"
              name="baseCurrency"
              required
              hint="Used for company totals. Changing it converts nothing — V0.1 has no FX engine."
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

            <Field label="Default payment terms" name="defaultPaymentTermsDays" required hint="Days.">
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

            <Field label="Fiscal year starts" name="fiscalYearStartMonth" required>
              <select
                id="fiscalYearStartMonth"
                name="fiscalYearStartMonth"
                className={selectClass}
                defaultValue={settings.fiscalYearStartMonth}
                disabled={!canManage}
              >
                {MONTHS.map((month, index) => (
                  <option key={month} value={index + 1}>
                    {month}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Default tax rate" name="defaultTaxRate" hint="Percent. Optional.">
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
              label="Invoice prefix"
              name="invoicePrefix"
              hint="Stored for future numbering. V0.1 does not generate invoice numbers."
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
              {pending ? "Saving…" : "Save settings"}
            </Button>
            <UnsavedIndicator save={save} />
          </div>
        ) : (
          <p className="text-table text-fg-subtle">
            You can see these settings but not change them.
          </p>
        )}
      </form>
    </FieldErrorProvider>
  );
}
