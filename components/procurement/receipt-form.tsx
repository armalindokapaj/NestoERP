"use client";

import * as React from "react";
import { useRouter } from "@/components/navigation/guarded-router";

import { FieldErrorProvider } from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { SaveMessages, UnsavedIndicator } from "@/components/unsaved/editor-status";
import { useEditorSave } from "@/components/unsaved/use-editor-save";
import { recordReceiptAction } from "@/lib/actions/procurement";
import type { OrderDetailDTO } from "@/lib/modules/procurement/procurement.types";

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
  const formRef = React.useRef<HTMLFormElement>(null);
  const [overReceipt, setOverReceipt] = React.useState(false);
  const [overMessage, setOverMessage] = React.useState<string | null>(null);

  const save = useEditorSave({
    formRef,
    action: (formData: FormData) => recordReceiptAction(order.id, formData),
    module: "procurement",
    saveKind: "create",
    label: "Delivery",
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
      setOverMessage(result.error ?? null);
      return true;
    },
    onCommitted: () => {
      toast({ title: "Delivery recorded.", tone: "success" });
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
              <span>Record it anyway — this is what actually arrived.</span>
            </label>
          </div>
        ) : null}

        <fieldset disabled={pending || Boolean(save.saved)} className="m-0 min-w-0 space-y-5 border-0 p-0">
          <section className="nesto-card space-y-4 p-5">
            <h2 className="text-card font-semibold text-fg">The delivery</h2>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="receiptDate">Date received</Label>
                <Input
                  id="receiptDate"
                  name="receiptDate"
                  type="date"
                  required
                  defaultValue={new Date().toISOString().slice(0, 10)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="deliveryReference">Delivery note</Label>
                <Input id="deliveryReference" name="deliveryReference" maxLength={120} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" name="notes" rows={2} maxLength={2000} />
            </div>
          </section>

          <section className="nesto-card overflow-hidden">
            <div className="p-5">
              <h2 className="text-card font-semibold text-fg">What arrived</h2>
              <p className="mt-1 text-meta text-fg-subtle">
                Prefilled with what is still outstanding. Anything turned away goes in the rejected
                column, and accepted is worked out from the two.
              </p>
            </div>

            <div className="space-y-4 border-t border-line p-5">
              {order.items.map((item, index) => (
                <div key={item.id} className="space-y-2">
                  <p className="text-table font-medium text-fg">{item.description}</p>
                  <p className="text-meta text-fg-subtle">
                    {item.quantity} {item.unit} ordered · {item.receivedQuantity} received so far ·{" "}
                    {item.outstandingQuantity} outstanding
                  </p>

                  <input
                    type="hidden"
                    name={`items[${index}][purchaseOrderItemId]`}
                    value={item.id}
                  />
                  <input type="hidden" name={`items[${index}][description]`} value={item.description} />

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor={`items-${index}-received`}>Received now</Label>
                      <Input
                        id={`items-${index}-received`}
                        name={`items[${index}][receivedQuantity]`}
                        defaultValue={item.outstandingQuantity}
                        inputMode="decimal"
                        required
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`items-${index}-rejected`}>Rejected</Label>
                      <Input
                        id={`items-${index}-rejected`}
                        name={`items[${index}][rejectedQuantity]`}
                        defaultValue="0"
                        inputMode="decimal"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </fieldset>

        <div className="flex items-center justify-end gap-2">
          <UnsavedIndicator save={save} />
          <Button type="submit" disabled={pending}>
            {pending ? "Recording…" : "Record delivery"}
          </Button>
        </div>
      </form>
    </FieldErrorProvider>
  );
}
