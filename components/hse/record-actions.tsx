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
import type { PendingCycle } from "@/lib/core/approvals/approval-guard";
import { useHseServerText, useHseTranslations } from "@/components/hse/hse-text";

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
  const serverText = useHseServerText();
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
          toast({ title: serverText(result.message) ?? success, tone: "success" });
          onDone?.();
          router.refresh();
          resolve(true);
        } else {
          toast({ title: serverText(result.error) ?? result.error, tone: "danger" });
          resolve(false);
        }
      });
    });
  }

  return { run, pending };
}

function SelfApprovalNote({ show, what }: { show: boolean; what: "inspection" | "closure" | "assessment" | "action" | "permit" }) {
  const t = useHseTranslations();
  if (!show) return null;
  return (
    <p className="text-meta text-fg-subtle">
      {t(`actions.selfApproval.${what}`)}
    </p>
  );
}

/* -------------------------------------------------------------------------- */
/* Inspection                                                                  */
/* -------------------------------------------------------------------------- */

export function InspectionActions({
  inspection,
  cycle,
}: {
  inspection: InspectionDetailDTO;
  /** The approval cycle on screen; its decision controls name it back (AUD-10 §4, CW-05). */
  cycle: PendingCycle | null;
}) {
  const t = useHseTranslations();
  const { run, pending } = useRunner();
  const [dialog, setDialog] = React.useState<"reject" | "close" | "cancel" | null>(null);
  const may = inspection.capabilities;

  const awaitingDecision = inspection.status === "PENDING_APPROVAL";
  const withheld = awaitingDecision && !may.canApprove && !may.canReject;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {may.canStart ? (
        <Button
          onClick={() => run(() => startInspectionAction(inspection.id), t("actions.inspectionStarted"))}
          disabled={pending}
        >
          {inspection.status === "REJECTED" ? t("actions.pickBackUp") : t("actions.startInspection")}
        </Button>
      ) : null}

      {may.canExecute ? (
        <Button asChild variant="secondary">
          <Link href={`/hse/inspections/${inspection.id}/execute`}>{t("actions.answerChecklist")}</Link>
        </Button>
      ) : null}

      {may.canSubmit ? (
        <Button asChild>
          <Link href={`/hse/inspections/${inspection.id}/execute#submit`}>{t("actions.submit")}</Link>
        </Button>
      ) : null}

      {may.canApprove ? (
        <Button
          onClick={() => run(() => approveInspectionAction(inspection.id, "", cycle), t("actions.approved"))}
          disabled={pending}
        >
          {t("actions.approve")}
        </Button>
      ) : null}

      {may.canReject ? (
        <Button variant="secondary" onClick={() => setDialog("reject")} disabled={pending}>
          {t("actions.sendBack")}
        </Button>
      ) : null}

      {may.canClose ? (
        <Button variant="secondary" onClick={() => setDialog("close")} disabled={pending}>
          {t("actions.closeOut")}
        </Button>
      ) : null}

      {may.canCancel ? (
        <Button variant="ghost" onClick={() => setDialog("cancel")} disabled={pending}>
          {t("actions.cancel")}
        </Button>
      ) : null}

      <SelfApprovalNote show={withheld} what="inspection" />

      <RejectDialog
        open={dialog === "reject"}
        onOpenChange={(open) => setDialog(open ? "reject" : null)}
        title={t("actions.sendInspectionBack")}
        label={t("actions.whatNeedsRedoing")}
        placeholder={t("actions.whichChecks")}
        confirmLabel={t("actions.sendBack")}
        pendingLabel={t("actions.sending")}
        onReject={(reason) =>
          run(() => rejectInspectionAction(inspection.id, reason, cycle), t("actions.sentBack"), () =>
            setDialog(null),
          )
        }
      />

      <RejectDialog
        open={dialog === "close"}
        onOpenChange={(open) => setDialog(open ? "close" : null)}
        title={t("actions.closeInspectionOut")}
        // A FAIL or CONDITIONAL needs a hazard, an action or a written
        // disposition before it closes (PRD #22 §55).
        description={
          inspection.result === "PASS"
            ? t("actions.passedClosesOwn")
            : t("actions.notPassed")
        }
        label={t("actions.disposition")}
        placeholder={t("actions.howDealt")}
        confirmLabel={t("actions.closeOut")}
        pendingLabel={t("actions.closing")}
        emptyMessage={t("actions.sayHowDealt")}
        onReject={(note) =>
          run(() => closeInspectionAction(inspection.id, note), t("actions.closed"), () => setDialog(null))
        }
      />

      <RejectDialog
        open={dialog === "cancel"}
        onOpenChange={(open) => setDialog(open ? "cancel" : null)}
        title={t("actions.cancelInspectionTitle")}
        description={t("actions.duplicateOrError")}
        label={t("actions.reason")}
        confirmLabel={t("actions.cancelInspection")}
        pendingLabel={t("actions.cancelling")}
        onReject={(reason) =>
          run(() => cancelInspectionAction(inspection.id, reason), t("actions.cancelled"), () =>
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
  const t = useHseTranslations();
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
          <Link href={`/hse/hazards/${hazard.id}/assess`}>{t("page.reassessRisk")}</Link>
        </Button>
      ) : null}

      {may.canControl ? (
        <Button asChild variant="secondary">
          <Link href={`/hse/hazards/${hazard.id}/control`}>{t("page.recordControl")}</Link>
        </Button>
      ) : null}

      {may.canRaiseAction ? (
        <Button asChild variant="secondary">
          <Link href={`/hse/actions/new?hazardId=${hazard.id}`}>{t("actions.raiseAction")}</Link>
        </Button>
      ) : null}

      {may.canStopWork ? (
        <Button asChild variant="danger">
          <Link href={`/hse/stop-work/new?hazardId=${hazard.id}`}>{t("pages.stopWork.title")}</Link>
        </Button>
      ) : null}

      {closable ? (
        <Button asChild>
          <Link href={`/hse/hazards/${hazard.id}/close`}>{t("page.closeHazard")}</Link>
        </Button>
      ) : null}

      {may.canReopen ? (
        <Button variant="secondary" onClick={() => setDialog("reopen")} disabled={pending}>
          {t("actions.reopen")}
        </Button>
      ) : null}

      {may.canCancel ? (
        <Button variant="ghost" onClick={() => setDialog("cancel")} disabled={pending}>
          {t("actions.cancel")}
        </Button>
      ) : null}

      <RejectDialog
        open={dialog === "reopen"}
        onOpenChange={(open) => setDialog(open ? "reopen" : null)}
        title={t("actions.reopenHazardTitle")}
        description={t("actions.reopenHazardDesc")}
        label={t("actions.reason")}
        confirmLabel={t("actions.reopen")}
        pendingLabel={t("actions.reopening")}
        onReject={(reason) =>
          run(() => reopenHazardAction(hazard.id, reason), t("actions.reopened"), () => setDialog(null))
        }
      />

      <RejectDialog
        open={dialog === "cancel"}
        onOpenChange={(open) => setDialog(open ? "cancel" : null)}
        title={t("actions.cancelHazardTitle")}
        description={t("actions.reportedInError")}
        label={t("actions.reason")}
        confirmLabel={t("actions.cancelHazard")}
        pendingLabel={t("actions.cancelling")}
        onReject={(reason) =>
          run(() => cancelHazardAction(hazard.id, reason), t("actions.cancelled"), () => setDialog(null))
        }
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Incident                                                                    */
/* -------------------------------------------------------------------------- */

export function IncidentActions({
  incident,
  cycle,
}: {
  incident: IncidentDetailDTO;
  /** The approval cycle on screen; its decision controls name it back (AUD-10 §4, CW-05). */
  cycle: PendingCycle | null;
}) {
  const t = useHseTranslations();
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
            run(() => startInvestigationAction(incident.id), t("actions.investigationOpened"))
          }
          disabled={pending}
        >
          {t("actions.investigate")}
        </Button>
      ) : null}

      {may.canInvestigate ? (
        <Button asChild variant="secondary">
          <Link href={`/hse/incidents/${incident.id}/investigation`}>{t("incident.detail.investigation")}</Link>
        </Button>
      ) : null}

      {may.canRaiseAction ? (
        <Button asChild variant="secondary">
          <Link href={`/hse/actions/new?incidentId=${incident.id}`}>{t("actions.raiseAction")}</Link>
        </Button>
      ) : null}

      {may.canStopWork ? (
        <Button asChild variant="danger">
          <Link href={`/hse/stop-work/new?incidentId=${incident.id}`}>{t("pages.stopWork.title")}</Link>
        </Button>
      ) : null}

      {readyToSubmit ? (
        <Button onClick={() => setDialog("submit-close")} disabled={pending}>
          {t("incident.detail.putUpForClosure")}
        </Button>
      ) : null}

      {may.canClose ? (
        <Button
          onClick={() => run(() => closeIncidentAction(incident.id, "", cycle), t("actions.incidentClosed"))}
          disabled={pending}
        >
          {t("actions.closeIncident")}
        </Button>
      ) : null}

      {may.canReopen ? (
        <Button variant="secondary" onClick={() => setDialog("reopen")} disabled={pending}>
          {t("actions.reopen")}
        </Button>
      ) : null}

      {may.canCancel ? (
        <Button variant="ghost" onClick={() => setDialog("cancel")} disabled={pending}>
          {t("actions.cancel")}
        </Button>
      ) : null}

      <SelfApprovalNote show={withheld} what="closure" />

      <RejectDialog
        open={dialog === "submit-close"}
        onOpenChange={(open) => setDialog(open ? "submit-close" : null)}
        title={t("actions.putIncidentUp")}
        description={t("actions.somebodyElseDecides")}
        label={t("record.closureNote")}
        placeholder={t("actions.whatConcluded")}
        confirmLabel={t("incident.detail.putUpForClosure")}
        pendingLabel={t("actions.sending")}
        emptyMessage={t("actions.writeClosureNote")}
        onReject={(note) =>
          run(() => submitIncidentCloseAction(incident.id, note), t("actions.sentForClosure"), () =>
            setDialog(null),
          )
        }
      />

      <RejectDialog
        open={dialog === "reopen"}
        onOpenChange={(open) => setDialog(open ? "reopen" : null)}
        title={t("actions.reopenIncidentTitle")}
        label={t("actions.reason")}
        confirmLabel={t("actions.reopen")}
        pendingLabel={t("actions.reopening")}
        onReject={(reason) =>
          run(() => reopenIncidentAction(incident.id, reason), t("actions.reopened"), () =>
            setDialog(null),
          )
        }
      />

      <RejectDialog
        open={dialog === "cancel"}
        onOpenChange={(open) => setDialog(open ? "cancel" : null)}
        title={t("actions.cancelIncidentTitle")}
        description={t("actions.reportedInError")}
        label={t("actions.reason")}
        confirmLabel={t("actions.cancelIncident")}
        pendingLabel={t("actions.cancelling")}
        onReject={(reason) =>
          run(() => cancelIncidentAction(incident.id, reason), t("actions.cancelled"), () =>
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
  cycle,
}: {
  assessment: RiskAssessmentDetailDTO;
  /** The approval cycle on screen; its decision controls name it back (AUD-10 §4, CW-05). */
  cycle: PendingCycle | null;
}) {
  const t = useHseTranslations();
  const { run, pending } = useRunner();
  const [dialog, setDialog] = React.useState<"reject" | null>(null);
  const may = assessment.capabilities;

  const withheld =
    assessment.status === "PENDING_APPROVAL" && !may.canApprove && !may.canReject;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {may.canEdit ? (
        <Button asChild variant="secondary">
          <Link href={`/hse/risk-assessments/${assessment.id}/edit`}>{t("template.detail.edit")}</Link>
        </Button>
      ) : null}

      {/* An approved assessment is frozen; editing creates version n+1 (§112). */}
      {!may.canEdit && may.canVersion ? (
        <Button asChild variant="secondary">
          <Link href={`/hse/risk-assessments/${assessment.id}/edit`}>
            {t("actions.newVersionNumbered", { version: assessment.version + 1 })}
          </Link>
        </Button>
      ) : null}

      {may.canSubmit ? (
        <Button
          onClick={() =>
            run(() => submitRiskAssessmentAction(assessment.id), t("actions.sentForApproval"))
          }
          disabled={pending}
        >
          {t("actions.sendForApproval")}
        </Button>
      ) : null}

      {may.canApprove ? (
        <Button
          onClick={() =>
            run(() => approveRiskAssessmentAction(assessment.id, "", cycle), t("actions.approved"))
          }
          disabled={pending}
        >
          {t("actions.approve")}
        </Button>
      ) : null}

      {may.canReject ? (
        <Button variant="secondary" onClick={() => setDialog("reject")} disabled={pending}>
          {t("actions.sendBack")}
        </Button>
      ) : null}

      {may.canArchive ? (
        <Button
          variant="ghost"
          onClick={() => run(() => archiveRiskAssessmentAction(assessment.id), t("actions.archived"))}
          disabled={pending}
        >
          {t("actions.archive")}
        </Button>
      ) : null}

      <SelfApprovalNote show={withheld} what="assessment" />

      <RejectDialog
        open={dialog === "reject"}
        onOpenChange={(open) => setDialog(open ? "reject" : null)}
        title={t("actions.sendAssessmentBack")}
        label={t("actions.whatNeedsChanging")}
        confirmLabel={t("actions.sendBack")}
        pendingLabel={t("actions.sending")}
        onReject={(reason) =>
          run(
            () => rejectRiskAssessmentAction(assessment.id, reason, cycle),
            t("actions.sentBack"),
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
  const t = useHseTranslations();
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
          {t("actions.markDone")}
        </Button>
      ) : null}

      {may.canVerify ? (
        <Button onClick={() => setDialog("verify")} disabled={pending}>
          {t("actions.verify")}
        </Button>
      ) : null}

      {may.canReject ? (
        <Button variant="secondary" onClick={() => setDialog("reject")} disabled={pending}>
          {t("actions.sendBack")}
        </Button>
      ) : null}

      {may.canCreateTask ? (
        <Button asChild variant="secondary">
          <Link href={`/hse/actions/${action.id}/task`}>{t("page.createTask")}</Link>
        </Button>
      ) : null}

      {may.canReopen ? (
        <Button variant="secondary" onClick={() => setDialog("reopen")} disabled={pending}>
          {t("actions.reopen")}
        </Button>
      ) : null}

      {may.canCancel ? (
        <Button variant="ghost" onClick={() => setDialog("cancel")} disabled={pending}>
          {t("actions.cancel")}
        </Button>
      ) : null}

      <SelfApprovalNote show={withheld} what="action" />

      <RejectDialog
        open={dialog === "complete"}
        onOpenChange={(open) => setDialog(open ? "complete" : null)}
        title={t("actions.markDoneTitle")}
        description={t("actions.markDoneDesc")}
        label={t("actions.whatYouDid")}
        placeholder={t("actions.whatControl")}
        confirmLabel={t("actions.markDone")}
        pendingLabel={t("page.saving")}
        emptyMessage={t("actions.recordWhatDone")}
        onReject={(note) =>
          run(() => completeHseActionAction(action.id, note), t("actions.markedDone"), () =>
            setDialog(null),
          )
        }
      />

      <RejectDialog
        open={dialog === "verify"}
        onOpenChange={(open) => setDialog(open ? "verify" : null)}
        title={t("actions.verifyTitle")}
        description={t("actions.verifyDesc")}
        label={t("actions.verificationNote")}
        placeholder={t("actions.optionalChecked")}
        confirmLabel={t("actions.verify")}
        pendingLabel={t("actions.verifying")}
        emptyMessage=""
        onReject={(note) =>
          run(() => verifyHseActionAction(action.id, note), t("actions.verified"), () => setDialog(null))
        }
      />

      <RejectDialog
        open={dialog === "reject"}
        onOpenChange={(open) => setDialog(open ? "reject" : null)}
        title={t("actions.sendActionBack")}
        label={t("actions.stillWrong")}
        confirmLabel={t("actions.sendBack")}
        pendingLabel={t("actions.sending")}
        onReject={(note) =>
          run(() => rejectHseActionAction(action.id, note), t("actions.sentBack"), () => setDialog(null))
        }
      />

      <RejectDialog
        open={dialog === "reopen"}
        onOpenChange={(open) => setDialog(open ? "reopen" : null)}
        title={t("actions.reopenActionTitle")}
        description={t("actions.correctionDidNotHold")}
        label={t("actions.reason")}
        confirmLabel={t("actions.reopen")}
        pendingLabel={t("actions.reopening")}
        onReject={(reason) =>
          run(() => reopenHseActionAction(action.id, reason), t("actions.reopened"), () =>
            setDialog(null),
          )
        }
      />

      <RejectDialog
        open={dialog === "cancel"}
        onOpenChange={(open) => setDialog(open ? "cancel" : null)}
        title={t("actions.cancelActionTitle")}
        description={t("actions.noLongerApplies")}
        label={t("actions.reason")}
        confirmLabel={t("actions.cancelAction")}
        pendingLabel={t("actions.cancelling")}
        onReject={(reason) =>
          run(() => cancelHseActionAction(action.id, reason), t("actions.cancelled"), () =>
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

export function PermitActions({
  permit,
  cycle,
}: {
  permit: PermitDetailDTO;
  /** The approval cycle on screen; its decision controls name it back (AUD-10 §4, CW-05). */
  cycle: PendingCycle | null;
}) {
  const t = useHseTranslations();
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
          onClick={() => run(() => submitPermitAction(permit.id), t("actions.sentForApproval"))}
          disabled={pending}
        >
          {t("actions.sendForApproval")}
        </Button>
      ) : null}

      {may.canApprove ? (
        <Button
          onClick={() => run(() => approvePermitAction(permit.id, "", cycle), t("actions.approved"))}
          disabled={pending}
        >
          {t("actions.approve")}
        </Button>
      ) : null}

      {may.canReject ? (
        <Button variant="secondary" onClick={() => setDialog("reject")} disabled={pending}>
          {t("actions.refuse")}
        </Button>
      ) : null}

      {may.canActivate ? (
        <Button onClick={() => setConfirm("activate")} disabled={pending}>
          {permit.status === "SUSPENDED" ? t("actions.reactivate") : t("actions.activate")}
        </Button>
      ) : null}

      {may.canSuspend ? (
        <Button variant="secondary" onClick={() => setDialog("suspend")} disabled={pending}>
          {t("actions.suspend")}
        </Button>
      ) : null}

      {may.canClose ? (
        <Button variant="secondary" onClick={() => setConfirm("close")} disabled={pending}>
          {t("page.crumbClose")}
        </Button>
      ) : null}

      {may.canCancel ? (
        <Button variant="ghost" onClick={() => setDialog("cancel")} disabled={pending}>
          {t("actions.cancel")}
        </Button>
      ) : null}

      <SelfApprovalNote show={withheld} what="permit" />

      {outsideWindow ? (
        <p className="text-meta text-danger-strong">
          {t("actions.outsideWindow")}
        </p>
      ) : null}

      <ConfirmDialog
        open={confirm === "activate"}
        onOpenChange={(open) => setConfirm(open ? "activate" : null)}
        title={t("actions.activateTitle")}
        description={t("actions.activateDesc")}
        confirmLabel={t("actions.activate")}
        onConfirm={async () => {
          await run(() => activatePermitAction(permit.id), t("actions.permitActive"));
          setConfirm(null);
        }}
      />

      <ConfirmDialog
        open={confirm === "close"}
        onOpenChange={(open) => setConfirm(open ? "close" : null)}
        title={t("actions.closePermitTitle")}
        description={t("actions.closePermitDesc")}
        confirmLabel={t("actions.closePermit")}
        onConfirm={async () => {
          await run(() => closePermitAction(permit.id), t("actions.permitClosed"));
          setConfirm(null);
        }}
      />

      <RejectDialog
        open={dialog === "reject"}
        onOpenChange={(open) => setDialog(open ? "reject" : null)}
        title={t("actions.refuseTitle")}
        label={t("forms.why")}
        confirmLabel={t("actions.refuse")}
        pendingLabel={t("actions.refusing")}
        onReject={(reason) =>
          run(() => rejectPermitAction(permit.id, reason, cycle), t("actions.sentBack"), () => setDialog(null))
        }
      />

      <RejectDialog
        open={dialog === "suspend"}
        onOpenChange={(open) => setDialog(open ? "suspend" : null)}
        title={t("actions.suspendTitle")}
        description={t("actions.suspendDesc")}
        label={t("forms.why")}
        confirmLabel={t("actions.suspend")}
        pendingLabel={t("actions.suspending")}
        onReject={(reason) =>
          run(() => suspendPermitAction(permit.id, reason), t("actions.suspended"), () =>
            setDialog(null),
          )
        }
      />

      <RejectDialog
        open={dialog === "cancel"}
        onOpenChange={(open) => setDialog(open ? "cancel" : null)}
        title={t("actions.cancelPermitTitle")}
        label={t("actions.reason")}
        confirmLabel={t("actions.cancelPermit")}
        pendingLabel={t("actions.cancelling")}
        onReject={(reason) =>
          run(() => cancelPermitAction(permit.id, reason), t("actions.cancelled"), () => setDialog(null))
        }
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Toolbox talk                                                                */
/* -------------------------------------------------------------------------- */

export function ToolboxActions({ talk }: { talk: ToolboxDetailDTO }) {
  const t = useHseTranslations();
  const { run, pending } = useRunner();
  const [dialog, setDialog] = React.useState<"cancel" | null>(null);
  const [confirm, setConfirm] = React.useState(false);
  const may = talk.capabilities;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {may.canEdit ? (
        <Button asChild variant="secondary">
          <Link href={`/hse/toolbox-talks/${talk.id}/edit`}>{t("template.detail.edit")}</Link>
        </Button>
      ) : null}

      {may.canComplete ? (
        <Button onClick={() => setConfirm(true)} disabled={pending}>
          {t("actions.complete")}
        </Button>
      ) : null}

      {may.canCancel ? (
        <Button variant="ghost" onClick={() => setDialog("cancel")} disabled={pending}>
          {t("actions.cancel")}
        </Button>
      ) : null}

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t("actions.completeTalkTitle")}
        description={t("actions.completeTalkDesc")}
        confirmLabel={t("actions.complete")}
        onConfirm={async () => {
          await run(() => completeToolboxTalkAction(talk.id), t("actions.completed"));
          setConfirm(false);
        }}
      />

      <RejectDialog
        open={dialog === "cancel"}
        onOpenChange={(open) => setDialog(open ? "cancel" : null)}
        title={t("actions.cancelTalkTitle")}
        label={t("actions.reason")}
        confirmLabel={t("actions.cancelTalk")}
        pendingLabel={t("actions.cancelling")}
        onReject={(reason) =>
          run(() => cancelToolboxTalkAction(talk.id, reason), t("actions.cancelled"), () =>
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
  const t = useHseTranslations();
  const { run, pending } = useRunner();
  const [dialog, setDialog] = React.useState<"close" | "reopen" | null>(null);
  const may = observation.capabilities;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {may.canEdit ? (
        <Button asChild variant="secondary">
          <Link href={`/hse/environment/${observation.id}/edit`}>{t("template.detail.edit")}</Link>
        </Button>
      ) : null}

      {may.canRaiseAction ? (
        <Button asChild variant="secondary">
          <Link href={`/hse/actions/new?environmentalObservationId=${observation.id}`}>
            {t("actions.raiseAction")}
          </Link>
        </Button>
      ) : null}

      {may.canClose ? (
        <Button onClick={() => setDialog("close")} disabled={pending}>
          {t("actions.closeOut")}
        </Button>
      ) : null}

      {may.canReopen ? (
        <Button variant="secondary" onClick={() => setDialog("reopen")} disabled={pending}>
          {t("actions.reopen")}
        </Button>
      ) : null}

      <RejectDialog
        open={dialog === "close"}
        onOpenChange={(open) => setDialog(open ? "close" : null)}
        title={t("actions.closeObservationTitle")}
        description={t("actions.closeObservationDesc")}
        label={t("record.closureNote")}
        confirmLabel={t("page.crumbClose")}
        pendingLabel={t("actions.closing")}
        emptyMessage={t("actions.writeClosureNote")}
        onReject={(note) =>
          run(() => closeObservationAction(observation.id, note), t("actions.closed"), () =>
            setDialog(null),
          )
        }
      />

      <RejectDialog
        open={dialog === "reopen"}
        onOpenChange={(open) => setDialog(open ? "reopen" : null)}
        title={t("actions.reopenObservationTitle")}
        label={t("actions.reason")}
        confirmLabel={t("actions.reopen")}
        pendingLabel={t("actions.reopening")}
        onReject={(reason) =>
          run(() => reopenObservationAction(observation.id, reason), t("actions.reopened"), () =>
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
  const t = useHseTranslations();
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
          <Link href={`/hse/actions/new?stopWorkId=${record.id}`}>{t("actions.raiseAction")}</Link>
        </Button>
      ) : null}

      {may.canRelease ? (
        <Button onClick={() => setDialog("release")} disabled={pending}>
          {t("actions.releaseWork")}
        </Button>
      ) : null}

      {may.canCancel ? (
        <Button variant="ghost" onClick={() => setDialog("cancel")} disabled={pending}>
          {t("actions.cancel")}
        </Button>
      ) : null}

      {blocked ? (
        <p className="text-meta text-warning-strong">
          {t("actions.cannotRelease")}
        </p>
      ) : null}

      <RejectDialog
        open={dialog === "release"}
        onOpenChange={(open) => setDialog(open ? "release" : null)}
        title={t("actions.releaseTitle")}
        description={t("actions.releaseDesc")}
        label={t("actions.whySafe")}
        confirmLabel={t("actions.release")}
        pendingLabel={t("actions.releasing")}
        emptyMessage={t("labels.stopWorkReleaseGap.RELEASE_REASON")}
        onReject={(reason) =>
          run(() => releaseStopWorkAction(record.id, reason), t("actions.workReleased"), () =>
            setDialog(null),
          )
        }
      />

      <RejectDialog
        open={dialog === "cancel"}
        onOpenChange={(open) => setDialog(open ? "cancel" : null)}
        title={t("actions.cancelStopWorkTitle")}
        description={t("actions.cancelStopWorkDesc")}
        label={t("actions.reason")}
        confirmLabel={t("actions.cancelStopWork")}
        pendingLabel={t("actions.cancelling")}
        onReject={(reason) =>
          run(() => cancelStopWorkAction(record.id, reason), t("actions.cancelled"), () =>
            setDialog(null),
          )
        }
      />
    </div>
  );
}
