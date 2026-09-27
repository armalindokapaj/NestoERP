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
  actionLifecycleAction,
  defectLifecycleAction,
  ncrLifecycleAction,
  type ActionDecision,
  type DefectDecision,
  type NcrDecision,
} from "@/lib/actions/qaqc";
import {
  ncrClosureGapLabels,
  type NcrClosureGap,
} from "@/lib/modules/qaqc/qaqc.status";
import type {
  CorrectiveActionDetailDTO,
  DefectDetailDTO,
  NcrDetailDTO,
} from "@/lib/modules/qaqc/qaqc.types";
import type { PendingCycle } from "@/lib/core/approvals/approval-guard";

/* -------------------------------------------------------------------------- */
/* Defects                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * What a reader may do to a defect (PRD #21 §116–§121).
 *
 * Resolve and close are separate controls because they are separate acts:
 * whoever fixed it records what they did, and somebody else agrees it is fixed.
 * The close button is absent for whoever resolved it (§119).
 */
export function DefectActions({ defect }: { defect: DefectDetailDTO }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = React.useTransition();
  const [dialog, setDialog] = React.useState<DefectDecision | "escalate" | null>(null);

  const may = defect.capabilities;

  function run(action: DefectDecision, note: string | null, success: string) {
    return new Promise<boolean>((resolve) => {
      startTransition(async () => {
        const result = await defectLifecycleAction(defect.id, action, note);
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
          <Link href={`/qaqc/defects/${defect.id}/edit`}>
            <PenLine aria-hidden="true" />
            Edit
          </Link>
        </Button>
      ) : null}

      {may.canResolve ? (
        <Button size="sm" disabled={pending} onClick={() => setDialog("resolve")}>
          Record the fix
        </Button>
      ) : null}

      {may.canClose ? (
        <Button size="sm" disabled={pending} onClick={() => setDialog("close")}>
          Confirm and close
        </Button>
      ) : null}

      {may.canEscalate ? (
        <Button asChild variant="secondary" size="sm">
          <Link href={`/qaqc/defects/${defect.id}/escalate`}>Raise an NCR</Link>
        </Button>
      ) : null}

      {may.canReopen ? (
        <Button variant="secondary" size="sm" disabled={pending} onClick={() => setDialog("reopen")}>
          Reopen
        </Button>
      ) : null}

      {may.canCancel ? (
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => setDialog("cancel")}>
          Cancel
        </Button>
      ) : null}

      <RejectDialog
        open={dialog === "resolve"}
        onOpenChange={(open) => setDialog(open ? "resolve" : null)}
        title={`Record the fix for ${defect.defectNumber}`}
        description="Say what was actually done. Somebody else has to confirm it before the defect closes."
        label="What was done"
        placeholder="How was it put right?"
        confirmLabel="Record the fix"
        pendingLabel="Saving…"
        emptyMessage="Say what was done about it."
        onReject={(note) => run("resolve", note, "Fix recorded. It now needs confirming.")}
      />

      <ConfirmDialog
        open={dialog === "close"}
        onOpenChange={(open) => setDialog(open ? "close" : null)}
        title={`Close ${defect.defectNumber}?`}
        description="You are confirming that the recorded fix is genuinely done. The defect stays readable afterwards."
        confirmLabel="Confirm and close"
        cancelLabel="Not yet"
        destructive={false}
        pending={pending}
        onConfirm={() => void run("close", null, "Defect closed.")}
      />

      <RejectDialog
        open={dialog === "reopen"}
        onOpenChange={(open) => setDialog(open ? "reopen" : null)}
        title={`Reopen ${defect.defectNumber}?`}
        description="The earlier fix stays on the record. Reopening says it did not hold."
        label="Reason"
        placeholder="Why is it being reopened?"
        confirmLabel="Reopen"
        pendingLabel="Reopening…"
        emptyMessage="Say why it is being reopened."
        onReject={(note) => run("reopen", note, "Defect reopened.")}
      />

      <RejectDialog
        open={dialog === "cancel"}
        onOpenChange={(open) => setDialog(open ? "cancel" : null)}
        title={`Cancel ${defect.defectNumber}?`}
        description="Use this for a defect raised in error. It stays on the record as cancelled."
        label="Reason"
        placeholder="Why is it being cancelled?"
        confirmLabel="Cancel defect"
        pendingLabel="Cancelling…"
        emptyMessage="Say why it is being cancelled."
        onReject={(note) => run("cancel", note, "Defect cancelled.")}
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* NCRs                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * What a reader may do to an NCR (PRD #21 §129–§139).
 *
 * When the closure requirements are not met, the submit button is absent and
 * the page says which requirement is missing — rather than offering a control
 * that would be refused (§136).
 */
export function NcrActions({
  ncr,
  cycle,
}: {
  ncr: NcrDetailDTO;
  /** The closure approval on screen; approve and reject name it back (AUD-10 §4, CW-05). */
  cycle: PendingCycle | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = React.useTransition();
  const [dialog, setDialog] = React.useState<NcrDecision | null>(null);

  const may = ncr.capabilities;

  function run(action: NcrDecision, note: string | null, success: string) {
    return new Promise<boolean>((resolve) => {
      startTransition(async () => {
        const result = await ncrLifecycleAction(ncr.id, action, note, cycle);
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
          <Link href={`/qaqc/ncrs/${ncr.id}/edit`}>
            <PenLine aria-hidden="true" />
            Edit
          </Link>
        </Button>
      ) : null}

      {may.canOpen ? (
        <Button size="sm" disabled={pending} onClick={() => void run("open", null, "NCR opened.")}>
          Open
        </Button>
      ) : null}

      {may.canAddAction ? (
        <Button asChild variant="secondary" size="sm">
          <Link href={`/qaqc/corrective-actions/new?ncrId=${ncr.id}`}>Add an action</Link>
        </Button>
      ) : null}

      {may.canSubmit ? (
        <Button size="sm" disabled={pending} onClick={() => setDialog("submit")}>
          Submit for closure
        </Button>
      ) : null}

      {may.canApprove ? (
        <Button size="sm" disabled={pending} onClick={() => setDialog("approve")}>
          Approve closure
        </Button>
      ) : null}

      {may.canReject ? (
        <Button variant="secondary" size="sm" disabled={pending} onClick={() => setDialog("reject")}>
          Reject
        </Button>
      ) : null}

      {may.canClose ? (
        <Button size="sm" disabled={pending} onClick={() => setDialog("close")}>
          Close
        </Button>
      ) : null}

      {may.canReopen ? (
        <Button variant="secondary" size="sm" disabled={pending} onClick={() => setDialog("reopen")}>
          Reopen
        </Button>
      ) : null}

      {may.canCancel ? (
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => setDialog("cancel")}>
          Cancel
        </Button>
      ) : null}

      <ConfirmDialog
        open={dialog === "submit"}
        onOpenChange={(open) => setDialog(open ? "submit" : null)}
        title={`Submit ${ncr.ncrNumber} for closure?`}
        description="The root cause is recorded and every corrective action has been verified, so this can go for approval."
        confirmLabel="Submit"
        cancelLabel="Not yet"
        destructive={false}
        pending={pending}
        onConfirm={() => void run("submit", null, "Sent for closure approval.")}
      />

      <ConfirmDialog
        open={dialog === "approve"}
        onOpenChange={(open) => setDialog(open ? "approve" : null)}
        title={`Approve the closure of ${ncr.ncrNumber}?`}
        description="You are agreeing that the root cause is understood and the corrective actions genuinely fixed it."
        confirmLabel="Approve closure"
        cancelLabel="Not yet"
        destructive={false}
        pending={pending}
        onConfirm={() => void run("approve", null, "Closure approved.")}
      />

      <ConfirmDialog
        open={dialog === "close"}
        onOpenChange={(open) => setDialog(open ? "close" : null)}
        title={`Close ${ncr.ncrNumber}?`}
        description="The non-conformance is settled and stays readable. Reopening it later is a separate, recorded act."
        confirmLabel="Close NCR"
        cancelLabel="Not yet"
        destructive={false}
        pending={pending}
        onConfirm={() => void run("close", null, "NCR closed.")}
      />

      <RejectDialog
        open={dialog === "reject"}
        onOpenChange={(open) => setDialog(open ? "reject" : null)}
        title={`Reject the closure of ${ncr.ncrNumber}?`}
        description="It goes back to whoever owns it, with your reason on the record."
        placeholder="What is still missing?"
        confirmLabel="Reject closure"
        pendingLabel="Rejecting…"
        emptyMessage="Say what is still missing."
        onReject={(note) => run("reject", note, "Closure rejected.")}
      />

      <RejectDialog
        open={dialog === "reopen"}
        onOpenChange={(open) => setDialog(open ? "reopen" : null)}
        title={`Reopen ${ncr.ncrNumber}?`}
        description="Everything already recorded stays. Reopening says the problem has come back."
        label="Reason"
        placeholder="Why is it being reopened?"
        confirmLabel="Reopen"
        pendingLabel="Reopening…"
        emptyMessage="Say why it is being reopened."
        onReject={(note) => run("reopen", note, "NCR reopened.")}
      />

      <RejectDialog
        open={dialog === "cancel"}
        onOpenChange={(open) => setDialog(open ? "cancel" : null)}
        title={`Cancel ${ncr.ncrNumber}?`}
        description="Use this for an NCR raised in error. It stays on the record as cancelled."
        label="Reason"
        placeholder="Why is it being cancelled?"
        confirmLabel="Cancel NCR"
        pendingLabel="Cancelling…"
        emptyMessage="Say why it is being cancelled."
        onReject={(note) => run("cancel", note, "NCR cancelled.")}
      />
    </>
  );
}

/** What still stands between an NCR and closure (PRD #21 §136). */
export function ClosureGaps({ gaps }: { gaps: NcrClosureGap[] }) {
  if (gaps.length === 0) return null;

  return (
    <div className="rounded-md border border-line bg-surface-muted px-4 py-3">
      <p className="text-table font-medium text-fg">Before this can close</p>
      <ul className="mt-2 space-y-1">
        {gaps.map((gap) => (
          <li key={gap} className="text-table text-fg-muted">
            {ncrClosureGapLabels[gap]}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-meta text-fg-subtle">
        This is what separates an NCR from a defect: it closes when the cause is understood and
        the fix is verified, not when the work is done.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Corrective actions                                                          */
/* -------------------------------------------------------------------------- */

/**
 * What a reader may do to a corrective action (PRD #21 §146–§150).
 *
 * Verify is absent for whoever completed it. An action verified by the person
 * who did the work is somebody marking their own homework, and an NCR closed on
 * the back of it would mean nothing (§147).
 */
export function CorrectiveActionActions({
  action,
}: {
  action: CorrectiveActionDetailDTO;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = React.useTransition();
  const [dialog, setDialog] = React.useState<ActionDecision | null>(null);

  const may = action.capabilities;

  function run(decision: ActionDecision, note: string | null, success: string) {
    return new Promise<boolean>((resolve) => {
      startTransition(async () => {
        const result = await actionLifecycleAction(action.id, decision, note);
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
          <Link href={`/qaqc/corrective-actions/${action.id}/edit`}>
            <PenLine aria-hidden="true" />
            Edit
          </Link>
        </Button>
      ) : null}

      {may.canComplete ? (
        <Button size="sm" disabled={pending} onClick={() => setDialog("complete")}>
          Mark done
        </Button>
      ) : null}

      {may.canVerify ? (
        <>
          <Button size="sm" disabled={pending} onClick={() => setDialog("verify")}>
            Verify
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={() => setDialog("reject")}
          >
            Send back
          </Button>
        </>
      ) : null}

      {may.canReopen ? (
        <Button variant="secondary" size="sm" disabled={pending} onClick={() => setDialog("reopen")}>
          Reopen
        </Button>
      ) : null}

      {may.canCancel ? (
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => setDialog("cancel")}>
          Cancel
        </Button>
      ) : null}

      <RejectDialog
        open={dialog === "complete"}
        onOpenChange={(open) => setDialog(open ? "complete" : null)}
        title={`Mark ${action.actionNumber} done`}
        description="Say what was actually done. Somebody else has to verify it before it counts."
        label="What was done"
        placeholder="Describe the work carried out."
        confirmLabel="Mark done"
        pendingLabel="Saving…"
        emptyMessage="Say what was done."
        onReject={(note) => run("complete", note, "Marked done. It now needs verifying.")}
      />

      <ConfirmDialog
        open={dialog === "verify"}
        onOpenChange={(open) => setDialog(open ? "verify" : null)}
        title={`Verify ${action.actionNumber}?`}
        description="You are confirming the action genuinely fixed what it was raised for. An NCR can only close once every action on it is verified."
        confirmLabel="Verify"
        cancelLabel="Not yet"
        destructive={false}
        pending={pending}
        onConfirm={() => void run("verify", null, "Action verified.")}
      />

      <RejectDialog
        open={dialog === "reject"}
        onOpenChange={(open) => setDialog(open ? "reject" : null)}
        title={`Send ${action.actionNumber} back?`}
        description="It goes back to whoever owns it, with your reason on the record."
        placeholder="What is still outstanding?"
        confirmLabel="Send back"
        pendingLabel="Sending…"
        emptyMessage="Say what is still outstanding."
        onReject={(note) => run("reject", note, "Sent back.")}
      />

      <RejectDialog
        open={dialog === "reopen"}
        onOpenChange={(open) => setDialog(open ? "reopen" : null)}
        title={`Reopen ${action.actionNumber}?`}
        description="The earlier verification stays on the record. Reopening says the fix did not hold."
        label="Reason"
        placeholder="Why is it being reopened?"
        confirmLabel="Reopen"
        pendingLabel="Reopening…"
        emptyMessage="Say why it is being reopened."
        onReject={(note) => run("reopen", note, "Action reopened.")}
      />

      <RejectDialog
        open={dialog === "cancel"}
        onOpenChange={(open) => setDialog(open ? "cancel" : null)}
        title={`Cancel ${action.actionNumber}?`}
        description="A cancelled action no longer blocks its NCR from closing."
        label="Reason"
        placeholder="Why is it being cancelled?"
        confirmLabel="Cancel action"
        pendingLabel="Cancelling…"
        emptyMessage="Say why it is being cancelled."
        onReject={(note) => run("cancel", note, "Action cancelled.")}
      />
    </>
  );
}
