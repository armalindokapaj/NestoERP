"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "@/components/navigation/guarded-router";

import { RejectDialog } from "@/components/finance/reject-dialog";
import { StatusBadge } from "@/components/modules/status-badge";
import { PersonLink } from "@/components/people/person-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { inspectionLifecycleAction, ncrLifecycleAction } from "@/lib/actions/qaqc";
import type { QualityApprovalDTO } from "@/lib/modules/qaqc/qaqc.types";
import { formatRelativeTime } from "@/lib/utils/format";

import { useQaqcTranslations } from "./qaqc-text";

/**
 * The quality approval queue (PRD #21 §164, §165).
 *
 * Decision controls are withheld for whatever the reader submitted themselves,
 * so the queue never offers a button that is certain to fail. The row still
 * appears — they need to see that it is waiting on somebody — with a line
 * saying why they cannot act on it.
 *
 * Each row is one approval cycle and its decision names it: a row left open
 * while the record was resubmitted cannot decide the new cycle (AUD-10 §4,
 * CW-05).
 */
export function ApprovalQueue({ approvals }: { approvals: QualityApprovalDTO[] }) {
  const router = useRouter();
  const t = useQaqcTranslations();
  const toast = useToast();
  const [pending, startTransition] = React.useTransition();
  const [deciding, setDeciding] = React.useState<{
    approval: QualityApprovalDTO;
    action: "approve" | "reject";
  } | null>(null);

  function run(approval: QualityApprovalDTO, action: "approve" | "reject", note: string | null) {
    return new Promise<boolean>((resolve) => {
      startTransition(async () => {
        const result =
          approval.recordType === "INSPECTION"
            ? await inspectionLifecycleAction(approval.recordId, action, note, { approvalId: approval.id })
            : await ncrLifecycleAction(approval.recordId, action, note, { approvalId: approval.id });

        if (result.ok) {
          setDeciding(null);
          toast({
            title: action === "approve" ? t("queue.approved") : t("queue.rejected"),
            tone: "success",
          });
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
      <ul className="space-y-3">
        {approvals.map((approval) => (
          <li key={approval.id} className="nesto-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2">
                  <Link
                    href={approval.href}
                    className="text-table font-medium text-fg hover:text-accent"
                  >
                    {approval.recordNumber}
                  </Link>
                  <Badge tone="neutral">
                    {approval.recordType === "INSPECTION" ? t("queue.inspection") : t("queue.ncr")}
                  </Badge>
                  <StatusBadge status={approval.status} />
                </p>
                <p className="mt-0.5 text-table text-fg-muted">{approval.recordTitle}</p>
                <p className="mt-1 text-meta text-fg-subtle">
                  {t("queue.submittedBy")}{" "}
                  {approval.submittedBy ? (
                    <PersonLink memberId={approval.submittedBy.memberId} name={approval.submittedBy.fullName} />
                  ) : (
                    t("common.somebody")
                  )}{" "}
                  {formatRelativeTime(approval.submittedAt)}
                </p>
              </div>

              {approval.status === "PENDING" ? (
                approval.canDecide ? (
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      size="sm"
                      disabled={pending}
                      onClick={() => setDeciding({ approval, action: "approve" })}
                    >
                      {t("common.approve")}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={pending}
                      onClick={() => setDeciding({ approval, action: "reject" })}
                    >
                      {t("common.reject")}
                    </Button>
                  </div>
                ) : (
                  <p className="shrink-0 text-meta text-fg-subtle">
                    {t("queue.ownSubmission")}
                  </p>
                )
              ) : null}
            </div>

            {approval.decisionNote ? (
              <p className="mt-3 text-meta text-fg-muted">
                <span className="font-medium">{t("queue.decision")}</span> {approval.decisionNote}
              </p>
            ) : null}
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={deciding?.action === "approve"}
        onOpenChange={(open) => !open && setDeciding(null)}
        title={deciding ? t("queue.approveTitle", { number: deciding.approval.recordNumber }) : t("common.approve")}
        description={
          deciding?.approval.recordType === "INSPECTION"
            ? t("queue.approveInspection")
            : t("queue.approveNcr")
        }
        confirmLabel={t("common.approve")}
        cancelLabel={t("common.notYet")}
        destructive={false}
        pending={pending}
        onConfirm={() => deciding && void run(deciding.approval, "approve", null)}
      />

      <RejectDialog
        open={deciding?.action === "reject"}
        onOpenChange={(open) => !open && setDeciding(null)}
        title={deciding ? t("queue.rejectTitle", { number: deciding.approval.recordNumber }) : t("common.reject")}
        description={t("queue.rejectBody")}
        label={t("common.reason")}
        placeholder={t("queue.rejectPlaceholder")}
        confirmLabel={t("common.reject")}
        pendingLabel={t("common.rejecting")}
        emptyMessage={t("queue.rejectEmpty")}
        onReject={(reason) => (deciding ? run(deciding.approval, "reject", reason) : Promise.resolve(false))}
      />
    </>
  );
}
