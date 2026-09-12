"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { selectClass, FieldErrorProvider } from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { recordQuoteAction } from "@/lib/actions/procurement";
import type { RfqDetailDTO } from "@/lib/modules/procurement/procurement.types";

/**
 * Records what one supplier answered (PRD #19 §85, §269).
 *
 * Priced against the enquiry's own lines, in the enquiry's currency, because
 * comparing two currencies is not a comparison V0.1 can make (PRD #19 §83).
 *
 * Only suppliers who were invited appear: a quote from somebody who was never
 * asked is not an answer to this enquiry (PRD #19 §67).
 */
export function QuoteForm({ rfq }: { rfq: RfqDetailDTO }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = React.useTransition();
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});
  const [error, setError] = React.useState<string | null>(null);

  const awaiting = rfq.suppliers.filter((entry) => entry.quoteId === null);

  function submit(formData: FormData) {
    setError(null);
    setFieldErrors({});

    startTransition(async () => {
      const result = await recordQuoteAction(rfq.id, formData);
      if (result.ok) {
        toast({ title: "Quote recorded.", tone: "success" });
        router.push(`/procurement/rfqs/${rfq.id}/comparison`);
        router.refresh();
      } else {
        setError(result.error);
        setFieldErrors(result.fieldErrors ?? {});
      }
    });
  }

  if (awaiting.length === 0) {
    return (
      <p className="nesto-card p-5 text-table text-fg-subtle">
        Every invited supplier has already answered. Invite another supplier to record one more.
      </p>
    );
  }

  return (
    <FieldErrorProvider value={fieldErrors}>
      <form action={submit} className="space-y-5">
        {error ? (
          <p className="rounded-md bg-danger-soft px-4 py-3 text-table text-danger-strong">
            {error}
          </p>
        ) : null}

        <section className="nesto-card space-y-4 p-5">
          <h2 className="text-card font-semibold text-fg">The answer</h2>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="supplierId">Supplier</Label>
              <select id="supplierId" name="supplierId" className={selectClass} required>
                <option value="">Choose a supplier</option>
                {awaiting.map((entry) => (
                  <option key={entry.id} value={entry.supplier.id}>
                    {entry.supplier.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="quoteNumber">Their reference</Label>
              <Input id="quoteNumber" name="quoteNumber" maxLength={60} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="quoteDate">Quote date</Label>
              <Input
                id="quoteDate"
                name="quoteDate"
                type="date"
                required
                defaultValue={new Date().toISOString().slice(0, 10)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="validUntil">Valid until</Label>
              <Input id="validUntil" name="validUntil" type="date" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="leadTimeDays">Lead time (days)</Label>
              <Input id="leadTimeDays" name="leadTimeDays" type="number" min={0} max={3650} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="deliveryDate">Offered delivery</Label>
              <Input id="deliveryDate" name="deliveryDate" type="date" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" name="notes" rows={2} maxLength={2000} />
          </div>
        </section>

        <section className="nesto-card overflow-hidden">
          <div className="p-5">
            <h2 className="text-card font-semibold text-fg">Their prices</h2>
            <p className="mt-1 text-meta text-fg-subtle">
              Priced in {rfq.currency}. Tax is a fraction — 0.2 is twenty per cent.
            </p>
          </div>

          <div className="space-y-4 border-t border-line p-5">
            {rfq.items.map((item, index) => (
              <div key={item.id} className="space-y-2">
                <p className="text-table font-medium text-fg">{item.description}</p>
                <input type="hidden" name={`items[${index}][rfqItemId]`} value={item.id} />
                <input type="hidden" name={`items[${index}][description]`} value={item.description} />

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor={`items-${index}-quantity`}>Quantity</Label>
                    <Input
                      id={`items-${index}-quantity`}
                      name={`items[${index}][quantity]`}
                      defaultValue={item.quantity}
                      inputMode="decimal"
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`items-${index}-unitPrice`}>Unit price</Label>
                    <Input
                      id={`items-${index}-unitPrice`}
                      name={`items[${index}][unitPrice]`}
                      inputMode="decimal"
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`items-${index}-taxRate`}>Tax rate</Label>
                    <Input
                      id={`items-${index}-taxRate`}
                      name={`items[${index}][taxRate]`}
                      defaultValue="0"
                      inputMode="decimal"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className="flex justify-end gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? "Recording…" : "Record quote"}
          </Button>
        </div>
      </form>
    </FieldErrorProvider>
  );
}
