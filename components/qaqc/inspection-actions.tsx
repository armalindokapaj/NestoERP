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

import { useQaqcTranslations } from "./qaqc-text";

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
  const t = useQaqcTranslations();
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
            {t("common.edit")}
          </Link>
        </Button>
      ) : null}

      {may.canExecute ? (
        <Button asChild size="sm">
          <Link href={`/qaqc/inspections/${inspection.id}/execute`}>
            {inspection.status === "DRAFT" ? t("inspectionActions.start") : t("inspectionActions.continue")}
          </Link>
        </Button>
      ) : null}

      {may.canApprove ? (
        <Button size="sm" disabled={pending} onClick={() => setDialog("approve")}>
          {t("common.approve")}
        </Button>
      ) : null}

      {may.canReject ? (
        <Button variant="secondary" size="sm" disabled={pending} onClick={() => setDialog("reject")}>
          {t("common.reject")}
        </Button>
      ) : null}

      {may.canRework ? (
        <Button size="sm" disabled={pending} onClick={() => run("rework", null, t("inspectionActions.reworked"))}>
          {t("inspectionActions.rework")}
        </Button>
      ) : null}

      {may.canClose ? (
        <Button size="sm" disabled={pending} onClick={() => setDialog("close")}>
          {t("inspectionActions.closeOut")}
        </Button>
      ) : null}

      {may.canRaiseReinspection ? (
        <Button asChild variant="secondary" size="sm">
          <Link href={`/qaqc/inspections/${inspection.id}/reinspect`}>{t("inspectionActions.reinspect")}</Link>
        </Button>
      ) : null}

      {may.canReopen ? (
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => setDialog("reopen")}>
          {t("common.reopen")}
        </Button>
      ) : null}

      {may.canCancel ? (
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => setDialog("cancel")}>
          {t("common.cancel")}
        </Button>
      ) : null}

      <ConfirmDialog
        open={dialog === "approve"}
        onOpenChange={(open) => setDialog(open ? "approve" : null)}
        title={t("inspectionActions.approveTitle", { number: inspection.inspectionNumber })}
        description={
          inspection.result === "PASS"
            ? t("inspectionActions.approvePass")
            : t("inspectionActions.approveOther")
        }
        confirmLabel={t("common.approve")}
        cancelLabel={t("common.notYet")}
        destructive={false}
        pending={pending}
        onConfirm={() => void run("approve", null, t("inspectionActions.approved"))}
      />

      <ConfirmDialog
        open={dialog === "close"}
        onOpenChange={(open) => setDialog(open ? "close" : null)}
        title={t("inspectionActions.closeTitle", { number: inspection.inspectionNumber })}
        description={
          inspection.result === "PASS"
            ? t("inspectionActions.closePass")
            : t("inspectionActions.closeOther")
        }
        confirmLabel={t("inspectionActions.closeOut")}
        cancelLabel={t("common.notYet")}
        destructive={false}
        pending={pending}
        onConfirm={() => void run("close", null, t("inspectionActions.closed"))}
      />

      <RejectDialog
        open={dialog === "reject"}
        onOpenChange={(open) => setDialog(open ? "reject" : null)}
        title={t("inspectionActions.rejectTitle", { number: inspection.inspectionNumber })}
        description={t("inspectionActions.rejectBody")}
        label={t("common.reason")}
        placeholder={t("inspectionActions.rejectPlaceholder")}
        confirmLabel={t("common.reject")}
        pendingLabel={t("common.rejecting")}
        emptyMessage={t("inspectionActions.rejectEmpty")}
        onReject={(reason) => run("reject", reason, t("inspectionActions.rejected"))}
      />

      <RejectDialog
        open={dialog === "cancel"}
        onOpenChange={(open) => setDialog(open ? "cancel" : null)}
        title={t("inspectionActions.cancelTitle", { number: inspection.inspectionNumber })}
        description={t("inspectionActions.cancelBody")}
        label={t("common.reason")}
        placeholder={t("common.whyCancelled")}
        confirmLabel={t("inspectionActions.cancelConfirm")}
        pendingLabel={t("common.cancelling")}
        emptyMessage={t("common.sayCancelled")}
        onReject={(reason) => run("cancel", reason, t("inspectionActions.cancelled"))}
      />

      <RejectDialog
        open={dialog === "reopen"}
        onOpenChange={(open) => setDialog(open ? "reopen" : null)}
        title={t("inspectionActions.reopenTitle", { number: inspection.inspectionNumber })}
        description={t("inspectionActions.reopenBody")}
        label={t("common.reason")}
        placeholder={t("inspectionActions.reopenPlaceholder")}
        confirmLabel={t("common.reopen")}
        pendingLabel={t("common.reopening")}
        emptyMessage={t("common.sayReopened")}
        onReject={(reason) => run("reopen", reason, t("inspectionActions.reopened"))}
      />
    </>
  );
}
