"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "next/navigation";
import { PenLine } from "lucide-react";

import { RejectDialog } from "@/components/finance/reject-dialog";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import {
  cancelOrderAction,
  orderLifecycleAction,
  rejectOrderAction,
  type OrderLifecycleAction,
  type ProcurementActionResult,
} from "@/lib/actions/procurement";
import type { OrderDetailDTO } from "@/lib/modules/procurement/procurement.types";

/**
 * What a reader may do to a purchase order (PRD #19 §110–§131, §273).
 *
 * Approving is the moment the money is committed, which is why it is the
 * button that carries a confirmation of what it means rather than the one that
 * issues the paperwork afterwards (PRD #19 §116).
 */
export function OrderActions({ order }: { order: OrderDetailDTO }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = React.useTransition();
  const [dialog, setDialog] = React.useState<
    "none" | "reject" | "cancel" | "close" | "archive" | "approve"
  >("none");

  const may = order.capabilities;

  function handle(result: ProcurementActionResult, success: string) {
    if (result.ok) {
      setDialog("none");
      toast({ title: success, tone: "success" });
      router.refresh();
    } else {
      toast({ title: result.error, tone: "danger" });
    }
  }

  function run(action: OrderLifecycleAction, success: string) {
    startTransition(async () => {
      handle(await orderLifecycleAction(order.id, action), success);
    });
  }

  return (
    <>
      {may.canEdit ? (
        <Button asChild variant="secondary" size="sm">
          <Link href={`/procurement/orders/${order.id}/edit`}>
            <PenLine aria-hidden="true" />
            Edit
          </Link>
        </Button>
      ) : null}

      {may.canSubmit ? (
        <Button size="sm" disabled={pending} onClick={() => run("submit", "Sent for approval.")}>
          Submit for approval
        </Button>
      ) : null}

      {may.canReject ? (
        <Button variant="secondary" size="sm" disabled={pending} onClick={() => setDialog("reject")}>
          Reject
        </Button>
      ) : null}

      {may.canApprove ? (
        <Button size="sm" disabled={pending} onClick={() => setDialog("approve")}>
          Approve
        </Button>
      ) : null}

      {may.canIssue ? (
        <Button size="sm" disabled={pending} onClick={() => run("issue", "Order issued.")}>
          Issue to supplier
        </Button>
      ) : null}

      {may.canReceive ? (
        <Button asChild variant="secondary" size="sm">
          <Link href={`/procurement/orders/${order.id}/receipts`}>Record delivery</Link>
        </Button>
      ) : null}

      {may.canClose ? (
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => setDialog("close")}>
          Close
        </Button>
      ) : null}

      {may.canCancel ? (
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => setDialog("cancel")}>
          Cancel
        </Button>
      ) : null}

      {may.canArchive ? (
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => setDialog("archive")}>
          Archive
        </Button>
      ) : null}

      {may.canRestore ? (
        <Button variant="secondary" size="sm" disabled={pending} onClick={() => run("restore", "Order restored.")}>
          Restore
        </Button>
      ) : null}

      <ConfirmDialog
        open={dialog === "approve"}
        onOpenChange={(open) => !open && setDialog("none")}
        title={`Approve ${order.poNumber}?`}
        description="Approving commits the company to this spend. A commitment is recorded against the project budget straight away."
        confirmLabel="Approve order"
        destructive={false}
        pending={pending}
        onConfirm={() => run("approve", "Order approved.")}
      />

      <RejectDialog
        open={dialog === "reject"}
        onOpenChange={(open) => !open && setDialog("none")}
        title={`Reject ${order.poNumber}?`}
        onReject={async (reason) => {
          const result = await rejectOrderAction(order.id, reason);
          handle(result, "Order rejected.");
          return result.ok;
        }}
      />

      <RejectDialog
        open={dialog === "cancel"}
        onOpenChange={(open) => !open && setDialog("none")}
        title={`Cancel ${order.poNumber}?`}
        description="The order stays on the record, marked cancelled, and its commitment is released."
        label="Note"
        placeholder="Why is this order being cancelled?"
        confirmLabel="Cancel order"
        pendingLabel="Cancelling…"
        emptyMessage="Say why it is being cancelled."
        onReject={async (note) => {
          const result = await cancelOrderAction(order.id, note);
          handle(result, "Order cancelled.");
          return result.ok;
        }}
      />

      <RejectDialog
        open={dialog === "close"}
        onOpenChange={(open) => !open && setDialog("none")}
        title={`Close ${order.poNumber}?`}
        description="Use this when nothing further is coming, even if some of the order was never delivered."
        label="Note"
        placeholder="Why is this being closed now?"
        confirmLabel="Close order"
        pendingLabel="Closing…"
        emptyMessage="Say why it is being closed."
        onReject={async (note) => {
          const result = await orderLifecycleAction(order.id, "close", note);
          handle(result, "Order closed.");
          return result.ok;
        }}
      />

      <ConfirmDialog
        open={dialog === "archive"}
        onOpenChange={(open) => !open && setDialog("none")}
        title={`Archive ${order.poNumber}?`}
        description="It leaves the register and can be restored to the state it holds now."
        confirmLabel="Archive order"
        onConfirm={() => run("archive", "Order archived.")}
      />
    </>
  );
}
