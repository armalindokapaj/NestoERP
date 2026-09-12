"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { RejectDialog } from "@/components/finance/reject-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { voidReceiptAction } from "@/lib/actions/procurement";
import type { ReceiptDTO } from "@/lib/modules/procurement/procurement.types";
import { formatDate } from "@/lib/utils/format";

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
}: {
  orderId: string;
  receipts: ReceiptDTO[];
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
                  {receipt.receivedBy ? ` · received by ${receipt.receivedBy.fullName}` : ""}
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

            <table className="mt-4 w-full text-table">
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
                    <td className="py-2 text-fg">{item.description}</td>
                    <td className="py-2 text-right tabular-nums text-fg">
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
