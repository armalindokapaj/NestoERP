import { Receipt } from "lucide-react";
import { ZodError } from "zod";

import { ListToolbar, type FilterConfig } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { ExpenseTable } from "@/components/finance/expense-table";
import { NoAccessibleData } from "@/components/finance/group-rows";
import { RegisterExportButton } from "@/components/finance/register-export-button";
import { combinedOption, InvalidRegisterFilters, registerHref } from "@/components/finance/register-filters";
import { CanonicalUrl, RegisterResults } from "@/components/finance/register-results";
import { RegisterSummary } from "@/components/finance/register-summary";
import { EmptyState } from "@/components/ui/empty-state";
import { inGroupWorkspace } from "@/config/workspace";
import { can } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";
import type { ExpenseListQuery } from "@/lib/modules/finance/expenses/expense.schema";
import { canonicalExpenseSearch, parseExpenseQuery, searchString } from "@/lib/modules/finance/finance.query";
import { companyFilterOptions, financeContexts, financeExportEligibility } from "@/lib/modules/finance/finance.workspace";
import { expenseCurrenciesAcross, expenseFilterOptions } from "@/lib/modules/finance/expenses/expense.repository";
import { expenseCategoryLabels, expenseStatusLabels } from "@/lib/modules/finance/expenses/expense.status";
import * as expenses from "@/lib/modules/finance/expenses/expense.service";
import { settlementLabels } from "@/lib/modules/finance/invoices/invoice.status";
import { firstValue } from "@/lib/modules/shared/list-query";
import { EXPENSE_SORT_KEYS } from "@/lib/modules/finance/expenses/expense.schema";

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * The expense list (PRD #15 §167, §168; AUD-01).
 *
 * In the Group workspace it is the expenses of every company the reader may
 * open Finance in, with a Company filter over those companies (§36, §86); a
 * project belongs to one company, so that filter is a company workspace's.
 *
 * Every filter — settlement included — is applied by the database before the
 * count, the filtered totals and the page (AUD-01 §4-§6).
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
  const group = inGroupWorkspace(context);
  const company = group ? firstValue(searchParams.company) : undefined;
  const readable = group ? await financeContexts(context, "finance.expense.view") : [];
  if (group && readable.length === 0) return <NoAccessibleData />;

  // A date that is not a date, or a range that ends before it starts, is said
  // so rather than ignored (AUD-01 §5.1).
  let query: ExpenseListQuery;
  try {
    query = parseExpenseQuery(searchParams, archived ? { archived: true } : {});
  } catch (error) {
    if (error instanceof ZodError) return <InvalidRegisterFilters href={registerHref(basePath, archived)} />;
    throw error;
  }

  const [result, options, eligibility] = await Promise.all([
    expenses.listExpensesForWorkspace(context, query, { company }),
    group
      ? expenseCurrenciesAcross(readable).then((currencies) => ({ projects: [], currencies }))
      : expenseFilterOptions(context),
    financeExportEligibility(context, "finance.expense.view", company),
  ]);

  const hasFilters = Boolean(
    query.search ||
      (!archived && query.status?.length) ||
      query.settlement?.length ||
      query.category?.length ||
      query.projectId ||
      query.currency ||
      query.incurredFrom ||
      query.incurredTo ||
      company,
  );

  const statusOptions = (["DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED", "CANCELLED"] as const).map((value) => ({
    value,
    label: expenseStatusLabels[value],
  }));
  const categoryOptions = Object.entries(expenseCategoryLabels).map(([value, label]) => ({ value, label }));
  const settlementOptions = (["UNPAID", "PARTIALLY_PAID", "PAID"] as const).map((value) => ({
    value,
    label: settlementLabels[value],
  }));

  const filters: FilterConfig[] = [
    ...(group ? [{ param: "company", label: "Company", options: companyFilterOptions(readable) }] : []),
    ...(archived ? [] : [{ param: "status", label: "Status", options: combinedOption(statusOptions, query.status) }]),
    { param: "category", label: "Category", options: combinedOption(categoryOptions, query.category) },
    { param: "settlement", label: "Paid", options: combinedOption(settlementOptions, query.settlement) },
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

  // The list that ran, as an address: the page it landed on, the filters as understood (AUD-01 §5.2).
  const canonical = canonicalExpenseSearch(searchParams, query, result.pagination.page);
  const canonicalParams = new URLSearchParams(canonical);
  function buildHref(page: number) {
    const params = new URLSearchParams(canonicalParams);
    if (page > 1) params.set("page", String(page));
    else params.delete("page");
    const search = params.toString();
    return search ? `${basePath}?${search}` : basePath;
  }

  const empty = result.data.length === 0;

  return (
    <div className="space-y-4">
      {canonical !== searchString(searchParams) ? <CanonicalUrl href={canonical ? `${basePath}?${canonical}` : basePath} /> : null}
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

      <RegisterResults>
        {!empty || hasFilters ? (
          <div className="flex flex-wrap items-start justify-between gap-3">
            <RegisterSummary summary={result.summary} register="expenses" />
            <RegisterExportButton endpoint="/api/finance/expenses/export" matchingCount={result.summary.matchingCount} eligibility={eligibility} />
          </div>
        ) : null}

        {empty ? (
          hasFilters ? (
            <EmptyState
              icon={<Receipt />}
              title="No expenses match these filters."
              description="Adjust or clear the filters to see more."
              action={{ label: "Clear filters", href: registerHref(basePath, archived) }}
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
            <ExpenseTable expenses={result.data} sort={{ value: query.sort, keys: EXPENSE_SORT_KEYS }} />
            <Pagination meta={result.pagination} buildHref={buildHref} />
          </>
        )}
      </RegisterResults>
    </div>
  );
}
