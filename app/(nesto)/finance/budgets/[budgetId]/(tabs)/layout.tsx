import { BudgetActions } from "@/components/finance/budget-actions";
import { Money, Variance } from "@/components/finance/money";
import { RecordHeader } from "@/components/modules/record-header";
import { Badge } from "@/components/ui/badge";
import { getTranslations } from "@/lib/i18n/server";
import { pendingCycle } from "@/lib/modules/finance/approvals/approval.service";
import { budgetBreadcrumbs, budgetLabel, loadBudget } from "../budget-context";
import { FinanceRecordTabs } from "../../../invoices/[invoiceId]/record-tabs";

type Props = { children: React.ReactNode; params: Promise<{ budgetId: string }> };

/** The record's frame: header and tabs stay mounted while Overview, Documents and Activity swap beneath them. */
export default async function BudgetTabsLayout({ children, params }: Props) {
  const { budgetId } = await params;
  const { context, budget } = await loadBudget(budgetId);

  const may = budget.capabilities;
  const t = await getTranslations("finance");
  // The cycle the decision controls act on; they name it back (AUD-10 §4, CW-05).
  const cycle = may.canApprove || may.canReject ? await pendingCycle(context, "BUDGET", budget.id) : null;

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={await budgetBreadcrumbs(budget)}
        title={budget.name ?? budgetLabel(budget, t)}
        subtitle={t("budgets.subtitle", { project: budget.project.name, version: budget.version })}
        status={budget.status}
        badges={budget.isCurrent ? <Badge tone="info">{t("current")}</Badge> : null}
        meta={[
          {
            label: t("columns.budget"),
            value: <Money amount={budget.budgetAmount} currency={budget.currency} emphasis />,
          },
          {
            label: t("columns.forecast"),
            value: <Money amount={budget.forecastCost} currency={budget.currency} />,
          },
          {
            label: t("columns.variance"),
            value: <Variance amount={budget.variance} currency={budget.currency} />,
          },
        ]}
        actions={
          <BudgetActions budgetId={budget.id} label={budgetLabel(budget, t)} capabilities={may} cycle={cycle} />
        }
      />

      <FinanceRecordTabs
        basePath={`/finance/budgets/${budget.id}`}
        show={{ documents: may.canViewDocuments, activity: may.canViewActivity }}
      />

      {children}
    </div>
  );
}
