import { StatusBadge } from "@/components/modules/status-badge";
import type { FinanceApprovalDTO } from "@/lib/modules/finance/finance.types";
import { formatDateTime } from "@/lib/utils/format";

/**
 * Every approval cycle a record has been through (PRD #15 §145).
 *
 * A resubmission opens a new cycle rather than reopening the old one, so this
 * reads as the sequence of decisions it actually was — including the rejections
 * and why (PRD #15 §64).
 */
export function ApprovalHistory({ approvals }: { approvals: FinanceApprovalDTO[] }) {
  if (approvals.length === 0) {
    return (
      <p className="mt-4 text-table text-fg-subtle">
        This record has not been submitted for approval.
      </p>
    );
  }

  return (
    <ol className="mt-4 divide-y divide-line">
      {approvals.map((approval) => (
        <li key={approval.id} className="py-3 first:pt-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={approval.status} />
            <span className="text-table text-fg">
              Submitted by {approval.submittedBy.fullName}
            </span>
          </div>
          <p className="mt-0.5 text-meta text-fg-subtle">
            {formatDateTime(approval.submittedAt)}
          </p>

          {approval.decision ? (
            <div className="mt-2 border-l-2 border-line pl-3">
              <p className="text-table text-fg">
                {approval.status === "APPROVED" ? "Approved" : "Rejected"} by{" "}
                {approval.decision.fullName}
              </p>
              <p className="mt-0.5 text-meta text-fg-subtle">
                {formatDateTime(approval.decision.decidedAt)}
              </p>
              {approval.decision.note ? (
                <p className="mt-1 text-table text-fg-muted">{approval.decision.note}</p>
              ) : null}
            </div>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
