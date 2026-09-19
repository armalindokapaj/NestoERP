import { StatusBadge } from "@/components/modules/status-badge";
import { PersonLink } from "@/components/people/person-link";
import type { ContractApprovalDTO } from "@/lib/modules/contracts/contract.types";
import { formatDateTime } from "@/lib/utils/format";

/**
 * A record's approval history (PRD #18 §115, §423).
 *
 * Every cycle, newest first. A rejected contract that is revised and
 * resubmitted gets a new row rather than reopening the old one, so this reads
 * as the sequence of decisions it actually was.
 */
export function ContractApprovalHistory({
  approvals,
  emptyLabel = "This contract has not been submitted for approval.",
}: {
  approvals: ContractApprovalDTO[];
  emptyLabel?: string;
}) {
  if (approvals.length === 0) {
    return <p className="nesto-card p-5 text-table text-fg-subtle">{emptyLabel}</p>;
  }

  return (
    <ol className="nesto-card divide-y divide-line">
      {approvals.map((approval) => (
        <li key={approval.id} className="space-y-2 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <StatusBadge status={approval.status} />
            <time className="text-meta text-fg-subtle" dateTime={approval.submittedAt}>
              Submitted {formatDateTime(approval.submittedAt)}
            </time>
          </div>

          <dl className="grid gap-x-6 gap-y-1 text-table sm:grid-cols-2">
            <div className="flex gap-2">
              <dt className="text-fg-subtle">Submitted by</dt>
              <dd className="text-fg">
                {approval.submittedBy ? <PersonLink memberId={approval.submittedBy.memberId} name={approval.submittedBy.fullName} /> : "—"}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-fg-subtle">Decided by</dt>
              <dd className="text-fg">
                {approval.decidedBy ? <PersonLink memberId={approval.decidedBy.memberId} name={approval.decidedBy.fullName} /> : "Waiting for a decision"}
              </dd>
            </div>
            {approval.decidedAt ? (
              <div className="flex gap-2">
                <dt className="text-fg-subtle">Decided</dt>
                <dd className="text-fg">{formatDateTime(approval.decidedAt)}</dd>
              </div>
            ) : null}
          </dl>

          {approval.decisionNote ? (
            <p className="rounded-md bg-surface-sunken px-3 py-2 text-table text-fg-muted">
              {approval.decisionNote}
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
