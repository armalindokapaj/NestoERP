import { Badge } from "@/components/ui/badge";
import { PersonLink } from "@/components/people/person-link";
import type { ProcurementApprovalDTO } from "@/lib/modules/procurement/procurement.types";
import { formatDateTime } from "@/lib/utils/format";
import { getTranslations } from "@/lib/i18n/server";
import { procurementLabel } from "@/lib/i18n/modules/procurement/labels";

/**
 * One record's approval history (PRD #19 §156, §157).
 *
 * Prior decisions are never overwritten: a rejected cycle stays beside the
 * approved one that followed it, so the record shows what actually happened
 * rather than only where it ended up.
 */
export async function ProcurementApprovalHistory({
  approvals,
  emptyLabel,
}: {
  approvals: ProcurementApprovalDTO[];
  emptyLabel?: string;
}) {
  const t = await getTranslations("procurement");
  if (approvals.length === 0) {
    return (
      <p className="nesto-card p-5 text-table text-fg-subtle">{emptyLabel ?? t("history.empty")}</p>
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
                <span className="font-medium">{t("history.somebody")}</span>
              )}{" "}
              {t("history.submittedIt")}
              {approval.decidedBy ? (
                <>
                  {", "}
                  <PersonLink memberId={approval.decidedBy.memberId} name={approval.decidedBy.fullName} /> {t("history.decided")}
                </>
              ) : null}
            </p>
            <p className="text-meta text-fg-subtle">
              {formatDateTime(approval.submittedAt)}
              {approval.decidedAt ? ` · ${t("history.decidedAt", { date: formatDateTime(approval.decidedAt) })}` : ""}
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
            {procurementLabel(
              t,
              "approvalStatus",
              approval.status,
              approval.status === "PENDING" ? "Waiting" : approval.status.charAt(0) + approval.status.slice(1).toLowerCase(),
            )}
          </Badge>
        </li>
      ))}
    </ol>
  );
}
