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
import type { PendingCycle } from "@/lib/core/approvals/approval-guard";
import type { RequestDetailDTO } from "@/lib/modules/procurement/procurement.types";
import { useProcurementServerText, useProcurementTranslations } from "./procurement-text";

/**
 * What a reader may do to a purchase request (PRD #19 §56–§60).
 *
 * Every control is drawn from the record's own capabilities, so somebody who
 * cannot approve sees no Approve button rather than a disabled one — a disabled
 * control still tells them the action exists and that they were refused it
 * (PRD #5 §32).
 */
export function RequestActions({
  request,
  cycle,
}: {
  request: RequestDetailDTO;
  /** The approval cycle on screen; approve and reject name it back (AUD-10 §4, CW-05). */
  cycle: PendingCycle | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const t = useProcurementTranslations();
  const serverText = useProcurementServerText();
  const [pending, startTransition] = React.useTransition();
  const [dialog, setDialog] = React.useState<"none" | "reject" | "cancel" | "archive">("none");

  const may = request.capabilities;

  function handle(result: ProcurementActionResult, success: string) {
    if (result.ok) {
      setDialog("none");
      toast({ title: success, tone: "success" });
      router.refresh();
    } else {
      toast({ title: serverText(result.error) ?? result.error, tone: "danger" });
    }
  }

  function run(action: RequestLifecycleAction, success: string) {
    startTransition(async () => {
      handle(await requestLifecycleAction(request.id, action, undefined, cycle), success);
    });
  }

  return (
    <>
      {may.canEdit ? (
        <Button asChild variant="secondary" size="sm">
          <Link href={`/procurement/requests/${request.id}/edit`}>
            <PenLine aria-hidden="true" />
            {t("common.edit")}
          </Link>
        </Button>
      ) : null}

      {may.canSubmit ? (
        <Button size="sm" disabled={pending} onClick={() => run("submit", t("common.sentForApproval"))}>
          {t("common.submitForApproval")}
        </Button>
      ) : null}

      {may.canReject ? (
        <Button variant="secondary" size="sm" disabled={pending} onClick={() => setDialog("reject")}>
          {t("common.reject")}
        </Button>
      ) : null}

      {may.canApprove ? (
        <Button size="sm" disabled={pending} onClick={() => run("approve", t("requests.approved"))}>
          {t("common.approve")}
        </Button>
      ) : null}

      {may.canCreateRfq ? (
        <Button asChild variant="secondary" size="sm">
          <Link href={`/procurement/rfqs/new?requestId=${request.id}`}>{t("requests.createEnquiry")}</Link>
        </Button>
      ) : null}

      {may.canCreateOrder ? (
        <Button asChild variant="secondary" size="sm">
          <Link href={`/procurement/orders/new?requestId=${request.id}`}>{t("requests.createOrder")}</Link>
        </Button>
      ) : null}

      {may.canCancel ? (
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => setDialog("cancel")}>
          {t("common.cancel")}
        </Button>
      ) : null}

      {may.canArchive ? (
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => setDialog("archive")}>
          {t("common.archive")}
        </Button>
      ) : null}

      {may.canRestore ? (
        <Button variant="secondary" size="sm" disabled={pending} onClick={() => run("restore", t("requests.restored"))}>
          {t("common.restore")}
        </Button>
      ) : null}

      <RejectDialog
        open={dialog === "reject"}
        onOpenChange={(open) => !open && setDialog("none")}
        title={t("requests.rejectTitle", { number: request.requestNumber })}
        onReject={async (reason) => {
          const result = await rejectRequestAction(request.id, reason, cycle);
          handle(result, t("requests.rejected"));
          return result.ok;
        }}
      />

      <RejectDialog
        open={dialog === "cancel"}
        onOpenChange={(open) => !open && setDialog("none")}
        title={t("requests.cancelTitle", { number: request.requestNumber })}
        description={t("requests.cancelDescription")}
        label={t("common.note")}
        placeholder={t("requests.cancelPlaceholder")}
        confirmLabel={t("requests.cancelConfirm")}
        pendingLabel={t("common.cancelling")}
        emptyMessage={t("requests.cancelEmpty")}
        onReject={async (note) => {
          const result = await cancelRequestAction(request.id, note);
          handle(result, t("requests.cancelled"));
          return result.ok;
        }}
      />

      <ConfirmDialog
        open={dialog === "archive"}
        onOpenChange={(open) => !open && setDialog("none")}
        title={t("requests.archiveTitle", { number: request.requestNumber })}
        description={t("common.archiveDescription")}
        confirmLabel={t("requests.archiveConfirm")}
        onConfirm={() => run("archive", t("requests.archived"))}
      />
    </>
  );
}
