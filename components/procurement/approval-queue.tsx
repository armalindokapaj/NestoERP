"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "next/navigation";

import { RejectDialog } from "@/components/finance/reject-dialog";
import { PersonLink } from "@/components/people/person-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { decideApprovalAction } from "@/lib/actions/procurement";
import type { ProcurementApprovalDTO } from "@/lib/modules/procurement/procurement.types";
import { formatDate } from "@/lib/utils/format";
import { moneyLabel } from "./procurement-format";

/**
 * The procurement approval queue (PRD #19 §152, §186, §187).
 *
 * Requests and orders in one list. The decision buttons are absent for the
 * person who submitted the thing — the service refuses it either way, and
 * offering an action that is certain to fail is worse than not offering it
 * (PRD #19 §21).
 */
export function ProcurementApprovalQueue({
  approvals,
}: {
  approvals: ProcurementApprovalDTO[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [rejecting, setRejecting] = React.useState<ProcurementApprovalDTO | null>(null);
  const [, startTransition] = React.useTransition();

  const showValue = approvals.some((approval) => approval.value !== null);

  function href(approval: ProcurementApprovalDTO) {
    return approval.recordType === "PURCHASE_REQUEST"
      ? `/procurement/requests/${approval.recordId}`
      : `/procurement/orders/${approval.recordId}`;
  }

  function approve(approval: ProcurementApprovalDTO) {
    setPendingId(approval.id);
    startTransition(async () => {
      const result = await decideApprovalAction(
        approval.recordType,
        approval.recordId,
        "approve",
      );
      setPendingId(null);
      if (result.ok) {
        toast({ title: `${approval.recordReference} approved.`, tone: "success" });
        router.refresh();
      } else {
        toast({ title: result.error, tone: "danger" });
      }
    });
  }

  return (
    <>
      <ul className="nesto-card divide-y divide-line">
        {approvals.map((approval) => (
          <li key={approval.id} className="flex flex-wrap items-start justify-between gap-3 p-5">
            <div className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="neutral">
                  {approval.recordType === "PURCHASE_REQUEST" ? "Request" : "Order"}
                </Badge>
                <Link href={href(approval)} className="text-table font-medium text-accent-strong">
                  {approval.recordReference}
                </Link>
                {approval.status !== "PENDING" ? (
                  <Badge tone={approval.status === "APPROVED" ? "success" : "danger"}>
                    {approval.status === "APPROVED" ? "Approved" : "Rejected"}
                  </Badge>
                ) : null}
              </div>

              <p className="truncate text-table text-fg">{approval.recordTitle}</p>

              <p className="text-meta text-fg-subtle">
                {approval.submittedBy ? <PersonLink memberId={approval.submittedBy.memberId} name={approval.submittedBy.fullName} /> : "Somebody"} · submitted{" "}
                {formatDate(approval.submittedAt)}
                {approval.project ? ` · ${approval.project.code}` : ""}
                {showValue && approval.value ? ` · ${moneyLabel(approval.value)}` : ""}
              </p>

              {approval.decisionNote ? (
                <p className="text-meta text-fg-muted">{approval.decisionNote}</p>
              ) : null}
            </div>

            {approval.capabilities.canApprove || approval.capabilities.canReject ? (
              <div className="flex shrink-0 items-center gap-2">
                {approval.capabilities.canReject ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={pendingId === approval.id}
                    onClick={() => setRejecting(approval)}
                  >
                    Reject
                  </Button>
                ) : null}
                {approval.capabilities.canApprove ? (
                  <Button
                    size="sm"
                    disabled={pendingId === approval.id}
                    onClick={() => approve(approval)}
                  >
                    Approve
                  </Button>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      <RejectDialog
        open={rejecting !== null}
        onOpenChange={(open) => !open && setRejecting(null)}
        title={rejecting ? `Reject ${rejecting.recordReference}?` : "Reject"}
        onReject={async (reason) => {
          if (!rejecting) return false;
          const result = await decideApprovalAction(
            rejecting.recordType,
            rejecting.recordId,
            "reject",
            reason,
          );
          if (result.ok) {
            toast({ title: `${rejecting.recordReference} rejected.`, tone: "success" });
            setRejecting(null);
            router.refresh();
            return true;
          }
          toast({ title: result.error, tone: "danger" });
          return false;
        }}
      />
    </>
  );
}
