import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { History } from "lucide-react";

import { Pagination } from "@/components/data/pagination";
import { RecordContextHeader } from "@/components/modules/record-header";
import { PersonLink } from "@/components/people/person-link";
import { EmptyState } from "@/components/ui/empty-state";
import { listRecordActivity } from "@/lib/modules/finance/finance.activity";
import { listPageRedirect } from "@/lib/modules/shared/list-query";
import { formatDateTime } from "@/lib/utils/format";
import { expenseBreadcrumbs, expenseLabel, loadExpense } from "../expense-context";
import { FinanceRecordTabs } from "../../../invoices/[invoiceId]/record-tabs";
import { getTranslations } from "@/lib/i18n/server";

type Params = {
  params: Promise<{ expenseId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("finance");
  return { title: t("meta.expenseActivity") };
}

export default async function ExpenseActivityPage({ params, searchParams }: Params) {
  const t = await getTranslations("finance");
  const { expenseId } = await params;
  const { context, expense } = await loadExpense(expenseId);

  if (!expense.capabilities.canViewActivity) notFound();

  const query = await searchParams;
  const pageValue = Number.parseInt(typeof query.page === "string" ? query.page : "1", 10);
  const page = Number.isFinite(pageValue) && pageValue > 0 ? pageValue : 1;

  const activity = await listRecordActivity(context, "Expense", expenseId, { page, limit: 25 });
  // A page past the end moves once to the last real page (AUD-08 §4, DT-05).
  if (activity.pagination.page !== page) redirect(listPageRedirect(`/finance/expenses/${expense.id}/activity`, query, activity.pagination.page));

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={await expenseBreadcrumbs(expense, t("crumbs.activity"))}
        title={expenseLabel(expense)}
        status={expense.status}
      />

      <FinanceRecordTabs
        basePath={`/finance/expenses/${expense.id}`}
        active="activity"
        show={{ documents: expense.capabilities.canViewDocuments, activity: true }}
      />

      {activity.data.length === 0 ? (
        <EmptyState
          icon={<History />}
          title={t("activity.empty")}
          description={t("activity.expenseBody")}
        />
      ) : (
        <>
          <ol className="nesto-card divide-y divide-line">
            {activity.data.map((entry) => (
              <li key={entry.id} className="px-5 py-4">
                <p className="text-table text-fg">
                  {entry.actor ? <PersonLink memberId={entry.actorMemberId} name={entry.actor} /> : <span className="font-medium">{t("activity.someone")}</span>}{" "}
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
                ? `/finance/expenses/${expense.id}/activity?page=${next}`
                : `/finance/expenses/${expense.id}/activity`
            }
          />
        </>
      )}
    </div>
  );
}
