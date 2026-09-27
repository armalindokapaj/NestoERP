"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "@/components/navigation/guarded-router";

import { RejectDialog } from "@/components/finance/reject-dialog";
import { StatusBadge } from "@/components/modules/status-badge";
import { PersonLink } from "@/components/people/person-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  approveInspectionAction,
  approvePermitAction,
  approveRiskAssessmentAction,
  closeIncidentAction,
  rejectInspectionAction,
  rejectPermitAction,
  rejectRiskAssessmentAction,
  type HseActionResult,
} from "@/lib/actions/hse";
import { approvalRecordTypeLabels } from "@/lib/modules/hse/hse.status";
import type { ApprovalQueueItemDTO } from "@/lib/modules/hse/hse.types";
import { formatRelativeTime } from "@/lib/utils/format";

/**
 * The HSE approval queue (PRD #22 §181, §182).
 *
 * Decision controls are withheld for whatever the reader submitted themselves,
 * so the queue never offers a button that is certain to fail. The row still
 * appears — they need to see it is waiting on somebody — with a line saying why
 * they cannot act on it.
 *
 * Decided rows stay, so the queue doubles as the record of who signed what.
 */
export function ApprovalQueue({ items }: { items: ApprovalQueueItemDTO[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = React.useTransition();
  const [rejecting, setRejecting] = React.useState<ApprovalQueueItemDTO | null>(null);

  function approve(item: ApprovalQueueItemDTO) {
    startTransition(async () => {
      const result = await decide(item, "approve", null);
      report(result, "Approved.");
    });
  }

  function report(result: HseActionResult, success: string) {
    if (result.ok) {
      setRejecting(null);
      toast({ title: result.message ?? success, tone: "success" });
      router.refresh();
    } else {
      toast({ title: result.error, tone: "danger" });
    }
  }

  function decide(
    item: ApprovalQueueItemDTO,
    decision: "approve" | "reject",
    note: string | null,
  ): Promise<HseActionResult> {
    // The row is one approval cycle and its decision names it, so a row left
    // open while the record was resubmitted cannot decide the new cycle
    // (AUD-10 §4, CW-05).
    const cycle = { approvalId: item.id };
    switch (item.recordType) {
      case "INSPECTION":
        return decision === "approve"
          ? approveInspectionAction(item.recordId, note ?? "", cycle)
          : rejectInspectionAction(item.recordId, note ?? "", cycle);
      case "RISK_ASSESSMENT":
        return decision === "approve"
          ? approveRiskAssessmentAction(item.recordId, note ?? "", cycle)
          : rejectRiskAssessmentAction(item.recordId, note ?? "", cycle);
      case "WORK_PERMIT":
        return decision === "approve"
          ? approvePermitAction(item.recordId, note ?? "", cycle)
          : rejectPermitAction(item.recordId, note ?? "", cycle);
      case "INCIDENT_CLOSE":
        // An incident close has no "reject": sending it back means reopening
        // the investigation, which is its own act (PRD #22 §96).
        return closeIncidentAction(item.recordId, note ?? "", cycle);
    }
  }

  return (
    <>
      <ul className="space-y-3">
        {items.map((item) => (
          <li key={item.id} className="nesto-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2">
                  {item.href ? (
                    <Link
                      href={item.href}
                      className="text-table font-medium text-fg hover:text-accent"
                    >
                      {item.reference}
                    </Link>
                  ) : (
                    <span className="text-table font-medium text-fg">{item.reference}</span>
                  )}
                  <Badge tone="neutral">{approvalRecordTypeLabels[item.recordType]}</Badge>
                  <StatusBadge status={item.status} />
                  {item.riskLabel ? <Badge tone="warning">{item.riskLabel}</Badge> : null}
                </p>
                {item.title ? (
                  <p className="mt-0.5 text-table capitalize text-fg-muted">{item.title}</p>
                ) : null}
                <p className="mt-1 text-meta text-fg-subtle">
                  {item.project ? `${item.project.code} · ` : ""}
                  Submitted by{" "}
                  {item.submittedBy ? (
                    <PersonLink memberId={item.submittedBy.memberId} name={item.submittedBy.fullName} />
                  ) : (
                    "somebody"
                  )}{" "}
                  {formatRelativeTime(item.submittedAt)}
                </p>
                {item.decidedBy ? (
                  <p className="mt-1 text-meta text-fg-subtle">
                    Decided by <PersonLink memberId={item.decidedBy.memberId} name={item.decidedBy.fullName} />
                    {item.decidedAt ? ` ${formatRelativeTime(item.decidedAt)}` : ""}
                    {item.decisionNote ? ` — ${item.decisionNote}` : ""}
                  </p>
                ) : null}
              </div>

              {item.status === "PENDING" ? (
                item.canDecide ? (
                  <div className="flex shrink-0 gap-2">
                    <Button size="sm" onClick={() => approve(item)} disabled={pending}>
                      {item.recordType === "INCIDENT_CLOSE" ? "Close" : "Approve"}
                    </Button>
                    {item.recordType === "INCIDENT_CLOSE" ? null : (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setRejecting(item)}
                        disabled={pending}
                      >
                        Send back
                      </Button>
                    )}
                  </div>
                ) : (
                  <p className="shrink-0 text-meta text-fg-subtle">
                    You submitted this — somebody else decides.
                  </p>
                )
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      <RejectDialog
        open={rejecting !== null}
        onOpenChange={(open) => setRejecting(open ? rejecting : null)}
        title={`Send ${rejecting?.reference ?? "this"} back`}
        label="What needs changing"
        confirmLabel="Send back"
        pendingLabel="Sending…"
        onReject={async (note) => {
          if (!rejecting) return false;
          const result = await decide(rejecting, "reject", note);
          report(result, "Sent back.");
          return result.ok;
        }}
      />
    </>
  );
}
