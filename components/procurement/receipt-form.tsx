"use client";

import * as React from "react";
import { useRouter } from "@/components/navigation/guarded-router";

import { Field, FieldErrorProvider } from "@/components/forms/record-form";
import { CellError, DecimalCell } from "@/components/finance/line-rows";
import { localToday } from "@/components/finance/local-date";
import { RATE_RULE } from "@/lib/modules/finance/finance.fields";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { SaveMessages, UnsavedIndicator } from "@/components/unsaved/editor-status";
import { useEditorSave } from "@/components/unsaved/use-editor-save";
import { recordReceiptAction } from "@/lib/actions/procurement";
import type { OrderDetailDTO } from "@/lib/modules/procurement/procurement.types";
import { useProcurementServerText, useProcurementTranslations } from "./procurement-text";

/**
 * Books a delivery in against an order (PRD #19 §275, §276).
 *
 * Each line is prefilled with what is still outstanding, because the common
 * case is "the rest of it arrived" and making somebody retype that invites
 * typos into a quantity that matters.
 *
 * Receiving more than was ordered is confirmed rather than refused: more can
 * genuinely arrive, and a system that will not record it is one people work
 * around (PRD #19 §139).
 *
 * A delivery need not bring every line (AUD-09 §7, FV-16): a line left at 0 or
 * empty did not arrive this time and is left out. Before, a fully received line
 * (outstanding 0) blocked every later delivery with an error no row showed.
 * Each line's errors sit on that line (`items.<index>.<field>`, the rows never
 * move).
 */
export function ReceiptForm({ order }: { order: OrderDetailDTO }) {
  // What the refreshed order looks like once a delivery has been booked in.
  const version = `${order.receiptCount}:${order.items.map((item) => item.receivedQuantity).join(",")}`;
  const [generation, setGeneration] = React.useState(0);
  const [recordedAt, setRecordedAt] = React.useState<string | null>(null);

  // After this form's own committed save, a fresh form opens on the refreshed
  // outstanding quantities (AUD-03 §6). Only then: a refresh for any other
  // reason (a delivery voided below) never throws away what is being typed.
  React.useEffect(() => {
    if (recordedAt !== null && version !== recordedAt) {
      setGeneration((current) => current + 1);
      setRecordedAt(null);
    }
  }, [version, recordedAt]);

  return <ReceiptFormBody key={generation} order={order} onRecorded={() => setRecordedAt(version)} />;
}

function ReceiptFormBody({ order, onRecorded }: { order: OrderDetailDTO; onRecorded: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const t = useProcurementTranslations();
  const serverText = useProcurementServerText();
  const formRef = React.useRef<HTMLFormElement>(null);
  const [overReceipt, setOverReceipt] = React.useState(false);
  const [overMessage, setOverMessage] = React.useState<string | null>(null);

  const save = useEditorSave({
    formRef,
    action: (formData: FormData) => recordReceiptAction(order.id, formData),
    module: "procurement",
    saveKind: "create",
    label: t("receipts.editorLabel"),
    // The acknowledgement is the person's answer to one refusal, not input.
    ignore: ["acknowledgeOverReceipt"],
    // More arrived than was ordered: a question for a person, never answered
    // by Save and continue (AUD-03 §4).
    classify: (result) => (result && !result.ok && result.code === "OVER_RECEIPT" ? { kind: "decision" } : null),
    onRefused: (result) => {
      if (result.code !== "OVER_RECEIPT") {
        setOverMessage(null);
        return false;
      }
      // Ask once, then accept it: the goods are on site either way.
      setOverReceipt(true);
      setOverMessage(serverText(result.error) ?? null);
      return true;
    },
    onCommitted: () => {
      toast({ title: t("receipts.recordedToast"), tone: "success" });
      setOverReceipt(false);
      setOverMessage(null);
      onRecorded();
      router.refresh();
      return true;
    },
  });
  const { pending, fieldErrors } = save;

  return (
    <FieldErrorProvider value={fieldErrors}>
      <form ref={formRef} onSubmit={save.onSubmit} className="space-y-5">
        <SaveMessages save={save} />
        {overReceipt && (overMessage || save.error) ? (
          <div role="alert" className="rounded-md bg-warning-soft px-4 py-3 text-table text-warning-strong">
            {overMessage ? <p>{overMessage}</p> : null}
            <label className="mt-2 flex items-center gap-2.5">
              <Checkbox name="acknowledgeOverReceipt" value="true" defaultChecked disabled={pending} />
              <span>{t("receipts.overAck")}</span>
            </label>
          </div>
        ) : null}

        <fieldset disabled={pending || Boolean(save.saved)} className="m-0 min-w-0 space-y-5 border-0 p-0">
          <section className="nesto-card space-y-4 p-5">
            <h2 className="text-card font-semibold text-fg">{t("receipts.delivery")}</h2>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("receipts.dateReceived")} name="receiptDate" required>
                <Input id="receiptDate" name="receiptDate" type="date" required defaultValue={localToday()} />
              </Field>

              <Field label={t("receipts.deliveryNote")} name="deliveryReference" hint={t("common.optional")}>
                <Input id="deliveryReference" name="deliveryReference" maxLength={120} />
              </Field>
            </div>

            <Field label={t("common.notes")} name="notes">
              <Textarea id="notes" name="notes" rows={2} maxLength={2000} />
            </Field>
          </section>

          <section className="nesto-card overflow-hidden">
            <div className="p-5">
              <h2 className="text-card font-semibold text-fg">{t("receipts.arrived")}</h2>
              <p className="mt-1 text-meta text-fg-subtle">
                {t("receipts.arrivedNote")}
              </p>
            </div>

            <div className="space-y-4 border-t border-line p-5">
              <CellError id="receipt-items-error" message={fieldErrors.items?.[0]} />
              {order.items.map((item, index) => (
                <ReceiptLine key={item.id} item={item} index={index} errors={fieldErrors} />
              ))}
            </div>
          </section>
        </fieldset>

        <div className="flex items-center justify-end gap-2">
          <UnsavedIndicator save={save} />
          <Button type="submit" disabled={pending || Boolean(save.saved)}>
            {pending ? t("receipts.recording") : t("receipts.record")}
          </Button>
        </div>
      </form>
    </FieldErrorProvider>
  );
}

/** One order line's delivery; its server errors are `items.<index>.<field>`. */
function ReceiptLine({ item, index, errors }: { item: OrderDetailDTO["items"][number]; index: number; errors: Record<string, string[]> }) {
  const t = useProcurementTranslations();
  const [received, setReceived] = React.useState(item.outstandingQuantity);
  const [rejected, setRejected] = React.useState("0");
  const [edited, setEdited] = React.useState<Record<string, boolean>>({});
  const [source, setSource] = React.useState(errors);
  if (source !== errors) {
    setSource(errors);
    setEdited({});
  }
  const error = (field: string) => (edited[field] ? undefined : errors[`items.${index}.${field}`]?.[0]);

  return (
    <div className="space-y-2" data-line-row={item.id}>
      <p className="text-table font-medium text-fg">{item.description}</p>
      <p className="text-meta text-fg-subtle">
        {t("receipts.lineSummary", { quantity: item.quantity, unit: item.unit, received: item.receivedQuantity, outstanding: item.outstandingQuantity })}
      </p>

      <input type="hidden" name={`items.${index}.purchaseOrderItemId`} value={item.id} />
      <input type="hidden" name={`items.${index}.description`} value={item.description} />

      <div className="grid gap-3 sm:grid-cols-2">
        <DecimalCell
          id={`receipt-${item.id}-received`}
          name={`items.${index}.receivedQuantity`}
          label={t("receipts.receivedNow")}
          unit={item.unit}
          value={received}
          required={false}
          rule={{ label: t("receipts.receivedQuantity"), ...RATE_RULE }}
          serverError={error("receivedQuantity")}
          onChange={(value) => {
            setReceived(value);
            setEdited((current) => ({ ...current, receivedQuantity: true }));
          }}
        />
        <DecimalCell
          id={`receipt-${item.id}-rejected`}
          name={`items.${index}.rejectedQuantity`}
          label={t("common.rejected")}
          unit={item.unit}
          value={rejected}
          required={false}
          rule={{ label: t("receipts.rejectedQuantity"), ...RATE_RULE }}
          serverError={error("rejectedQuantity")}
          onChange={(value) => {
            setRejected(value);
            setEdited((current) => ({ ...current, rejectedQuantity: true }));
          }}
        />
      </div>
    </div>
  );
}
