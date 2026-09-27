"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "@/components/navigation/guarded-router";
import { Ban, PenLine, Send, ThumbsDown, ThumbsUp } from "lucide-react";

import { RejectDialog } from "@/components/finance/reject-dialog";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { leaveLifecycleAction, rejectLeaveAction, type LeaveAction } from "@/lib/actions/hr";
import type { LeaveRequestDTO } from "@/lib/modules/hr/hr.types";
import { useHrServerText, useHrTranslations } from "./hr-text";

/**
 * Actions on a leave request (PRD #16 §86–§89).
 *
 * Capabilities are hints: the server re-checks every one of them, including the
 * rule that nobody decides their own request — which is why an approver never
 * sees Approve on their own leave (PRD #16 §194).
 */
export function LeaveActions({ request }: { request: LeaveRequestDTO }) {
  const t = useHrTranslations();
  const serverText = useHrServerText();
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = React.useTransition();
  const [cancelling, setCancelling] = React.useState(false);
  const [rejecting, setRejecting] = React.useState(false);

  const may = request.capabilities;

  function run(action: LeaveAction, success: string) {
    startTransition(async () => {
      // A decision names the submission on screen, so a request rejected and
      // resubmitted meanwhile is not approved from this page (AUD-10 §4, A2).
      const result = await leaveLifecycleAction(request.id, action, undefined, request.submittedAt);
      setCancelling(false);
      if (result.ok) {
        toast({ title: success, tone: "success" });
        router.refresh();
      } else {
        toast({ title: serverText(result.error) ?? result.error, tone: "danger" });
      }
    });
  }

  return (
    <>
      {may.canEdit ? (
        <Button asChild variant="secondary" size="sm">
          <Link href={`/hr/leave/${request.id}/edit`}>
            <PenLine aria-hidden="true" />
            {t("common.edit")}
          </Link>
        </Button>
      ) : null}

      {may.canSubmit ? (
        <Button size="sm" onClick={() => run("submit", t("leaveActions.submitted"))} disabled={pending}>
          <Send aria-hidden="true" />
          {pending ? t("common.working") : t("leaveActions.submit")}
        </Button>
      ) : null}

      {may.canApprove ? (
        <Button size="sm" onClick={() => run("approve", t("leaveActions.approved"))} disabled={pending}>
          <ThumbsUp aria-hidden="true" />
          {pending ? t("common.working") : t("leaveActions.approve")}
        </Button>
      ) : null}

      {may.canReject ? (
        <Button variant="secondary" size="sm" onClick={() => setRejecting(true)} disabled={pending}>
          <ThumbsDown aria-hidden="true" />
          {t("leaveActions.reject")}
        </Button>
      ) : null}

      {may.canCancel ? (
        <Button variant="ghost" size="sm" onClick={() => setCancelling(true)} disabled={pending}>
          <Ban aria-hidden="true" />
          {t("common.cancel")}
        </Button>
      ) : null}

      <ConfirmDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title={t("leaveActions.cancelTitle")}
        description={
          request.status === "APPROVED"
            ? t("leaveActions.cancelApproved")
            : t("leaveActions.cancelOther")
        }
        confirmLabel={t("leaveActions.cancelLeave")}
        pending={pending}
        onConfirm={() => run("cancel", t("leaveActions.cancelled"))}
      />

      <RejectDialog
        open={rejecting}
        onOpenChange={setRejecting}
        title={t("leaveActions.rejectTitle")}
        onReject={async (reason) => {
          const result = await rejectLeaveAction(request.id, reason, request.submittedAt);
          if (result.ok) {
            toast({ title: t("leaveActions.rejected") });
            setRejecting(false);
            router.refresh();
          } else {
            toast({ title: serverText(result.error) ?? result.error, tone: "danger" });
          }
          return result.ok;
        }}
      />
    </>
  );
}
