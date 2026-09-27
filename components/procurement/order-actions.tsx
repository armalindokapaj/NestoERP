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
  cancelOrderAction,
  orderLifecycleAction,
  rejectOrderAction,
  type OrderLifecycleAction,
  type ProcurementActionResult,
} from "@/lib/actions/procurement";
import type { PendingCycle } from "@/lib/core/approvals/approval-guard";
import type { OrderDetailDTO } from "@/lib/modules/procurement/procurement.types";
import { useProcurementServerText, useProcurementTranslations } from "./procurement-text";

/**
 * What a reader may do to a purchase order (PRD #19 §110–§131, §273).
 *
 * Approving is the moment the money is committed, which is why it is the
 * button that carries a confirmation of what it means rather than the one that
 * issues the paperwork afterwards (PRD #19 §116).
 */
export function OrderActions({
  order,
  cycle,
}: {
  order: OrderDetailDTO;
  /**
   * The approval cycle on screen, with the chain step it showed; approve and
   * reject name both back, so this page cannot decide a later step
   * (AUD-10 §4, CW-04, CW-05).
   */
  cycle: PendingCycle | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const t = useProcurementTranslations();
  const serverText = useProcurementServerText();
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
      toast({ title: serverText(result.error) ?? result.error, tone: "danger" });
    }
  }

  function run(action: OrderLifecycleAction, success: string) {
    startTransition(async () => {
      handle(await orderLifecycleAction(order.id, action, undefined, cycle), success);
    });
  }

  return (
    <>
      {may.canEdit ? (
        <Button asChild variant="secondary" size="sm">
          <Link href={`/procurement/orders/${order.id}/edit`}>
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
        <Button size="sm" disabled={pending} onClick={() => setDialog("approve")}>
          {t("common.approve")}
        </Button>
      ) : null}

      {may.canIssue ? (
        <Button size="sm" disabled={pending} onClick={() => run("issue", t("orders.issued"))}>
          {t("orders.issue")}
        </Button>
      ) : null}

      {may.canReceive ? (
        <Button asChild variant="secondary" size="sm">
          <Link href={`/procurement/orders/${order.id}/receipts`}>{t("orders.recordDelivery")}</Link>
        </Button>
      ) : null}

      {may.canClose ? (
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => setDialog("close")}>
          {t("common.close")}
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
        <Button variant="secondary" size="sm" disabled={pending} onClick={() => run("restore", t("orders.restored"))}>
          {t("common.restore")}
        </Button>
      ) : null}

      <ConfirmDialog
        open={dialog === "approve"}
        onOpenChange={(open) => !open && setDialog("none")}
        title={t("orders.approveTitle", { number: order.poNumber })}
        description={t("orders.approveDescription")}
        confirmLabel={t("orders.approveConfirm")}
        destructive={false}
        pending={pending}
        onConfirm={() => run("approve", t("orders.approved"))}
      />

      <RejectDialog
        open={dialog === "reject"}
        onOpenChange={(open) => !open && setDialog("none")}
        title={t("orders.rejectTitle", { number: order.poNumber })}
        onReject={async (reason) => {
          const result = await rejectOrderAction(order.id, reason, cycle);
          handle(result, t("orders.rejected"));
          return result.ok;
        }}
      />

      <RejectDialog
        open={dialog === "cancel"}
        onOpenChange={(open) => !open && setDialog("none")}
        title={t("orders.cancelTitle", { number: order.poNumber })}
        description={t("orders.cancelDescription")}
        label={t("common.note")}
        placeholder={t("orders.cancelPlaceholder")}
        confirmLabel={t("orders.cancelConfirm")}
        pendingLabel={t("common.cancelling")}
        emptyMessage={t("orders.cancelEmpty")}
        onReject={async (note) => {
          const result = await cancelOrderAction(order.id, note);
          handle(result, t("orders.cancelled"));
          return result.ok;
        }}
      />

      <RejectDialog
        open={dialog === "close"}
        onOpenChange={(open) => !open && setDialog("none")}
        title={t("orders.closeTitle", { number: order.poNumber })}
        description={t("orders.closeDescription")}
        label={t("common.note")}
        placeholder={t("orders.closePlaceholder")}
        confirmLabel={t("orders.closeConfirm")}
        pendingLabel={t("orders.closing")}
        emptyMessage={t("orders.closeEmpty")}
        onReject={async (note) => {
          const result = await orderLifecycleAction(order.id, "close", note);
          handle(result, t("orders.closed"));
          return result.ok;
        }}
      />

      <ConfirmDialog
        open={dialog === "archive"}
        onOpenChange={(open) => !open && setDialog("none")}
        title={t("orders.archiveTitle", { number: order.poNumber })}
        description={t("common.archiveDescription")}
        confirmLabel={t("orders.archiveConfirm")}
        onConfirm={() => run("archive", t("orders.archived"))}
      />
    </>
  );
}
