"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "next/navigation";
import { ThumbsDown, ThumbsUp } from "lucide-react";

import { RejectDialog } from "@/components/finance/reject-dialog";
import { StatusBadge } from "@/components/modules/status-badge";
import { PersonLink } from "@/components/people/person-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  amendmentLifecycleAction,
  contractLifecycleAction,
  rejectAmendmentAction,
  rejectContractAction,
} from "@/lib/actions/contracts";
import type { ContractApprovalDTO } from "@/lib/modules/contracts/contract.types";
import { formatDateTime } from "@/lib/utils/format";
import { commercialLabel } from "./contract-format";

/**
 * The approval queue (PRD #18 §185–§187).
 *
 * Contracts and amendments in one list, because they are the same decision in
 * two shapes. Approve and Reject are offered only where the server said so —
 * which already accounts for the self-approval rule, so somebody looking at
 * their own submission sees the record but no buttons. The services enforce it
 * again regardless (PRD #18 §116).
 */
export function ContractApprovalQueue({ approvals }: { approvals: ContractApprovalDTO[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [rejecting, setRejecting] = React.useState<ContractApprovalDTO | null>(null);
  const [busy, startTransition] = React.useTransition();

  const showValue = approvals.some((approval) => approval.commercial !== null);

  function approve(approval: ContractApprovalDTO) {
    setPendingId(approval.id);
    startTransition(async () => {
      const result =
        approval.recordType === "CONTRACT"
          ? await contractLifecycleAction(approval.recordId, "approve")
          : await amendmentLifecycleAction(approval.contractId, approval.recordId, "approve");

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
                  {approval.recordType === "CONTRACT" ? "Contract" : "Amendment"}
                </Badge>
                <Link
                  href={
                    approval.recordType === "CONTRACT"
                      ? `/contracts/${approval.recordId}`
                      : `/contracts/${approval.contractId}/amendments/${approval.recordId}`
                  }
                  className="text-table font-medium text-fg transition-colors hover:text-accent"
                >
                  {approval.recordReference}
                </Link>
                <StatusBadge status={approval.status} />
              </div>

              <p className="text-table text-fg-muted">{approval.recordTitle}</p>

              <p className="text-meta text-fg-subtle">
                {approval.client?.name ?? "No client"}
                {approval.project ? ` · ${approval.project.code}` : ""} · submitted by{" "}
                {approval.submittedBy ? <PersonLink memberId={approval.submittedBy.memberId} name={approval.submittedBy.fullName} /> : "somebody"}{" "}
                {formatDateTime(approval.submittedAt)}
              </p>
            </div>

            <div className="flex shrink-0 flex-col items-end gap-2">
              {showValue && approval.commercial ? (
                <span className="text-table tabular-nums text-fg">
                  {commercialLabel(approval.commercial)}
                </span>
              ) : null}

              <div className="flex flex-wrap gap-2">
                {approval.capabilities.canReject ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() => setRejecting(approval)}
                  >
                    <ThumbsDown aria-hidden="true" />
                    Reject
                  </Button>
                ) : null}
                {approval.capabilities.canApprove ? (
                  <Button
                    size="sm"
                    disabled={busy && pendingId === approval.id}
                    onClick={() => approve(approval)}
                  >
                    <ThumbsUp aria-hidden="true" />
                    Approve
                  </Button>
                ) : null}
              </div>

              {approval.status === "PENDING" &&
              !approval.capabilities.canApprove &&
              !approval.capabilities.canReject ? (
                <p className="text-meta text-fg-subtle">Waiting for somebody else to decide</p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      <RejectDialog
        open={rejecting !== null}
        onOpenChange={(open) => (open ? undefined : setRejecting(null))}
        title={`Reject ${rejecting?.recordReference ?? "this record"}?`}
        description="The reason is recorded against the approval and shown to whoever submitted it."
        onReject={async (reason) => {
          if (!rejecting) return false;
          const result =
            rejecting.recordType === "CONTRACT"
              ? await rejectContractAction(rejecting.recordId, reason)
              : await rejectAmendmentAction(rejecting.contractId, rejecting.recordId, reason);

          if (result.ok) {
            setRejecting(null);
            toast({ title: `${rejecting.recordReference} rejected.`, tone: "success" });
            router.refresh();
          } else {
            toast({ title: result.error, tone: "danger" });
          }
          return result.ok;
        }}
      />
    </>
  );
}
