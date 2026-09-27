"use client";

import * as React from "react";
import { useRouter } from "@/components/navigation/guarded-router";
import { Ban } from "lucide-react";

import { useFinanceTranslations } from "@/components/finance/finance-text";
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
  const t = useFinanceTranslations();
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Ban aria-hidden="true" />
        {t("voidPayment.button")}
      </Button>

      <RejectDialog
        open={open}
        onOpenChange={setOpen}
        title={t("voidPayment.title", { reference })}
        description={t("voidPayment.description")}
        label={t("voidPayment.label")}
        placeholder={t("voidPayment.placeholder")}
        confirmLabel={t("voidPayment.confirm")}
        pendingLabel={t("voidPayment.pending")}
        emptyMessage={t("voidPayment.empty")}
        onReject={async (reason) => {
          const result = await voidPaymentAction(paymentId, reason);
          if (result.ok) {
            toast({ title: t("voidPayment.done"), tone: "success" });
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
