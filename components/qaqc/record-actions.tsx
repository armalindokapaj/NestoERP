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
import { qaqcLabel } from "./qaqc-labels";
import { useQaqcTranslations } from "./qaqc-text";
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
  const t = useQaqcTranslations();
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
            {t("common.edit")}
          </Link>
        </Button>
      ) : null}

      {may.canResolve ? (
        <Button size="sm" disabled={pending} onClick={() => setDialog("resolve")}>
          {t("defectActions.recordFix")}
        </Button>
      ) : null}

      {may.canClose ? (
        <Button size="sm" disabled={pending} onClick={() => setDialog("close")}>
          {t("defectActions.confirmClose")}
        </Button>
      ) : null}

      {may.canEscalate ? (
        <Button asChild variant="secondary" size="sm">
          <Link href={`/qaqc/defects/${defect.id}/escalate`}>{t("defectActions.raiseNcr")}</Link>
        </Button>
      ) : null}

      {may.canReopen ? (
        <Button variant="secondary" size="sm" disabled={pending} onClick={() => setDialog("reopen")}>
          {t("common.reopen")}
        </Button>
      ) : null}

      {may.canCancel ? (
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => setDialog("cancel")}>
          {t("common.cancel")}
        </Button>
      ) : null}

      <RejectDialog
        open={dialog === "resolve"}
        onOpenChange={(open) => setDialog(open ? "resolve" : null)}
        title={t("defectActions.fixTitle", { number: defect.defectNumber })}
        description={t("defectActions.fixBody")}
        label={t("detail.whatWasDone")}
        placeholder={t("defectActions.fixPlaceholder")}
        confirmLabel={t("defectActions.recordFix")}
        pendingLabel={t("common.saving")}
        emptyMessage={t("defectActions.fixEmpty")}
        onReject={(note) => run("resolve", note, t("defectActions.fixRecorded"))}
      />

      <ConfirmDialog
        open={dialog === "close"}
        onOpenChange={(open) => setDialog(open ? "close" : null)}
        title={t("defectActions.closeTitle", { number: defect.defectNumber })}
        description={t("defectActions.closeBody")}
        confirmLabel={t("defectActions.confirmClose")}
        cancelLabel={t("common.notYet")}
        destructive={false}
        pending={pending}
        onConfirm={() => void run("close", null, t("defectActions.closed"))}
      />

      <RejectDialog
        open={dialog === "reopen"}
        onOpenChange={(open) => setDialog(open ? "reopen" : null)}
        title={t("defectActions.reopenTitle", { number: defect.defectNumber })}
        description={t("defectActions.reopenBody")}
        label={t("common.reason")}
        placeholder={t("common.whyReopened")}
        confirmLabel={t("common.reopen")}
        pendingLabel={t("common.reopening")}
        emptyMessage={t("common.sayReopened")}
        onReject={(note) => run("reopen", note, t("defectActions.reopened"))}
      />

      <RejectDialog
        open={dialog === "cancel"}
        onOpenChange={(open) => setDialog(open ? "cancel" : null)}
        title={t("defectActions.cancelTitle", { number: defect.defectNumber })}
        description={t("defectActions.cancelBody")}
        label={t("common.reason")}
        placeholder={t("common.whyCancelled")}
        confirmLabel={t("defectActions.cancelConfirm")}
        pendingLabel={t("common.cancelling")}
        emptyMessage={t("common.sayCancelled")}
        onReject={(note) => run("cancel", note, t("defectActions.cancelled"))}
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
  const t = useQaqcTranslations();
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
            {t("common.edit")}
          </Link>
        </Button>
      ) : null}

      {may.canOpen ? (
        <Button size="sm" disabled={pending} onClick={() => void run("open", null, t("ncrActions.opened"))}>
          {t("common.open")}
        </Button>
      ) : null}

      {may.canAddAction ? (
        <Button asChild variant="secondary" size="sm">
          <Link href={`/qaqc/corrective-actions/new?ncrId=${ncr.id}`}>{t("ncrActions.addAction")}</Link>
        </Button>
      ) : null}

      {may.canSubmit ? (
        <Button size="sm" disabled={pending} onClick={() => setDialog("submit")}>
          {t("ncrActions.submit")}
        </Button>
      ) : null}

      {may.canApprove ? (
        <Button size="sm" disabled={pending} onClick={() => setDialog("approve")}>
          {t("ncrActions.approve")}
        </Button>
      ) : null}

      {may.canReject ? (
        <Button variant="secondary" size="sm" disabled={pending} onClick={() => setDialog("reject")}>
          {t("common.reject")}
        </Button>
      ) : null}

      {may.canClose ? (
        <Button size="sm" disabled={pending} onClick={() => setDialog("close")}>
          {t("common.close")}
        </Button>
      ) : null}

      {may.canReopen ? (
        <Button variant="secondary" size="sm" disabled={pending} onClick={() => setDialog("reopen")}>
          {t("common.reopen")}
        </Button>
      ) : null}

      {may.canCancel ? (
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => setDialog("cancel")}>
          {t("common.cancel")}
        </Button>
      ) : null}

      <ConfirmDialog
        open={dialog === "submit"}
        onOpenChange={(open) => setDialog(open ? "submit" : null)}
        title={t("ncrActions.submitTitle", { number: ncr.ncrNumber })}
        description={t("ncrActions.submitBody")}
        confirmLabel={t("ncrActions.submitConfirm")}
        cancelLabel={t("common.notYet")}
        destructive={false}
        pending={pending}
        onConfirm={() => void run("submit", null, t("ncrActions.submitted"))}
      />

      <ConfirmDialog
        open={dialog === "approve"}
        onOpenChange={(open) => setDialog(open ? "approve" : null)}
        title={t("ncrActions.approveTitle", { number: ncr.ncrNumber })}
        description={t("ncrActions.approveBody")}
        confirmLabel={t("ncrActions.approve")}
        cancelLabel={t("common.notYet")}
        destructive={false}
        pending={pending}
        onConfirm={() => void run("approve", null, t("ncrActions.approved"))}
      />

      <ConfirmDialog
        open={dialog === "close"}
        onOpenChange={(open) => setDialog(open ? "close" : null)}
        title={t("ncrActions.closeTitle", { number: ncr.ncrNumber })}
        description={t("ncrActions.closeBody")}
        confirmLabel={t("ncrActions.closeConfirm")}
        cancelLabel={t("common.notYet")}
        destructive={false}
        pending={pending}
        onConfirm={() => void run("close", null, t("ncrActions.closed"))}
      />

      <RejectDialog
        open={dialog === "reject"}
        onOpenChange={(open) => setDialog(open ? "reject" : null)}
        title={t("ncrActions.rejectTitle", { number: ncr.ncrNumber })}
        description={t("ncrActions.rejectBody")}
        label={t("common.reason")}
        placeholder={t("ncrActions.rejectPlaceholder")}
        confirmLabel={t("ncrActions.rejectConfirm")}
        pendingLabel={t("common.rejecting")}
        emptyMessage={t("ncrActions.rejectEmpty")}
        onReject={(note) => run("reject", note, t("ncrActions.rejected"))}
      />

      <RejectDialog
        open={dialog === "reopen"}
        onOpenChange={(open) => setDialog(open ? "reopen" : null)}
        title={t("ncrActions.reopenTitle", { number: ncr.ncrNumber })}
        description={t("ncrActions.reopenBody")}
        label={t("common.reason")}
        placeholder={t("common.whyReopened")}
        confirmLabel={t("common.reopen")}
        pendingLabel={t("common.reopening")}
        emptyMessage={t("common.sayReopened")}
        onReject={(note) => run("reopen", note, t("ncrActions.reopened"))}
      />

      <RejectDialog
        open={dialog === "cancel"}
        onOpenChange={(open) => setDialog(open ? "cancel" : null)}
        title={t("ncrActions.cancelTitle", { number: ncr.ncrNumber })}
        description={t("ncrActions.cancelBody")}
        label={t("common.reason")}
        placeholder={t("common.whyCancelled")}
        confirmLabel={t("ncrActions.cancelConfirm")}
        pendingLabel={t("common.cancelling")}
        emptyMessage={t("common.sayCancelled")}
        onReject={(note) => run("cancel", note, t("ncrActions.cancelled"))}
      />
    </>
  );
}

/** What still stands between an NCR and closure (PRD #21 §136). */
export function ClosureGaps({ gaps }: { gaps: NcrClosureGap[] }) {
  const t = useQaqcTranslations();
  if (gaps.length === 0) return null;

  return (
    <div className="rounded-md border border-line bg-surface-muted px-4 py-3">
      <p className="text-table font-medium text-fg">{t("ncrActions.gapsTitle")}</p>
      <ul className="mt-2 space-y-1">
        {gaps.map((gap) => (
          <li key={gap} className="text-table text-fg-muted">
            {qaqcLabel(t, "closureGap", gap, ncrClosureGapLabels[gap])}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-meta text-fg-subtle">
        {t("ncrActions.gapsBody")}
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
  const t = useQaqcTranslations();
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
            {t("common.edit")}
          </Link>
        </Button>
      ) : null}

      {may.canComplete ? (
        <Button size="sm" disabled={pending} onClick={() => setDialog("complete")}>
          {t("actionActions.markDone")}
        </Button>
      ) : null}

      {may.canVerify ? (
        <>
          <Button size="sm" disabled={pending} onClick={() => setDialog("verify")}>
            {t("actionActions.verify")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={() => setDialog("reject")}
          >
            {t("actionActions.sendBack")}
          </Button>
        </>
      ) : null}

      {may.canReopen ? (
        <Button variant="secondary" size="sm" disabled={pending} onClick={() => setDialog("reopen")}>
          {t("common.reopen")}
        </Button>
      ) : null}

      {may.canCancel ? (
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => setDialog("cancel")}>
          {t("common.cancel")}
        </Button>
      ) : null}

      <RejectDialog
        open={dialog === "complete"}
        onOpenChange={(open) => setDialog(open ? "complete" : null)}
        title={t("actionActions.doneTitle", { number: action.actionNumber })}
        description={t("actionActions.doneBody")}
        label={t("detail.whatWasDone")}
        placeholder={t("actionActions.donePlaceholder")}
        confirmLabel={t("actionActions.markDone")}
        pendingLabel={t("common.saving")}
        emptyMessage={t("actionActions.doneEmpty")}
        onReject={(note) => run("complete", note, t("actionActions.done"))}
      />

      <ConfirmDialog
        open={dialog === "verify"}
        onOpenChange={(open) => setDialog(open ? "verify" : null)}
        title={t("actionActions.verifyTitle", { number: action.actionNumber })}
        description={t("actionActions.verifyBody")}
        confirmLabel={t("actionActions.verify")}
        cancelLabel={t("common.notYet")}
        destructive={false}
        pending={pending}
        onConfirm={() => void run("verify", null, t("actionActions.verified"))}
      />

      <RejectDialog
        open={dialog === "reject"}
        onOpenChange={(open) => setDialog(open ? "reject" : null)}
        title={t("actionActions.backTitle", { number: action.actionNumber })}
        description={t("actionActions.backBody")}
        label={t("common.reason")}
        placeholder={t("actionActions.backPlaceholder")}
        confirmLabel={t("actionActions.sendBack")}
        pendingLabel={t("actionActions.sending")}
        emptyMessage={t("actionActions.backEmpty")}
        onReject={(note) => run("reject", note, t("actionActions.sentBack"))}
      />

      <RejectDialog
        open={dialog === "reopen"}
        onOpenChange={(open) => setDialog(open ? "reopen" : null)}
        title={t("actionActions.reopenTitle", { number: action.actionNumber })}
        description={t("actionActions.reopenBody")}
        label={t("common.reason")}
        placeholder={t("common.whyReopened")}
        confirmLabel={t("common.reopen")}
        pendingLabel={t("common.reopening")}
        emptyMessage={t("common.sayReopened")}
        onReject={(note) => run("reopen", note, t("actionActions.reopened"))}
      />

      <RejectDialog
        open={dialog === "cancel"}
        onOpenChange={(open) => setDialog(open ? "cancel" : null)}
        title={t("actionActions.cancelTitle", { number: action.actionNumber })}
        description={t("actionActions.cancelBody")}
        label={t("common.reason")}
        placeholder={t("common.whyCancelled")}
        confirmLabel={t("actionActions.cancelConfirm")}
        pendingLabel={t("common.cancelling")}
        emptyMessage={t("common.sayCancelled")}
        onReject={(note) => run("cancel", note, t("actionActions.cancelled"))}
      />
    </>
  );
}
