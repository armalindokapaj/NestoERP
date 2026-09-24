import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { redirect } from "next/navigation";
import { ChartPie } from "lucide-react";

import { ListToolbar } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { BudgetTable } from "@/components/finance/budget-table";
import { ModulePage } from "@/components/modules/module-page";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonTable } from "@/components/ui/loading-state";
import { NoAccessibleData } from "@/components/finance/group-rows";
import { inGroupWorkspace } from "@/config/workspace";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import type { UserContext } from "@/lib/context/types";
import * as budgets from "@/lib/modules/finance/budgets/budget.service";
import { parseBudgetQuery } from "@/lib/modules/finance/finance.query";
import { companyFilterOptions, financeContexts, financeExperience } from "@/lib/modules/finance/finance.workspace";
import { firstValue } from "@/lib/modules/shared/list-query";

export const metadata: Metadata = { title: "Budgets" };

type SearchParams = Record<string, string | string[] | undefined>;

export default async function BudgetsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const context = await requireModule("finance");

  // In the Group workspace the list asks each company for it and says so when
  // none has it (Workspace Context §76).
  const group = inGroupWorkspace(context);
  if (!group && !can(context, "finance.budget.view")) redirect("/access-denied");

  const experience = await financeExperience(context);
  const params = await searchParams;

  return (
    <ModulePage
      experience={experience}
      activeSection="budgets"
      actions={
        !group && can(context, "finance.budget.create") ? (
          <Button asChild size="sm">
            <Link href="/finance/budgets/new">New budget</Link>
          </Button>
        ) : null
      }
    >
      <Suspense fallback={<SkeletonTable rows={6} />}>
        <BudgetsList context={context} searchParams={params} />
      </Suspense>
    </ModulePage>
  );
}

/**
 * Budgets, with the project's real actual and forecast beside each version.
 *
 * In the Group workspace it is the budgets of every company the reader may open
 * budgets in, each in its own currency, with a Company filter over those
 * companies (Workspace Context §36, §86).
 */
async function BudgetsList({
  context,
  searchParams,
}: {
  context: UserContext;
  searchParams: SearchParams;
}) {
  const query = parseBudgetQuery(searchParams);
  const group = inGroupWorkspace(context);
  const company = group ? firstValue(searchParams.company) : undefined;
  const readable = group ? await financeContexts(context, "finance.budget.view") : [];
  if (group && readable.length === 0) return <NoAccessibleData />;

  const result = await budgets.listBudgetsForWorkspace(context, query, { company });

  const hasFilters = Boolean(query.search || query.status?.length || query.currentOnly || company);

  function buildHref(page: number) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (typeof value === "string" && key !== "page") params.set(key, value);
    }
    if (page > 1) params.set("page", String(page));
    const search = params.toString();
    return search ? `/finance/budgets?${search}` : "/finance/budgets";
  }

  return (
    <div className="space-y-4">
      <ListToolbar
        searchPlaceholder="Search project or budget name…"
        filters={[
          ...(group ? [{ param: "company", label: "Company", options: companyFilterOptions(readable) }] : []),
          {
            param: "status",
            label: "Status",
            options: [
              { value: "DRAFT", label: "Draft" },
              { value: "PENDING_APPROVAL", label: "Pending approval" },
              { value: "APPROVED", label: "Approved" },
              { value: "REJECTED", label: "Rejected" },
            ],
          },
          {
            param: "current",
            label: "Version",
            options: [{ value: "1", label: "Current only" }],
          },
        ]}
        sortOptions={[
          { value: "updated-desc", label: "Recently updated" },
          { value: "project-asc", label: "Project A–Z" },
          { value: "amount-desc", label: "Largest first" },
          { value: "version-desc", label: "Latest version" },
        ]}
      />

      {result.data.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={<ChartPie />}
            title="No budgets match these filters."
            description="Adjust or clear the filters to see more."
            action={{ label: "Clear filters", href: "/finance/budgets" }}
          />
        ) : (
          <EmptyState
            icon={<ChartPie />}
            title="No project budgets yet."
            description="A budget is what every variance figure on a project is measured against."
            action={
              !group && can(context, "finance.budget.create")
                ? { label: "New budget", href: "/finance/budgets/new" }
                : undefined
            }
          />
        )
      ) : (
        <>
          <BudgetTable budgets={result.data} />
          <Pagination meta={result.pagination} buildHref={buildHref} />
        </>
      )}
    </div>
  );
}
