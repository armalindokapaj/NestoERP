"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "@/components/navigation/guarded-router";

import { RejectDialog } from "@/components/finance/reject-dialog";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { OUTCOME_COPY } from "@/lib/unsaved/outcome";
import {
  activatePermitAction,
  approveInspectionAction,
  approvePermitAction,
  approveRiskAssessmentAction,
  archiveRiskAssessmentAction,
  cancelHazardAction,
  cancelHseActionAction,
  cancelIncidentAction,
  cancelInspectionAction,
  cancelPermitAction,
  cancelStopWorkAction,
  cancelToolboxTalkAction,
  closeInspectionAction,
  closeIncidentAction,
  closeObservationAction,
  closePermitAction,
  completeHseActionAction,
  completeToolboxTalkAction,
  rejectHseActionAction,
  rejectInspectionAction,
  rejectPermitAction,
  rejectRiskAssessmentAction,
  releaseStopWorkAction,
  reopenHazardAction,
  reopenHseActionAction,
  reopenIncidentAction,
  reopenObservationAction,
  startInspectionAction,
  startInvestigationAction,
  submitIncidentCloseAction,
  submitPermitAction,
  submitRiskAssessmentAction,
  suspendPermitAction,
  verifyHseActionAction,
  type HseActionResult,
} from "@/lib/actions/hse";
import type {
  ActionDetailDTO,
  HazardDetailDTO,
  IncidentDetailDTO,
  InspectionDetailDTO,
  ObservationDetailDTO,
  PermitDetailDTO,
  RiskAssessmentDetailDTO,
  StopWorkDetailDTO,
  ToolboxDetailDTO,
} from "@/lib/modules/hse/hse.types";

/**
 * The HSE lifecycle controls (PRD #22 §313–§323).
 *
 * One rule shapes every one of these panels: **a control that is certain to
 * fail is not shown**. The approve button is absent for whoever submitted, the
 * verify button is absent for whoever completed the work, and the release
 * button is absent while a critical action is still outstanding (PRD #22 §122,
 * §174, §182). The services refuse those acts independently — the page is a
 * courtesy, not the guard.
 *
 * Where a control is withheld for separation of duties, the panel says so,
 * rather than leaving somebody staring at a record wondering what is wrong with
 * their permissions.
 */

function useRunner() {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = React.useTransition();

  function run(
    work: () => Promise<HseActionResult>,
    success: string,
    onDone?: () => void,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      startTransition(async () => {
        let result: HseActionResult;
        try {
          result = await work();
        } catch {
          // Sent, unanswered: it may have committed, so it is not called a
          // failure, and the dialog keeps what was typed (AUD-03 §6).
          toast({ title: OUTCOME_COPY.unknown, tone: "danger" });
          resolve(false);
          return;
        }
        if (result.ok) {
          toast({ title: result.message ?? success, tone: "success" });
          onDone?.();
          router.refresh();
          resolve(true);
        } else {
          toast({ title: result.error, tone: "danger" });
          resolve(false);
        }
      });
    });
  }

  return { run, pending };
}

function SelfApprovalNote({ show, what }: { show: boolean; what: string }) {
  if (!show) return null;
  return (
    <p className="text-meta text-fg-subtle">
      You {what}, so somebody else signs it off.
    </p>
  );
}

/* -------------------------------------------------------------------------- */
/* Inspection                                                                  */
/* -------------------------------------------------------------------------- */

export function InspectionActions({ inspection }: { inspection: InspectionDetailDTO }) {
  const { run, pending } = useRunner();
  const [dialog, setDialog] = React.useState<"reject" | "close" | "cancel" | null>(null);
  const may = inspection.capabilities;

  const awaitingDecision = inspection.status === "PENDING_APPROVAL";
  const withheld = awaitingDecision && !may.canApprove && !may.canReject;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {may.canStart ? (
        <Button
          onClick={() => run(() => startInspectionAction(inspection.id), "Inspection started.")}
          disabled={pending}
        >
          {inspection.status === "REJECTED" ? "Pick it back up" : "Start inspection"}
        </Button>
      ) : null}

      {may.canExecute ? (
        <Button asChild variant="secondary">
          <Link href={`/hse/inspections/${inspection.id}/execute`}>Answer the checklist</Link>
        </Button>
      ) : null}

      {may.canSubmit ? (
        <Button asChild>
          <Link href={`/hse/inspections/${inspection.id}/execute#submit`}>Submit</Link>
        </Button>
      ) : null}

      {may.canApprove ? (
        <Button
          onClick={() => run(() => approveInspectionAction(inspection.id, ""), "Approved.")}
          disabled={pending}
        >
          Approve
        </Button>
      ) : null}

      {may.canReject ? (
        <Button variant="secondary" onClick={() => setDialog("reject")} disabled={pending}>
          Send back
        </Button>
      ) : null}

      {may.canClose ? (
        <Button variant="secondary" onClick={() => setDialog("close")} disabled={pending}>
          Close out
        </Button>
      ) : null}

      {may.canCancel ? (
        <Button variant="ghost" onClick={() => setDialog("cancel")} disabled={pending}>
          Cancel
        </Button>
      ) : null}

      <SelfApprovalNote show={withheld} what="submitted this inspection" />

      <RejectDialog
        open={dialog === "reject"}
        onOpenChange={(open) => setDialog(open ? "reject" : null)}
        title="Send this inspection back"
        label="What needs redoing"
        placeholder="Which checks need looking at again?"
        confirmLabel="Send back"
        pendingLabel="Sending…"
        onReject={(reason) =>
          run(() => rejectInspectionAction(inspection.id, reason), "Sent back.", () =>
            setDialog(null),
          )
        }
      />

      <RejectDialog
        open={dialog === "close"}
        onOpenChange={(open) => setDialog(open ? "close" : null)}
        title="Close this inspection out"
        // A FAIL or CONDITIONAL needs a hazard, an action or a written
        // disposition before it closes (PRD #22 §55).
        description={
          inspection.result === "PASS"
            ? "A passed inspection closes on its own."
            : "This inspection did not pass. Say how the findings were dealt with, unless a hazard or action already covers them."
        }
        label="Disposition"
        placeholder="How were the findings dealt with?"
        confirmLabel="Close out"
        pendingLabel="Closing…"
        emptyMessage="Say how the findings were dealt with."
        onReject={(note) =>
          run(() => closeInspectionAction(inspection.id, note), "Closed.", () => setDialog(null))
        }
      />

      <RejectDialog
        open={dialog === "cancel"}
        onOpenChange={(open) => setDialog(open ? "cancel" : null)}
        title="Cancel this inspection"
        description="For a duplicate or one raised in error."
        label="Reason"
        confirmLabel="Cancel inspection"
        pendingLabel="Cancelling…"
        onReject={(reason) =>
          run(() => cancelInspectionAction(inspection.id, reason), "Cancelled.", () =>
            setDialog(null),
          )
        }
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Hazard                                                                      */
/* -------------------------------------------------------------------------- */

export function HazardActions({ hazard }: { hazard: HazardDetailDTO }) {
  const { run, pending } = useRunner();
  const [dialog, setDialog] = React.useState<"reopen" | "cancel" | null>(null);
  const may = hazard.capabilities;

  // Offered only when it would actually succeed. What is missing is listed on
  // the page itself (PRD #22 §73).
  const closable = may.canClose && hazard.closureGaps.length === 0;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {may.canAssess ? (
        <Button asChild variant="secondary">
          <Link href={`/hse/hazards/${hazard.id}/assess`}>Reassess risk</Link>
        </Button>
      ) : null}

      {may.canControl ? (
        <Button asChild variant="secondary">
          <Link href={`/hse/hazards/${hazard.id}/control`}>Record a control</Link>
        </Button>
      ) : null}

      {may.canRaiseAction ? (
        <Button asChild variant="secondary">
          <Link href={`/hse/actions/new?hazardId=${hazard.id}`}>Raise an action</Link>
        </Button>
      ) : null}

      {may.canStopWork ? (
        <Button asChild variant="danger">
          <Link href={`/hse/stop-work/new?hazardId=${hazard.id}`}>Stop work</Link>
        </Button>
      ) : null}

      {closable ? (
        <Button asChild>
          <Link href={`/hse/hazards/${hazard.id}/close`}>Close hazard</Link>
        </Button>
      ) : null}

      {may.canReopen ? (
        <Button variant="secondary" onClick={() => setDialog("reopen")} disabled={pending}>
          Reopen
        </Button>
      ) : null}

      {may.canCancel ? (
        <Button variant="ghost" onClick={() => setDialog("cancel")} disabled={pending}>
          Cancel
        </Button>
      ) : null}

      <RejectDialog
        open={dialog === "reopen"}
        onOpenChange={(open) => setDialog(open ? "reopen" : null)}
        title="Reopen this hazard"
        description="The control did not hold, or the hazard is back."
        label="Reason"
        confirmLabel="Reopen"
        pendingLabel="Reopening…"
        onReject={(reason) =>
          run(() => reopenHazardAction(hazard.id, reason), "Reopened.", () => setDialog(null))
        }
      />

      <RejectDialog
        open={dialog === "cancel"}
        onOpenChange={(open) => setDialog(open ? "cancel" : null)}
        title="Cancel this hazard"
        description="For a duplicate or one reported in error. It is never deleted."
        label="Reason"
        confirmLabel="Cancel hazard"
        pendingLabel="Cancelling…"
        onReject={(reason) =>
          run(() => cancelHazardAction(hazard.id, reason), "Cancelled.", () => setDialog(null))
        }
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Incident                                                                    */
/* -------------------------------------------------------------------------- */

export function IncidentActions({ incident }: { incident: IncidentDetailDTO }) {
  const { run, pending } = useRunner();
  const [dialog, setDialog] = React.useState<
    "submit-close" | "reopen" | "cancel" | null
  >(null);
  const may = incident.capabilities;

  const readyToSubmit = may.canSubmitClose && incident.closureGaps.length === 0;
  const withheld = incident.status === "PENDING_CLOSE" && !may.canClose;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {may.canInvestigate && incident.status !== "UNDER_INVESTIGATION" ? (
        <Button
          onClick={() =>
            run(() => startInvestigationAction(incident.id), "Investigation opened.")
          }
          disabled={pending}
        >
          Investigate
        </Button>
      ) : null}

      {may.canInvestigate ? (
        <Button asChild variant="secondary">
          <Link href={`/hse/incidents/${incident.id}/investigation`}>Investigation</Link>
        </Button>
      ) : null}

      {may.canRaiseAction ? (
        <Button asChild variant="secondary">
          <Link href={`/hse/actions/new?incidentId=${incident.id}`}>Raise an action</Link>
        </Button>
      ) : null}

      {may.canStopWork ? (
        <Button asChild variant="danger">
          <Link href={`/hse/stop-work/new?incidentId=${incident.id}`}>Stop work</Link>
        </Button>
      ) : null}

      {readyToSubmit ? (
        <Button onClick={() => setDialog("submit-close")} disabled={pending}>
          Put up for closure
        </Button>
      ) : null}

      {may.canClose ? (
        <Button
          onClick={() => run(() => closeIncidentAction(incident.id, ""), "Incident closed.")}
          disabled={pending}
        >
          Close incident
        </Button>
      ) : null}

      {may.canReopen ? (
        <Button variant="secondary" onClick={() => setDialog("reopen")} disabled={pending}>
          Reopen
        </Button>
      ) : null}

      {may.canCancel ? (
        <Button variant="ghost" onClick={() => setDialog("cancel")} disabled={pending}>
          Cancel
        </Button>
      ) : null}

      <SelfApprovalNote show={withheld} what="put this up for closure" />

      <RejectDialog
        open={dialog === "submit-close"}
        onOpenChange={(open) => setDialog(open ? "submit-close" : null)}
        title="Put this incident up for closure"
        description="Somebody else decides. Whoever investigated an incident is the last person who should declare it finished."
        label="Closure note"
        placeholder="What was concluded, and what was done about it?"
        confirmLabel="Put up for closure"
        pendingLabel="Sending…"
        emptyMessage="Write a closure note."
        onReject={(note) =>
          run(() => submitIncidentCloseAction(incident.id, note), "Sent for closure.", () =>
            setDialog(null),
          )
        }
      />

      <RejectDialog
        open={dialog === "reopen"}
        onOpenChange={(open) => setDialog(open ? "reopen" : null)}
        title="Reopen this incident"
        label="Reason"
        confirmLabel="Reopen"
        pendingLabel="Reopening…"
        onReject={(reason) =>
          run(() => reopenIncidentAction(incident.id, reason), "Reopened.", () =>
            setDialog(null),
          )
        }
      />

      <RejectDialog
        open={dialog === "cancel"}
        onOpenChange={(open) => setDialog(open ? "cancel" : null)}
        title="Cancel this incident"
        description="For a duplicate or one reported in error. It is never deleted."
        label="Reason"
        confirmLabel="Cancel incident"
        pendingLabel="Cancelling…"
        onReject={(reason) =>
          run(() => cancelIncidentAction(incident.id, reason), "Cancelled.", () =>
            setDialog(null),
          )
        }
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Risk assessment                                                             */
/* -------------------------------------------------------------------------- */

export function RiskAssessmentActions({
  assessment,
}: {
  assessment: RiskAssessmentDetailDTO;
}) {
  const { run, pending } = useRunner();
  const [dialog, setDialog] = React.useState<"reject" | null>(null);
  const may = assessment.capabilities;

  const withheld =
    assessment.status === "PENDING_APPROVAL" && !may.canApprove && !may.canReject;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {may.canEdit ? (
        <Button asChild variant="secondary">
          <Link href={`/hse/risk-assessments/${assessment.id}/edit`}>Edit</Link>
        </Button>
      ) : null}

      {/* An approved assessment is frozen; editing creates version n+1 (§112). */}
      {!may.canEdit && may.canVersion ? (
        <Button asChild variant="secondary">
          <Link href={`/hse/risk-assessments/${assessment.id}/edit`}>
            New version (v{assessment.version + 1})
          </Link>
        </Button>
      ) : null}

      {may.canSubmit ? (
        <Button
          onClick={() =>
            run(() => submitRiskAssessmentAction(assessment.id), "Sent for approval.")
          }
          disabled={pending}
        >
          Send for approval
        </Button>
      ) : null}

      {may.canApprove ? (
        <Button
          onClick={() =>
            run(() => approveRiskAssessmentAction(assessment.id, ""), "Approved.")
          }
          disabled={pending}
        >
          Approve
        </Button>
      ) : null}

      {may.canReject ? (
        <Button variant="secondary" onClick={() => setDialog("reject")} disabled={pending}>
          Send back
        </Button>
      ) : null}

      {may.canArchive ? (
        <Button
          variant="ghost"
          onClick={() => run(() => archiveRiskAssessmentAction(assessment.id), "Archived.")}
          disabled={pending}
        >
          Archive
        </Button>
      ) : null}

      <SelfApprovalNote show={withheld} what="submitted this assessment" />

      <RejectDialog
        open={dialog === "reject"}
        onOpenChange={(open) => setDialog(open ? "reject" : null)}
        title="Send this assessment back"
        label="What needs changing"
        confirmLabel="Send back"
        pendingLabel="Sending…"
        onReject={(reason) =>
          run(
            () => rejectRiskAssessmentAction(assessment.id, reason),
            "Sent back.",
            () => setDialog(null),
          )
        }
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* HSE action                                                                  */
/* -------------------------------------------------------------------------- */

export function HseActionActions({ action }: { action: ActionDetailDTO }) {
  const { run, pending } = useRunner();
  const [dialog, setDialog] = React.useState<
    "complete" | "verify" | "reject" | "reopen" | "cancel" | null
  >(null);
  const may = action.capabilities;

  const withheld = action.status === "PENDING_VERIFICATION" && !may.canVerify;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {may.canComplete ? (
        <Button onClick={() => setDialog("complete")} disabled={pending}>
          Mark done
        </Button>
      ) : null}

      {may.canVerify ? (
        <Button onClick={() => setDialog("verify")} disabled={pending}>
          Verify
        </Button>
      ) : null}

      {may.canReject ? (
        <Button variant="secondary" onClick={() => setDialog("reject")} disabled={pending}>
          Send back
        </Button>
      ) : null}

      {may.canCreateTask ? (
        <Button asChild variant="secondary">
          <Link href={`/hse/actions/${action.id}/task`}>Create a task</Link>
        </Button>
      ) : null}

      {may.canReopen ? (
        <Button variant="secondary" onClick={() => setDialog("reopen")} disabled={pending}>
          Reopen
        </Button>
      ) : null}

      {may.canCancel ? (
        <Button variant="ghost" onClick={() => setDialog("cancel")} disabled={pending}>
          Cancel
        </Button>
      ) : null}

      <SelfApprovalNote show={withheld} what="completed this action" />

      <RejectDialog
        open={dialog === "complete"}
        onOpenChange={(open) => setDialog(open ? "complete" : null)}
        title="Mark this action done"
        description="Somebody else verifies it. That is the whole point of the two states."
        label="What you did"
        placeholder="What control went in, and where?"
        confirmLabel="Mark done"
        pendingLabel="Saving…"
        emptyMessage="Record what was actually done."
        onReject={(note) =>
          run(() => completeHseActionAction(action.id, note), "Marked done.", () =>
            setDialog(null),
          )
        }
      />

      <RejectDialog
        open={dialog === "verify"}
        onOpenChange={(open) => setDialog(open ? "verify" : null)}
        title="Verify this action"
        description="You are confirming the control is genuinely in place."
        label="Verification note"
        placeholder="Optional — what you checked."
        confirmLabel="Verify"
        pendingLabel="Verifying…"
        emptyMessage=""
        onReject={(note) =>
          run(() => verifyHseActionAction(action.id, note), "Verified.", () => setDialog(null))
        }
      />

      <RejectDialog
        open={dialog === "reject"}
        onOpenChange={(open) => setDialog(open ? "reject" : null)}
        title="Send this action back"
        label="What is still wrong"
        confirmLabel="Send back"
        pendingLabel="Sending…"
        onReject={(note) =>
          run(() => rejectHseActionAction(action.id, note), "Sent back.", () => setDialog(null))
        }
      />

      <RejectDialog
        open={dialog === "reopen"}
        onOpenChange={(open) => setDialog(open ? "reopen" : null)}
        title="Reopen this action"
        description="The correction did not hold."
        label="Reason"
        confirmLabel="Reopen"
        pendingLabel="Reopening…"
        onReject={(reason) =>
          run(() => reopenHseActionAction(action.id, reason), "Reopened.", () =>
            setDialog(null),
          )
        }
      />

      <RejectDialog
        open={dialog === "cancel"}
        onOpenChange={(open) => setDialog(open ? "cancel" : null)}
        title="Cancel this action"
        description="Only if it no longer applies."
        label="Reason"
        confirmLabel="Cancel action"
        pendingLabel="Cancelling…"
        onReject={(reason) =>
          run(() => cancelHseActionAction(action.id, reason), "Cancelled.", () =>
            setDialog(null),
          )
        }
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Permit                                                                      */
/* -------------------------------------------------------------------------- */

export function PermitActions({ permit }: { permit: PermitDetailDTO }) {
  const { run, pending } = useRunner();
  const [dialog, setDialog] = React.useState<"reject" | "suspend" | "cancel" | null>(null);
  const [confirm, setConfirm] = React.useState<"activate" | "close" | null>(null);
  const may = permit.capabilities;

  const withheld =
    permit.status === "PENDING_APPROVAL" && !may.canApprove && !may.canReject;

  // Approved but outside its window: activating would authorise work the permit
  // does not cover (PRD #22 §150).
  const outsideWindow =
    permit.status === "APPROVED" && !may.canActivate && permit.hoursRemaining < 0;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {may.canSubmit ? (
        <Button
          onClick={() => run(() => submitPermitAction(permit.id), "Sent for approval.")}
          disabled={pending}
        >
          Send for approval
        </Button>
      ) : null}

      {may.canApprove ? (
        <Button
          onClick={() => run(() => approvePermitAction(permit.id, ""), "Approved.")}
          disabled={pending}
        >
          Approve
        </Button>
      ) : null}

      {may.canReject ? (
        <Button variant="secondary" onClick={() => setDialog("reject")} disabled={pending}>
          Refuse
        </Button>
      ) : null}

      {may.canActivate ? (
        <Button onClick={() => setConfirm("activate")} disabled={pending}>
          {permit.status === "SUSPENDED" ? "Reactivate" : "Activate"}
        </Button>
      ) : null}

      {may.canSuspend ? (
        <Button variant="secondary" onClick={() => setDialog("suspend")} disabled={pending}>
          Suspend
        </Button>
      ) : null}

      {may.canClose ? (
        <Button variant="secondary" onClick={() => setConfirm("close")} disabled={pending}>
          Close
        </Button>
      ) : null}

      {may.canCancel ? (
        <Button variant="ghost" onClick={() => setDialog("cancel")} disabled={pending}>
          Cancel
        </Button>
      ) : null}

      <SelfApprovalNote show={withheld} what="raised this permit" />

      {outsideWindow ? (
        <p className="text-meta text-danger-strong">
          This permit is outside the window it authorises. Close it and raise a new one.
        </p>
      ) : null}

      <ConfirmDialog
        open={confirm === "activate"}
        onOpenChange={(open) => setConfirm(open ? "activate" : null)}
        title="Activate this permit"
        description="The work it authorises may begin, within the validity window and under the controls recorded."
        confirmLabel="Activate"
        onConfirm={async () => {
          await run(() => activatePermitAction(permit.id), "Permit active.");
          setConfirm(null);
        }}
      />

      <ConfirmDialog
        open={confirm === "close"}
        onOpenChange={(open) => setConfirm(open ? "close" : null)}
        title="Close this permit"
        description="The work is finished. A closed permit authorises nothing."
        confirmLabel="Close permit"
        onConfirm={async () => {
          await run(() => closePermitAction(permit.id), "Permit closed.");
          setConfirm(null);
        }}
      />

      <RejectDialog
        open={dialog === "reject"}
        onOpenChange={(open) => setDialog(open ? "reject" : null)}
        title="Refuse this permit"
        label="Why"
        confirmLabel="Refuse"
        pendingLabel="Refusing…"
        onReject={(reason) =>
          run(() => rejectPermitAction(permit.id, reason), "Sent back.", () => setDialog(null))
        }
      />

      <RejectDialog
        open={dialog === "suspend"}
        onOpenChange={(open) => setDialog(open ? "suspend" : null)}
        title="Suspend this permit"
        description="Work under it stops until it is reactivated."
        label="Why"
        confirmLabel="Suspend"
        pendingLabel="Suspending…"
        onReject={(reason) =>
          run(() => suspendPermitAction(permit.id, reason), "Suspended.", () =>
            setDialog(null),
          )
        }
      />

      <RejectDialog
        open={dialog === "cancel"}
        onOpenChange={(open) => setDialog(open ? "cancel" : null)}
        title="Cancel this permit"
        label="Reason"
        confirmLabel="Cancel permit"
        pendingLabel="Cancelling…"
        onReject={(reason) =>
          run(() => cancelPermitAction(permit.id, reason), "Cancelled.", () => setDialog(null))
        }
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Toolbox talk                                                                */
/* -------------------------------------------------------------------------- */

export function ToolboxActions({ talk }: { talk: ToolboxDetailDTO }) {
  const { run, pending } = useRunner();
  const [dialog, setDialog] = React.useState<"cancel" | null>(null);
  const [confirm, setConfirm] = React.useState(false);
  const may = talk.capabilities;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {may.canEdit ? (
        <Button asChild variant="secondary">
          <Link href={`/hse/toolbox-talks/${talk.id}/edit`}>Edit</Link>
        </Button>
      ) : null}

      {may.canComplete ? (
        <Button onClick={() => setConfirm(true)} disabled={pending}>
          Complete
        </Button>
      ) : null}

      {may.canCancel ? (
        <Button variant="ghost" onClick={() => setDialog("cancel")} disabled={pending}>
          Cancel
        </Button>
      ) : null}

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Complete this toolbox talk"
        description="The attendance list is fixed once it is completed."
        confirmLabel="Complete"
        onConfirm={async () => {
          await run(() => completeToolboxTalkAction(talk.id), "Completed.");
          setConfirm(false);
        }}
      />

      <RejectDialog
        open={dialog === "cancel"}
        onOpenChange={(open) => setDialog(open ? "cancel" : null)}
        title="Cancel this toolbox talk"
        label="Reason"
        confirmLabel="Cancel talk"
        pendingLabel="Cancelling…"
        onReject={(reason) =>
          run(() => cancelToolboxTalkAction(talk.id, reason), "Cancelled.", () =>
            setDialog(null),
          )
        }
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Environmental observation                                                   */
/* -------------------------------------------------------------------------- */

export function ObservationActions({ observation }: { observation: ObservationDetailDTO }) {
  const { run, pending } = useRunner();
  const [dialog, setDialog] = React.useState<"close" | "reopen" | null>(null);
  const may = observation.capabilities;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {may.canEdit ? (
        <Button asChild variant="secondary">
          <Link href={`/hse/environment/${observation.id}/edit`}>Edit</Link>
        </Button>
      ) : null}

      {may.canRaiseAction ? (
        <Button asChild variant="secondary">
          <Link href={`/hse/actions/new?environmentalObservationId=${observation.id}`}>
            Raise an action
          </Link>
        </Button>
      ) : null}

      {may.canClose ? (
        <Button onClick={() => setDialog("close")} disabled={pending}>
          Close out
        </Button>
      ) : null}

      {may.canReopen ? (
        <Button variant="secondary" onClick={() => setDialog("reopen")} disabled={pending}>
          Reopen
        </Button>
      ) : null}

      <RejectDialog
        open={dialog === "close"}
        onOpenChange={(open) => setDialog(open ? "close" : null)}
        title="Close this observation"
        description="Every action raised against it has to be verified first."
        label="Closure note"
        confirmLabel="Close"
        pendingLabel="Closing…"
        emptyMessage="Write a closure note."
        onReject={(note) =>
          run(() => closeObservationAction(observation.id, note), "Closed.", () =>
            setDialog(null),
          )
        }
      />

      <RejectDialog
        open={dialog === "reopen"}
        onOpenChange={(open) => setDialog(open ? "reopen" : null)}
        title="Reopen this observation"
        label="Reason"
        confirmLabel="Reopen"
        pendingLabel="Reopening…"
        onReject={(reason) =>
          run(() => reopenObservationAction(observation.id, reason), "Reopened.", () =>
            setDialog(null),
          )
        }
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Stop work                                                                   */
/* -------------------------------------------------------------------------- */

export function StopWorkActions({ record }: { record: StopWorkDetailDTO }) {
  const { run, pending } = useRunner();
  const [dialog, setDialog] = React.useState<"release" | "cancel" | null>(null);
  const may = record.capabilities;

  // Blocked while a critical action against it is still outstanding
  // (PRD #22 §174).
  const blocked = record.status === "ACTIVE" && !may.canRelease && record.releaseGaps.length > 0;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {may.canRaiseAction ? (
        <Button asChild variant="secondary">
          <Link href={`/hse/actions/new?stopWorkId=${record.id}`}>Raise an action</Link>
        </Button>
      ) : null}

      {may.canRelease ? (
        <Button onClick={() => setDialog("release")} disabled={pending}>
          Release work
        </Button>
      ) : null}

      {may.canCancel ? (
        <Button variant="ghost" onClick={() => setDialog("cancel")} disabled={pending}>
          Cancel
        </Button>
      ) : null}

      {blocked ? (
        <p className="text-meta text-warning-strong">
          This cannot be released while a critical action against it is unverified.
        </p>
      ) : null}

      <RejectDialog
        open={dialog === "release"}
        onOpenChange={(open) => setDialog(open ? "release" : null)}
        title="Release this stop-work"
        description="People go back to the job. Say what changed."
        label="Why it is safe to resume"
        confirmLabel="Release"
        pendingLabel="Releasing…"
        emptyMessage="Say why it is safe to resume."
        onReject={(reason) =>
          run(() => releaseStopWorkAction(record.id, reason), "Work released.", () =>
            setDialog(null),
          )
        }
      />

      <RejectDialog
        open={dialog === "cancel"}
        onOpenChange={(open) => setDialog(open ? "cancel" : null)}
        title="Cancel this stop-work"
        description="For one issued in error. Use release when the job is genuinely safe again."
        label="Reason"
        confirmLabel="Cancel stop-work"
        pendingLabel="Cancelling…"
        onReject={(reason) =>
          run(() => cancelStopWorkAction(record.id, reason), "Cancelled.", () =>
            setDialog(null),
          )
        }
      />
    </div>
  );
}
