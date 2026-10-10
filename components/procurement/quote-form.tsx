"use client";

import * as React from "react";

import { Field, selectClass, FieldErrorProvider } from "@/components/forms/record-form";
import { CellError, DecimalCell } from "@/components/finance/line-rows";
import { localToday } from "@/components/finance/local-date";
import { compareDecimal, isPositiveDecimal } from "@/lib/modules/finance/finance.decimal";
import { RATE_RULE } from "@/lib/modules/finance/finance.fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { SaveMessages, UnsavedIndicator } from "@/components/unsaved/editor-status";
import { useEditorSave } from "@/components/unsaved/use-editor-save";
import { recordQuoteAction } from "@/lib/actions/procurement";
import type { RfqDetailDTO } from "@/lib/modules/procurement/procurement.types";
import { useProcurementTranslations } from "./procurement-text";
import { FormSelect } from "@/components/ui/form-select";

/**
 * Records what one supplier answered (PRD #19 §85, §269).
 *
 * Priced against the enquiry's own lines, in the enquiry's currency, because
 * comparing two currencies is not a comparison V0.1 can make (PRD #19 §83).
 *
 * Only suppliers who were invited appear: a quote from somebody who was never
 * asked is not an answer to this enquiry (PRD #19 §67).
 *
 * One row per enquiry line, in the enquiry's order — the rows never move, so a
 * line's server error (`items.<index>.<field>`) always belongs to the row at
 * that index (AUD-09 §7, FV-16). Every error sits beside its field, dates are
 * checked in order on the server, and numbers use the shared decimal rule.
 */
export function QuoteForm({ rfq }: { rfq: RfqDetailDTO }) {
  const toast = useToast();
  const t = useProcurementTranslations();
  const formRef = React.useRef<HTMLFormElement>(null);
  // AUD-03 §3, §6: registered with the tab's coordinator; a normal save opens
  // the comparison, Save and continue leaves the destination to the departure.
  const save = useEditorSave({
    formRef,
    action: async (formData: FormData) => {
      const result = await recordQuoteAction(rfq.id, formData);
      return result.ok ? { ...result, redirectTo: `/procurement/rfqs/${rfq.id}/comparison` } : result;
    },
    module: "procurement",
    saveKind: "create",
    label: t("quote.editorLabel"),
    onCommitted: () => {
      toast({ title: t("quote.recorded"), tone: "success" });
    },
  });
  const { pending, fieldErrors } = save;

  const awaiting = rfq.suppliers.filter((entry) => entry.quoteId === null);

  if (awaiting.length === 0) {
    return (
      <p className="nesto-card p-5 text-table text-fg-subtle">
        {t("quote.allAnswered")}
      </p>
    );
  }

  return (
    <FieldErrorProvider value={fieldErrors}>
      <form ref={formRef} onSubmit={save.onSubmit} className="space-y-5">
        <SaveMessages save={save} />

        <fieldset disabled={pending || Boolean(save.saved)} className="m-0 min-w-0 space-y-5 border-0 p-0">

          <section className="nesto-card space-y-4 p-5">
            <h2 className="text-card font-semibold text-fg">{t("quote.answer")}</h2>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("common.supplier")} name="supplierId" required>
                <FormSelect id="supplierId" name="supplierId" className={selectClass} required defaultValue="">
                  <option value="" disabled>
                    {t("common.chooseSupplier")}
                  </option>
                  {awaiting.map((entry) => (
                    <option key={entry.id} value={entry.supplier.id}>
                      {entry.supplier.name}
                    </option>
                  ))}
                </FormSelect>
              </Field>

              <Field label={t("quote.theirReference")} name="quoteNumber" hint={t("common.optional")}>
                <Input id="quoteNumber" name="quoteNumber" maxLength={60} />
              </Field>

              <Field label={t("quote.quoteDate")} name="quoteDate" required>
                <Input id="quoteDate" name="quoteDate" type="date" required defaultValue={localToday()} />
              </Field>

              <Field label={t("quote.validUntil")} name="validUntil" hint={t("quote.afterQuoteHint")}>
                <Input id="validUntil" name="validUntil" type="date" />
              </Field>

              <Field label={t("quote.leadTime")} name="leadTimeDays" hint={t("quote.leadHint")}>
                <Input id="leadTimeDays" name="leadTimeDays" type="number" inputMode="numeric" min={0} max={3650} step={1} />
              </Field>

              <Field label={t("quote.offeredDelivery")} name="deliveryDate" hint={t("quote.afterQuoteHint")}>
                <Input id="deliveryDate" name="deliveryDate" type="date" />
              </Field>
            </div>

            <Field label={t("common.notes")} name="notes">
              <Textarea id="notes" name="notes" rows={2} maxLength={2000} />
            </Field>
          </section>

          <section className="nesto-card overflow-hidden">
            <div className="p-5">
              <h2 className="text-card font-semibold text-fg">{t("quote.prices")}</h2>
              <p className="mt-1 text-meta text-fg-subtle">
                {t("quote.pricedIn", { currency: rfq.currency })}
              </p>
            </div>

            <div className="space-y-4 border-t border-line p-5">
              <CellError id="quote-items-error" message={fieldErrors.items?.[0]} />
              {rfq.items.map((item, index) => (
                <QuoteLine key={item.id} item={item} index={index} errors={fieldErrors} currency={rfq.currency} />
              ))}
            </div>
          </section>
        </fieldset>

        <div className="flex items-center justify-end gap-2">
          <UnsavedIndicator save={save} />
          <Button type="submit" disabled={pending || Boolean(save.saved)}>
            {pending ? t("quote.recording") : t("quote.record")}
          </Button>
        </div>
      </form>
    </FieldErrorProvider>
  );
}


/** One enquiry line's price; its server errors are `items.<index>.<field>`. */
function QuoteLine({
  item,
  index,
  errors,
  currency,
}: {
  item: RfqDetailDTO["items"][number];
  index: number;
  errors: Record<string, string[]>;
  currency: string;
}) {
  const t = useProcurementTranslations();
  const positiveQuantity = (value: string) => (isPositiveDecimal(value) ? null : t("lineItems.positiveQuantity"));
  const fractionRate = (value: string) => (compareDecimal(value, "1") <= 0 ? null : t("lineItems.fractionRate"));
  const [quantity, setQuantity] = React.useState(item.quantity);
  const [unitPrice, setUnitPrice] = React.useState("");
  const [taxRate, setTaxRate] = React.useState("0");
  const [edited, setEdited] = React.useState<Record<string, boolean>>({});
  const [source, setSource] = React.useState(errors);
  if (source !== errors) {
    setSource(errors);
    setEdited({});
  }
  const error = (field: string) => (edited[field] ? undefined : errors[`items.${index}.${field}`]?.[0]);
  const edit = (field: string, set: (value: string) => void) => (value: string) => {
    set(value);
    setEdited((current) => ({ ...current, [field]: true }));
  };

  return (
    <div className="space-y-2" data-line-row={item.id}>
      <p className="text-table font-medium text-fg">{item.description}</p>
      <input type="hidden" name={`items.${index}.rfqItemId`} value={item.id} />
      <input type="hidden" name={`items.${index}.description`} value={item.description} />

      <div className="grid gap-3 sm:grid-cols-3">
        <DecimalCell
          id={`quote-${item.id}-quantity`}
          name={`items.${index}.quantity`}
          label={t("common.quantity")}
          value={quantity}
          rule={{ label: t("common.quantity"), ...RATE_RULE }}
          refine={positiveQuantity}
          serverError={error("quantity")}
          onChange={edit("quantity", setQuantity)}
        />
        <DecimalCell
          id={`quote-${item.id}-unitPrice`}
          name={`items.${index}.unitPrice`}
          label={t("common.unitPrice")}
          unit={currency}
          value={unitPrice}
          rule={{ label: t("common.unitPrice"), ...RATE_RULE }}
          serverError={error("unitPrice")}
          onChange={edit("unitPrice", setUnitPrice)}
        />
        <DecimalCell
          id={`quote-${item.id}-taxRate`}
          name={`items.${index}.taxRate`}
          label={t("lineItems.taxRate")}
          unit={t("lineItems.fraction")}
          value={taxRate}
          required={false}
          rule={{ label: t("lineItems.taxRate"), scale: 4, maxIntegerDigits: 1 }}
          refine={fractionRate}
          serverError={error("taxRate")}
          onChange={edit("taxRate", setTaxRate)}
        />
      </div>
    </div>
  );
}
