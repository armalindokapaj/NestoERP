"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Ban } from "lucide-react";

import { RejectDialog } from "@/components/finance/reject-dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { voidPaymentAction } from "@/lib/actions/finance";

/**
 * Voiding a payment (PRD #15 §85, §86).
 *
 * A reason is required because voiding money that was recorded as received or
 * paid is a correction somebody will have to account for later — and the
 * payment is not deleted, it keeps its row and stops counting, so the reason
 * stays attached to it permanently.
 */
export function VoidPaymentButton({
  paymentId,
  reference,
}: {
  paymentId: string;
  reference: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Ban aria-hidden="true" />
        Void
      </Button>

      <RejectDialog
        open={open}
        onOpenChange={setOpen}
        title={`Void ${reference}`}
        description="The payment keeps its row and stops counting towards what has been settled. The reason is recorded against it."
        label="Reason"
        placeholder="Why is this payment being voided?"
        confirmLabel="Void payment"
        pendingLabel="Voiding…"
        emptyMessage="Say why the payment is being voided."
        onReject={async (reason) => {
          const result = await voidPaymentAction(paymentId, reason);
          if (result.ok) {
            toast({ title: "Payment voided.", tone: "success" });
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
