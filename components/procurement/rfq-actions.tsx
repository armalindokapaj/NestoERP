"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "@/components/navigation/guarded-router";
import { PenLine } from "lucide-react";

import { RejectDialog } from "@/components/finance/reject-dialog";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { rfqLifecycleAction, type RfqLifecycleAction } from "@/lib/actions/procurement";
import type { RfqDetailDTO } from "@/lib/modules/procurement/procurement.types";
import { useProcurementServerText, useProcurementTranslations } from "./procurement-text";

/** What a reader may do to an enquiry (PRD #19 §73–§77). */
export function RfqActions({ rfq }: { rfq: RfqDetailDTO }) {
  const router = useRouter();
  const toast = useToast();
  const t = useProcurementTranslations();
  const serverText = useProcurementServerText();
  const [pending, startTransition] = React.useTransition();
  const [dialog, setDialog] = React.useState<"none" | "issue" | "close" | "cancel">("none");

  const may = rfq.capabilities;

  function run(action: RfqLifecycleAction, success: string, note?: string) {
    startTransition(async () => {
      const result = await rfqLifecycleAction(rfq.id, action, note);
      if (result.ok) {
        setDialog("none");
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
          <Link href={`/procurement/rfqs/${rfq.id}/edit`}>
            <PenLine aria-hidden="true" />
            {t("common.edit")}
          </Link>
        </Button>
      ) : null}

      {may.canViewQuotes ? (
        <Button asChild variant="secondary" size="sm">
          <Link href={`/procurement/rfqs/${rfq.id}/comparison`}>{t("rfqs.compare")}</Link>
        </Button>
      ) : null}

      {may.canRecordQuote ? (
        <Button asChild size="sm">
          <Link href={`/procurement/rfqs/${rfq.id}/quotes`}>{t("rfqs.recordQuote")}</Link>
        </Button>
      ) : null}

      {may.canIssue ? (
        <Button size="sm" disabled={pending} onClick={() => setDialog("issue")}>
          {t("rfqs.issue")}
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

      <ConfirmDialog
        open={dialog === "issue"}
        onOpenChange={(open) => !open && setDialog("none")}
        title={t("rfqs.issueTitle", { number: rfq.rfqNumber })}
        description={t("rfqs.issueDescription")}
        confirmLabel={t("rfqs.issueConfirm")}
        destructive={false}
        pending={pending}
        onConfirm={() => run("issue", t("rfqs.issued"))}
      />

      <ConfirmDialog
        open={dialog === "close"}
        onOpenChange={(open) => !open && setDialog("none")}
        title={t("rfqs.closeTitle", { number: rfq.rfqNumber })}
        description={t("rfqs.closeDescription")}
        confirmLabel={t("rfqs.closeConfirm")}
        destructive={false}
        pending={pending}
        onConfirm={() => run("close", t("rfqs.closedToast"))}
      />

      <RejectDialog
        open={dialog === "cancel"}
        onOpenChange={(open) => !open && setDialog("none")}
        title={t("rfqs.cancelTitle", { number: rfq.rfqNumber })}
        description={t("rfqs.cancelDescription")}
        label={t("common.note")}
        placeholder={t("rfqs.cancelPlaceholder")}
        confirmLabel={t("rfqs.cancelConfirm")}
        pendingLabel={t("common.cancelling")}
        emptyMessage={t("rfqs.cancelEmpty")}
        onReject={async (note) => {
          run("cancel", t("rfqs.cancelled"), note);
          return true;
        }}
      />
    </>
  );
}
