"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "next/navigation";

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

/**
 * The quality approval queue (PRD #21 §164, §165).
 *
 * Decision controls are withheld for whatever the reader submitted themselves,
 * so the queue never offers a button that is certain to fail. The row still
 * appears — they need to see that it is waiting on somebody — with a line
 * saying why they cannot act on it.
 */
export function ApprovalQueue({ approvals }: { approvals: QualityApprovalDTO[] }) {
  const router = useRouter();
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
            ? await inspectionLifecycleAction(approval.recordId, action, note)
            : await ncrLifecycleAction(approval.recordId, action, note);

        if (result.ok) {
          setDeciding(null);
          toast({
            title: action === "approve" ? "Approved." : "Rejected.",
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
                    {approval.recordType === "INSPECTION" ? "Inspection" : "NCR"}
                  </Badge>
                  <StatusBadge status={approval.status} />
                </p>
                <p className="mt-0.5 text-table text-fg-muted">{approval.recordTitle}</p>
                <p className="mt-1 text-meta text-fg-subtle">
                  Submitted by{" "}
                  {approval.submittedBy ? (
                    <PersonLink memberId={approval.submittedBy.memberId} name={approval.submittedBy.fullName} />
                  ) : (
                    "somebody"
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
                      Approve
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={pending}
                      onClick={() => setDeciding({ approval, action: "reject" })}
                    >
                      Reject
                    </Button>
                  </div>
                ) : (
                  <p className="shrink-0 text-meta text-fg-subtle">
                    You submitted this, so somebody else decides.
                  </p>
                )
              ) : null}
            </div>

            {approval.decisionNote ? (
              <p className="mt-3 text-meta text-fg-muted">
                <span className="font-medium">Decision:</span> {approval.decisionNote}
              </p>
            ) : null}
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={deciding?.action === "approve"}
        onOpenChange={(open) => !open && setDeciding(null)}
        title={deciding ? `Approve ${deciding.approval.recordNumber}?` : "Approve"}
        description={
          deciding?.approval.recordType === "INSPECTION"
            ? "You are agreeing with the inspector's findings."
            : "You are agreeing that the root cause is understood and the corrective actions genuinely fixed it."
        }
        confirmLabel="Approve"
        cancelLabel="Not yet"
        destructive={false}
        pending={pending}
        onConfirm={() => deciding && void run(deciding.approval, "approve", null)}
      />

      <RejectDialog
        open={deciding?.action === "reject"}
        onOpenChange={(open) => !open && setDeciding(null)}
        title={deciding ? `Reject ${deciding.approval.recordNumber}?` : "Reject"}
        description="The reason is recorded against the approval and shown to whoever submitted it."
        placeholder="What needs to change?"
        confirmLabel="Reject"
        pendingLabel="Rejecting…"
        emptyMessage="Say what needs to change."
        onReject={(reason) => (deciding ? run(deciding.approval, "reject", reason) : Promise.resolve(false))}
      />
    </>
  );
}
