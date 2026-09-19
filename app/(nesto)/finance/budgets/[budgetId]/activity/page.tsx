import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { History } from "lucide-react";

import { Pagination } from "@/components/data/pagination";
import { RecordContextHeader } from "@/components/modules/record-header";
import { PersonLink } from "@/components/people/person-link";
import { EmptyState } from "@/components/ui/empty-state";
import { listRecordActivity } from "@/lib/modules/finance/finance.activity";
import { formatDateTime } from "@/lib/utils/format";
import { budgetBreadcrumbs, budgetLabel, loadBudget } from "../budget-context";
import { FinanceRecordTabs } from "../../../invoices/[invoiceId]/record-tabs";

type Params = {
  params: Promise<{ budgetId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const metadata: Metadata = { title: "Budget activity" };

export default async function BudgetActivityPage({ params, searchParams }: Params) {
  const { budgetId } = await params;
  const { context, budget } = await loadBudget(budgetId);

  if (!budget.capabilities.canViewActivity) notFound();

  const query = await searchParams;
  const pageValue = Number.parseInt(typeof query.page === "string" ? query.page : "1", 10);
  const page = Number.isFinite(pageValue) && pageValue > 0 ? pageValue : 1;

  const activity = await listRecordActivity(context, "ProjectBudget", budgetId, {
    page,
    limit: 25,
  });

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={budgetBreadcrumbs(budget, "Activity")}
        title={budgetLabel(budget)}
        subtitle={budget.project.name}
        status={budget.status}
      />

      <FinanceRecordTabs
        basePath={`/finance/budgets/${budget.id}`}
        active="activity"
        show={{ documents: budget.capabilities.canViewDocuments, activity: true }}
      />

      {activity.data.length === 0 ? (
        <EmptyState
          icon={<History />}
          title="No activity recorded yet."
          description="Changes to this budget version will be listed here."
        />
      ) : (
        <>
          <ol className="nesto-card divide-y divide-line">
            {activity.data.map((entry) => (
              <li key={entry.id} className="px-5 py-4">
                <p className="text-table text-fg">
                  {entry.actor ? <PersonLink memberId={entry.actorMemberId} name={entry.actor} /> : <span className="font-medium">Someone</span>}{" "}
                  {entry.message ?? entry.action}
                </p>
                <p className="mt-0.5 text-meta text-fg-subtle">
                  {formatDateTime(entry.createdAt)}
                </p>
              </li>
            ))}
          </ol>
          <Pagination
            meta={activity.pagination}
            buildHref={(next) =>
              next > 1
                ? `/finance/budgets/${budget.id}/activity?page=${next}`
                : `/finance/budgets/${budget.id}/activity`
            }
          />
        </>
      )}
    </div>
  );
}
