"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "@/components/navigation/guarded-router";
import { PenLine } from "lucide-react";

import { RejectDialog } from "@/components/finance/reject-dialog";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import {
  cancelRequestAction,
  rejectRequestAction,
  requestLifecycleAction,
  type ProcurementActionResult,
  type RequestLifecycleAction,
} from "@/lib/actions/procurement";
import type { RequestDetailDTO } from "@/lib/modules/procurement/procurement.types";

/**
 * What a reader may do to a purchase request (PRD #19 §56–§60).
 *
 * Every control is drawn from the record's own capabilities, so somebody who
 * cannot approve sees no Approve button rather than a disabled one — a disabled
 * control still tells them the action exists and that they were refused it
 * (PRD #5 §32).
 */
export function RequestActions({ request }: { request: RequestDetailDTO }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = React.useTransition();
  const [dialog, setDialog] = React.useState<"none" | "reject" | "cancel" | "archive">("none");

  const may = request.capabilities;

  function handle(result: ProcurementActionResult, success: string) {
    if (result.ok) {
      setDialog("none");
      toast({ title: success, tone: "success" });
      router.refresh();
    } else {
      toast({ title: result.error, tone: "danger" });
    }
  }

  function run(action: RequestLifecycleAction, success: string) {
    startTransition(async () => {
      handle(await requestLifecycleAction(request.id, action), success);
    });
  }

  return (
    <>
      {may.canEdit ? (
        <Button asChild variant="secondary" size="sm">
          <Link href={`/procurement/requests/${request.id}/edit`}>
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
        <Button size="sm" disabled={pending} onClick={() => run("approve", "Request approved.")}>
          Approve
        </Button>
      ) : null}

      {may.canCreateRfq ? (
        <Button asChild variant="secondary" size="sm">
          <Link href={`/procurement/rfqs/new?requestId=${request.id}`}>Create enquiry</Link>
        </Button>
      ) : null}

      {may.canCreateOrder ? (
        <Button asChild variant="secondary" size="sm">
          <Link href={`/procurement/orders/new?requestId=${request.id}`}>Create order</Link>
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
        <Button variant="secondary" size="sm" disabled={pending} onClick={() => run("restore", "Request restored.")}>
          Restore
        </Button>
      ) : null}

      <RejectDialog
        open={dialog === "reject"}
        onOpenChange={(open) => !open && setDialog("none")}
        title={`Reject ${request.requestNumber}?`}
        onReject={async (reason) => {
          const result = await rejectRequestAction(request.id, reason);
          handle(result, "Request rejected.");
          return result.ok;
        }}
      />

      <RejectDialog
        open={dialog === "cancel"}
        onOpenChange={(open) => !open && setDialog("none")}
        title={`Cancel ${request.requestNumber}?`}
        description="The request stays on the record, marked cancelled."
        label="Note"
        placeholder="Why is this no longer needed?"
        confirmLabel="Cancel request"
        pendingLabel="Cancelling…"
        emptyMessage="Say why it is no longer needed."
        onReject={async (note) => {
          const result = await cancelRequestAction(request.id, note);
          handle(result, "Request cancelled.");
          return result.ok;
        }}
      />

      <ConfirmDialog
        open={dialog === "archive"}
        onOpenChange={(open) => !open && setDialog("none")}
        title={`Archive ${request.requestNumber}?`}
        description="It leaves the register and can be restored to the state it holds now."
        confirmLabel="Archive request"
        onConfirm={() => run("archive", "Request archived.")}
      />
    </>
  );
}
