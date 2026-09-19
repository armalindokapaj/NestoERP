import { Money } from "@/components/finance/money";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PersonLink } from "@/components/people/person-link";
import { Wallet } from "lucide-react";
import type { CompensationDTO } from "@/lib/modules/hr/hr.types";
import { formatDate } from "@/lib/utils/format";

/**
 * Effective-dated pay history (PRD #16 §240).
 *
 * Nothing here is ever edited in place: a change is a new record, and the one
 * still open is the current one. The history is the audit trail, which is why
 * there is no delete (PRD #16 §65, §241).
 */
const PAY_TYPE_LABELS: Record<string, string> = {
  SALARY: "Salary",
  HOURLY: "Hourly",
  DAILY: "Daily",
  OTHER: "Other",
};

export function CompensationHistory({ records }: { records: CompensationDTO[] }) {
  if (records.length === 0) {
    return (
      <EmptyState
        icon={<Wallet />}
        title="No compensation recorded."
        description="Pay is recorded as effective-dated entries, so the history stays intact."
      />
    );
  }

  return (
    <ul className="space-y-2">
      {records.map((record) => (
        <li key={record.id} className="nesto-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Money
                  amount={record.baseAmount}
                  currency={record.currency}
                  emphasis
                  className="text-card"
                />
                <span className="text-table text-fg-muted">
                  {PAY_TYPE_LABELS[record.payType] ?? record.payType}
                </span>
                {record.isCurrent ? <Badge tone="success">Current</Badge> : null}
              </div>
              <p className="mt-1 text-meta text-fg-subtle">
                {formatDate(record.effectiveFrom)} —{" "}
                {record.effectiveTo ? formatDate(record.effectiveTo) : "open"}
              </p>
            </div>
            <p className="text-meta text-fg-subtle">
              Recorded by {record.recordedBy ? <PersonLink memberId={record.recordedByMemberId} name={record.recordedBy} /> : "—"}
            </p>
          </div>

          {record.notes ? (
            <p className="mt-3 whitespace-pre-wrap border-t border-line pt-3 text-table text-fg-muted">
              {record.notes}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
