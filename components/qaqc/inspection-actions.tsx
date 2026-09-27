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
  inspectionLifecycleAction,
  type InspectionDecision,
} from "@/lib/actions/qaqc";
import type { PendingCycle } from "@/lib/core/approvals/approval-guard";
import type { InspectionDetailDTO } from "@/lib/modules/qaqc/qaqc.types";

/**
 * What a reader may do to an inspection (PRD #21 §79–§88).
 *
 * Approve and reject appear only for somebody who did not submit it: the
 * capability already withheld them, and this component renders what it is
 * given (§165).
 *
 * Close is offered only when the follow-up rule is satisfied, so the button
 * never fails for a reason the page could have explained (§85, §86).
 */
export function InspectionActions({
  inspection,
  cycle,
}: {
  inspection: InspectionDetailDTO;
  /** The approval cycle on screen; approve and reject name it back (AUD-10 §4, CW-05). */
  cycle: PendingCycle | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = React.useTransition();
  const [dialog, setDialog] = React.useState<InspectionDecision | null>(null);

  const may = inspection.capabilities;

  function run(action: InspectionDecision, note: string | null, success: string) {
    return new Promise<boolean>((resolve) => {
      startTransition(async () => {
        const result = await inspectionLifecycleAction(inspection.id, action, note, cycle);
        if (result.ok) {
          setDialog(null);
          toast({ title: success, tone: "success" });
          router.refresh();
          resolve(true);
        } else {
          toast({ title: result.error, tone: "danger" });
          resolve(false);
        }
      });
    });
  }

  return (
    <>
      {may.canEdit ? (
        <Button asChild variant="secondary" size="sm">
          <Link href={`/qaqc/inspections/${inspection.id}/edit`}>
            <PenLine aria-hidden="true" />
            Edit
          </Link>
        </Button>
      ) : null}

      {may.canExecute ? (
        <Button asChild size="sm">
          <Link href={`/qaqc/inspections/${inspection.id}/execute`}>
            {inspection.status === "DRAFT" ? "Start inspection" : "Continue"}
          </Link>
        </Button>
      ) : null}

      {may.canApprove ? (
        <Button size="sm" disabled={pending} onClick={() => setDialog("approve")}>
          Approve
        </Button>
      ) : null}

      {may.canReject ? (
        <Button variant="secondary" size="sm" disabled={pending} onClick={() => setDialog("reject")}>
          Reject
        </Button>
      ) : null}

      {may.canRework ? (
        <Button size="sm" disabled={pending} onClick={() => run("rework", null, "Reopened for rework.")}>
          Rework
        </Button>
      ) : null}

      {may.canClose ? (
        <Button size="sm" disabled={pending} onClick={() => setDialog("close")}>
          Close out
        </Button>
      ) : null}

      {may.canRaiseReinspection ? (
        <Button asChild variant="secondary" size="sm">
          <Link href={`/qaqc/inspections/${inspection.id}/reinspect`}>Reinspect</Link>
        </Button>
      ) : null}

      {may.canReopen ? (
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => setDialog("reopen")}>
          Reopen
        </Button>
      ) : null}

      {may.canCancel ? (
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => setDialog("cancel")}>
          Cancel
        </Button>
      ) : null}

      <ConfirmDialog
        open={dialog === "approve"}
        onOpenChange={(open) => setDialog(open ? "approve" : null)}
        title={`Approve ${inspection.inspectionNumber}?`}
        description={
          inspection.result === "PASS"
            ? "You are agreeing with the inspector that this passed. It can then be closed out."
            : "You are agreeing with the inspector's findings. The failure still has to be followed up before it can be closed."
        }
        confirmLabel="Approve"
        cancelLabel="Not yet"
        destructive={false}
        pending={pending}
        onConfirm={() => void run("approve", null, "Inspection approved.")}
      />

      <ConfirmDialog
        open={dialog === "close"}
        onOpenChange={(open) => setDialog(open ? "close" : null)}
        title={`Close ${inspection.inspectionNumber}?`}
        description={
          inspection.result === "PASS"
            ? "Nothing is outstanding on a pass, so this closes straight away."
            : "The follow-up is on record, so this can be closed out. It stays readable afterwards."
        }
        confirmLabel="Close out"
        cancelLabel="Not yet"
        destructive={false}
        pending={pending}
        onConfirm={() => void run("close", null, "Inspection closed.")}
      />

      <RejectDialog
        open={dialog === "reject"}
        onOpenChange={(open) => setDialog(open ? "reject" : null)}
        title={`Reject ${inspection.inspectionNumber}?`}
        description="The reason is recorded against the approval and shown to the inspector, who can rework and resubmit."
        placeholder="What needs to be checked again?"
        confirmLabel="Reject"
        pendingLabel="Rejecting…"
        emptyMessage="Say what needs to change, so it can be corrected."
        onReject={(reason) => run("reject", reason, "Inspection rejected.")}
      />

      <RejectDialog
        open={dialog === "cancel"}
        onOpenChange={(open) => setDialog(open ? "cancel" : null)}
        title={`Cancel ${inspection.inspectionNumber}?`}
        description="A cancelled inspection releases nothing and has no quality effect. It stays on the record."
        label="Reason"
        placeholder="Why is it being cancelled?"
        confirmLabel="Cancel inspection"
        pendingLabel="Cancelling…"
        emptyMessage="Say why it is being cancelled."
        onReject={(reason) => run("cancel", reason, "Inspection cancelled.")}
      />

      <RejectDialog
        open={dialog === "reopen"}
        onOpenChange={(open) => setDialog(open ? "reopen" : null)}
        title={`Reopen ${inspection.inspectionNumber}?`}
        description="Reopening a closed inspection is for correcting the record. If the work needs looking at again, raise a reinspection instead."
        label="Reason"
        placeholder="Why is the record being reopened?"
        confirmLabel="Reopen"
        pendingLabel="Reopening…"
        emptyMessage="Say why it is being reopened."
        onReject={(reason) => run("reopen", reason, "Inspection reopened.")}
      />
    </>
  );
}
