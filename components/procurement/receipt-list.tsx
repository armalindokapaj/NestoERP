"use client";

import * as React from "react";
import { useRouter } from "@/components/navigation/guarded-router";

import { RejectDialog } from "@/components/finance/reject-dialog";
import { ProcurementHandoff } from "@/components/inventory/procurement-handoff";
import { PersonLink } from "@/components/people/person-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { ScrollRegion } from "@/components/ui/scroll-region";
import { voidReceiptAction } from "@/lib/actions/procurement";
import type {
  ItemOption,
  LocationOption,
  Option,
} from "@/lib/modules/inventory/inventory.options";
import type { ReceiptDTO } from "@/lib/modules/procurement/procurement.types";
import { formatDate } from "@/lib/utils/format";

/**
 * What the Inventory handoff needs to offer a mapping (PRD #20 §11).
 *
 * `null` means the reader has no Inventory access, and no booking control
 * appears at all — a Procurement clerk does not gain warehouse rights by
 * standing next to a delivery (PRD #20 §303).
 */
export type InventoryHandoff = {
  items: ItemOption[];
  warehouses: Option[];
  locations: LocationOption[];
  /** Deliveries already booked into stock, keyed by goods-receipt id. */
  posted: Record<string, { id: string; receiptNumber: string; status: string }>;
};

/**
 * Deliveries recorded against one order (PRD #19 §143, §144).
 *
 * There is no edit. A correction is a new receipt or a void with a reason,
 * because the quantities on a receipt are somebody's statement about a delivery
 * that happened, and rewriting one erases who said what.
 */
export function ReceiptList({
  orderId,
  receipts,
  handoff,
  qualityGate,
}: {
  orderId: string;
  receipts: ReceiptDTO[];
  handoff?: InventoryHandoff | null;
  /**
   * The quality position on each delivery, rendered by the server and keyed by
   * receipt id (PRD #21 §12, §13). Passed in rather than fetched here, because
   * a card in a client component cannot read the database.
   */
  qualityGate?: Record<string, React.ReactNode>;
}) {
  const router = useRouter();
  const toast = useToast();
  const [voiding, setVoiding] = React.useState<ReceiptDTO | null>(null);

  return (
    <>
      <ul className="space-y-3">
        {receipts.map((receipt) => (
          <li key={receipt.id} className="nesto-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-table font-medium text-fg">
                  {receipt.receiptNumber}
                  {receipt.deliveryReference ? ` · ${receipt.deliveryReference}` : ""}
                </p>
                <p className="text-meta text-fg-subtle">
                  {formatDate(receipt.receiptDate)}
                  {receipt.receivedBy ? (
                    <>
                      {" · received by "}
                      <PersonLink memberId={receipt.receivedBy.memberId} name={receipt.receivedBy.fullName} />
                    </>
                  ) : null}
                </p>
              </div>

              <div className="flex items-center gap-2">
                {receipt.status === "VOIDED" ? (
                  <Badge tone="danger">Voided</Badge>
                ) : (
                  <Badge tone="success">Recorded</Badge>
                )}
                {receipt.capabilities.canVoid ? (
                  <Button variant="ghost" size="sm" onClick={() => setVoiding(receipt)}>
                    Void
                  </Button>
                ) : null}
              </div>
            </div>

            {receipt.voidReason ? (
              <p className="mt-2 text-meta text-fg-muted">
                <span className="font-medium">Voided:</span> {receipt.voidReason}
              </p>
            ) : null}

            {/* Bounded: a long line or "1250.5000 tonne" pans here instead of widening the page (AUD-04 §5, MW-05). */}
            <ScrollRegion label={`Lines on delivery ${receipt.receiptNumber}`} className="mt-4">
            <table className="w-full text-table">
              <caption className="sr-only">Lines on delivery {receipt.receiptNumber}</caption>
              <thead>
                <tr className="text-left text-meta text-fg-subtle">
                  <th scope="col" className="pb-2 font-medium">Line</th>
                  <th scope="col" className="pb-2 text-right font-medium">Received</th>
                  <th scope="col" className="pb-2 text-right font-medium">Accepted</th>
                  <th scope="col" className="pb-2 text-right font-medium">Rejected</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {receipt.items.map((item) => (
                  <tr key={item.id}>
                    <td className="min-w-[8rem] py-2 pr-3 text-fg [overflow-wrap:anywhere]">{item.description}</td>
                    <td className="whitespace-nowrap py-2 pl-3 text-right tabular-nums text-fg">
                      {item.receivedQuantity} {item.unit}
                    </td>
                    <td className="py-2 text-right tabular-nums text-fg">{item.acceptedQuantity}</td>
                    <td className="py-2 text-right tabular-nums">
                      <span
                        className={
                          Number(item.rejectedQuantity) > 0 ? "text-warning-strong" : "text-fg-subtle"
                        }
                      >
                        {item.rejectedQuantity}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </ScrollRegion>

            {qualityGate?.[receipt.id] ? (
              <div className="mt-4">{qualityGate[receipt.id]}</div>
            ) : null}

            {handoff && receipt.status !== "VOIDED" ? (
              <div className="mt-4 border-t border-line pt-4">
                <ProcurementHandoff
                  goodsReceiptId={receipt.id}
                  receiptNumber={receipt.receiptNumber}
                  lines={receipt.items.map((item) => ({
                    goodsReceiptItemId: item.id,
                    description: item.description,
                    unit: item.unit,
                    acceptedQuantity: item.acceptedQuantity,
                  }))}
                  items={handoff.items}
                  warehouses={handoff.warehouses}
                  locations={handoff.locations}
                  existing={handoff.posted[receipt.id] ?? null}
                />
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      <RejectDialog
        open={voiding !== null}
        onOpenChange={(open) => !open && setVoiding(null)}
        title={voiding ? `Void ${voiding.receiptNumber}?` : "Void delivery"}
        description="The receipt stays on the record, marked void, and stops counting toward what has arrived."
        label="Reason"
        placeholder="Why is this being voided?"
        confirmLabel="Void delivery"
        pendingLabel="Voiding…"
        emptyMessage="Say why it is being voided."
        onReject={async (reason) => {
          if (!voiding) return false;
          const result = await voidReceiptAction(orderId, voiding.id, reason);
          if (result.ok) {
            toast({ title: "Delivery voided.", tone: "success" });
            setVoiding(null);
            router.refresh();
            return true;
          }
          toast({ title: result.error, tone: "danger" });
          return false;
        }}
      />
    </>
  );
}
