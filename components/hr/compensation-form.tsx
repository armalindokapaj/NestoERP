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
import { SUPPORTED_CURRENCIES } from "@/lib/modules/finance/finance.currency";
import { PAY_TYPES } from "@/lib/modules/hr/hr.schema";
import { localDay } from "./local-day";
import { hrLabel, useHrFormAction, useHrTranslations } from "./hr-text";
import { FormSelect } from "@/components/ui/form-select";


/**
 * Record a new pay level (PRD #16 §60, §65, §321).
 *
 * There is no edit: a change is a new effective-dated record, and the server
 * closes the current one the day before this one starts. Currency, pay type,
 * amount and effective date are each labelled in full, because a salary read
 * wrong is a salary paid wrong (PRD #16 §321).
 */
export function CompensationForm({
  action,
  currentAmount,
  cancelHref,
}: {
  action: (formData: FormData) => Promise<FormActionResult>;
  /** Shown as context, never pre-filled: a new figure should be typed. */
  currentAmount?: { baseAmount: string; currency: string; payType: string } | null;
  cancelHref: string;
}) {
  const t = useHrTranslations();
  const translatedAction = useHrFormAction(action);
  return (
    <RecordForm
      action={translatedAction}
      cancelHref={cancelHref}
      submitLabel={t("meta.recordCompensation")}
      pendingLabel={t("attendance.recording")}
      module="hr"
    >
      <FormSection
        title={t("compensation.newRecord")}
        description={t("compensation.newRecordDescription")}
      >
        <Field label={t("compensation.payType")} name="payType" required>
          <FormSelect
            id="payType"
            name="payType"
            className={selectClass}
            defaultValue={currentAmount?.payType ?? "SALARY"}
          >
            {PAY_TYPES.map((type) => (
              <option key={type} value={type}>
                {hrLabel(t, "payType", type)}
              </option>
            ))}
          </FormSelect>
        </Field>

        <Field label={t("compensation.currency")} name="currency" required>
          <FormSelect
            id="currency"
            name="currency"
            className={selectClass}
            defaultValue={currentAmount?.currency ?? "EUR"}
          >
            {SUPPORTED_CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </FormSelect>
        </Field>

        <Field
          label={t("compensation.baseAmount")}
          name="baseAmount"
          required
          hint={
            currentAmount
              ? t("compensation.currently", { amount: currentAmount.baseAmount, currency: currentAmount.currency })
              : t("compensation.grossHint")
          }
        >
          <Input id="baseAmount" name="baseAmount" inputMode="decimal" required placeholder="0.00" />
        </Field>

        <Field label={t("compensation.effectiveFrom")} name="effectiveFrom" required>
          <Input
            id="effectiveFrom"
            name="effectiveFrom"
            type="date"
            required
            defaultValue={localDay()}
          />
        </Field>

        <Field
          label={t("attendance.notes")}
          name="notes"
          className="sm:col-span-2"
          hint={t("compensation.notesHint")}
        >
          <Textarea id="notes" name="notes" rows={3} maxLength={2000} />
        </Field>
      </FormSection>
    </RecordForm>
  );
}
