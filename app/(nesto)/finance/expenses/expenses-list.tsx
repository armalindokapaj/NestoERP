import { Receipt } from "lucide-react";

import { ListToolbar, type FilterConfig } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { ExpenseTable } from "@/components/finance/expense-table";
import { NoAccessibleData } from "@/components/finance/group-rows";
import { EmptyState } from "@/components/ui/empty-state";
import { inGroupWorkspace } from "@/config/workspace";
import { can } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";
import { parseExpenseQuery } from "@/lib/modules/finance/finance.query";
import { companyFilterOptions, financeContexts } from "@/lib/modules/finance/finance.workspace";
import { expenseCurrenciesAcross, expenseFilterOptions } from "@/lib/modules/finance/expenses/expense.repository";
import { expenseCategoryLabels } from "@/lib/modules/finance/expenses/expense.status";
import * as expenses from "@/lib/modules/finance/expenses/expense.service";
import { firstValue } from "@/lib/modules/shared/list-query";

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * The expense list (PRD #15 §167, §168).
 *
 * In the Group workspace it is the expenses of every company the reader may
 * open Finance in, with a Company filter over those companies (§36, §86); a
 * project belongs to one company, so that filter is a company workspace's.
 */
export async function ExpensesList({
  context,
  searchParams,
  archived = false,
  basePath,
}: {
  context: UserContext;
  searchParams: SearchParams;
  archived?: boolean;
  basePath: string;
}) {
  const query = parseExpenseQuery(searchParams, archived ? { archived: true } : {});
  const group = inGroupWorkspace(context);
  const company = group ? firstValue(searchParams.company) : undefined;
  const readable = group ? await financeContexts(context, "finance.expense.view") : [];
  if (group && readable.length === 0) return <NoAccessibleData />;

  const [result, options] = await Promise.all([
    expenses.listExpensesForWorkspace(context, query, { company }),
    group
      ? expenseCurrenciesAcross(readable).then((currencies) => ({ projects: [], currencies }))
      : expenseFilterOptions(context),
  ]);

  const hasFilters = Boolean(
    query.search ||
      query.status?.length ||
      query.settlement?.length ||
      query.category?.length ||
      query.projectId ||
      query.currency ||
      company,
  );

  const filters: FilterConfig[] = [
    ...(group ? [{ param: "company", label: "Company", options: companyFilterOptions(readable) }] : []),
    ...(archived
      ? []
      : [
          {
            param: "status",
            label: "Status",
            options: [
              { value: "DRAFT", label: "Draft" },
              { value: "PENDING_APPROVAL", label: "Pending approval" },
              { value: "APPROVED", label: "Approved" },
              { value: "REJECTED", label: "Rejected" },
              { value: "CANCELLED", label: "Cancelled" },
            ],
          },
        ]),
    {
      param: "category",
      label: "Category",
      options: Object.entries(expenseCategoryLabels).map(([value, label]) => ({ value, label })),
    },
    {
      param: "settlement",
      label: "Paid",
      options: [
        { value: "UNPAID", label: "Unpaid" },
        { value: "PARTIALLY_PAID", label: "Partially paid" },
        { value: "PAID", label: "Paid" },
      ],
    },
    ...(group
      ? []
      : [
          {
            param: "projectId",
            label: "Project",
            options: options.projects.map((project) => ({ value: project.id, label: project.name })),
          },
        ]),
    ...(options.currencies.length > 1
      ? [
          {
            param: "currency",
            label: "Currency",
            options: options.currencies.map((code) => ({ value: code, label: code })),
          },
        ]
      : []),
  ];

  function buildHref(page: number) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (typeof value === "string" && key !== "page") params.set(key, value);
    }
    if (page > 1) params.set("page", String(page));
    const search = params.toString();
    return search ? `${basePath}?${search}` : basePath;
  }

  return (
    <div className="space-y-4">
      <ListToolbar
        searchPlaceholder="Search description, payee or project…"
        filters={filters}
        sortOptions={[
          { value: "date-desc", label: "Newest first" },
          { value: "date-asc", label: "Oldest first" },
          { value: "amount-desc", label: "Largest first" },
          { value: "amount-asc", label: "Smallest first" },
          { value: "updated-desc", label: "Recently updated" },
        ]}
      />

      {result.data.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={<Receipt />}
            title="No expenses match these filters."
            description="Adjust or clear the filters to see more."
            action={{ label: "Clear filters", href: basePath }}
          />
        ) : (
          <EmptyState
            icon={<Receipt />}
            title={archived ? "No archived expenses." : "No expenses yet."}
            description={
              archived
                ? "Expenses removed from active lists will appear here."
                : "Costs you can see will appear here."
            }
            action={
              !archived && !group && can(context, "finance.expense.create")
                ? { label: "New expense", href: "/finance/expenses/new" }
                : undefined
            }
          />
        )
      ) : (
        <>
          <ExpenseTable expenses={result.data} />
          <Pagination meta={result.pagination} buildHref={buildHref} />
        </>
      )}
    </div>
  );
}
