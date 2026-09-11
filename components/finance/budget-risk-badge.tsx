import { Badge } from "@/components/ui/badge";
import { budgetRiskLabels, type BudgetRisk } from "@/lib/modules/finance/budgets/budget.status";

/**
 * Budget risk (PRD #15 §123).
 *
 * Display logic over the forecast, not a stored status: a project does not
 * "become" critical, its forecast does — and that changes with every approved
 * expense. The percentage is always shown beside the badge, so the colour is
 * never the only thing carrying the meaning (PRD #15 §320).
 */
const TONES: Record<BudgetRisk, "success" | "warning" | "danger"> = {
  GREEN: "success",
  WARNING: "warning",
  CRITICAL: "danger",
};

export function BudgetRiskBadge({
  risk,
  utilizationPercent,
}: {
  risk: BudgetRisk | null;
  utilizationPercent: string | null;
}) {
  if (!risk) return <span className="text-fg-subtle">No approved budget</span>;

  return (
    <span className="inline-flex items-center gap-2">
      <Badge tone={TONES[risk]}>{budgetRiskLabels[risk]}</Badge>
      {utilizationPercent ? (
        <span className="tabular-nums text-meta text-fg-muted">{utilizationPercent}%</span>
      ) : null}
    </span>
  );
}
