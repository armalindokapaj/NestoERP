import { Badge } from "@/components/ui/badge";
import { PersonLink } from "@/components/people/person-link";
import type { ProcurementApprovalDTO } from "@/lib/modules/procurement/procurement.types";
import { formatDateTime } from "@/lib/utils/format";

/**
 * One record's approval history (PRD #19 §156, §157).
 *
 * Prior decisions are never overwritten: a rejected cycle stays beside the
 * approved one that followed it, so the record shows what actually happened
 * rather than only where it ended up.
 */
export function ProcurementApprovalHistory({
  approvals,
  emptyLabel = "This has not been submitted for approval.",
}: {
  approvals: ProcurementApprovalDTO[];
  emptyLabel?: string;
}) {
  if (approvals.length === 0) {
    return (
      <p className="nesto-card p-5 text-table text-fg-subtle">{emptyLabel}</p>
    );
  }

  return (
    <ol className="nesto-card divide-y divide-line">
      {approvals.map((approval) => (
        <li key={approval.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="text-table text-fg">
              {approval.submittedBy ? (
                <PersonLink memberId={approval.submittedBy.memberId} name={approval.submittedBy.fullName} />
              ) : (
                <span className="font-medium">Somebody</span>
              )}{" "}
              submitted it
              {approval.decidedBy ? (
                <>
                  {", "}
                  <PersonLink memberId={approval.decidedBy.memberId} name={approval.decidedBy.fullName} /> decided
                </>
              ) : null}
            </p>
            <p className="text-meta text-fg-subtle">
              {formatDateTime(approval.submittedAt)}
              {approval.decidedAt ? ` · decided ${formatDateTime(approval.decidedAt)}` : ""}
            </p>
            {approval.decisionNote ? (
              <p className="mt-1 text-meta text-fg-muted">{approval.decisionNote}</p>
            ) : null}
          </div>

          <Badge
            tone={
              approval.status === "APPROVED"
                ? "success"
                : approval.status === "REJECTED"
                  ? "danger"
                  : approval.status === "CANCELLED"
                    ? "neutral"
                    : "info"
            }
          >
            {approval.status === "PENDING"
              ? "Waiting"
              : approval.status.charAt(0) + approval.status.slice(1).toLowerCase()}
          </Badge>
        </li>
      ))}
    </ol>
  );
}
