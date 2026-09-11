import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChartPie } from "lucide-react";

import { ListToolbar } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { BudgetTable } from "@/components/finance/budget-table";
import { ModulePage } from "@/components/modules/module-page";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonTable } from "@/components/ui/loading-state";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import type { UserContext } from "@/lib/context/types";
import * as budgets from "@/lib/modules/finance/budgets/budget.service";
import { parseBudgetQuery } from "@/lib/modules/finance/finance.query";

export const metadata: Metadata = { title: "Budgets" };

type SearchParams = Record<string, string | string[] | undefined>;

export default async function BudgetsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const context = await requireModule("finance");

  if (!can(context, "finance.budget.view")) redirect("/access-denied");

  const experience = resolveModuleExperience(context, "finance");
  const params = await searchParams;

  return (
    <ModulePage
      experience={experience}
      activeSection="budgets"
      actions={
        can(context, "finance.budget.create") ? (
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

/** Budgets, with the project's real actual and forecast beside each version. */
async function BudgetsList({
  context,
  searchParams,
}: {
  context: UserContext;
  searchParams: SearchParams;
}) {
  const query = parseBudgetQuery(searchParams);
  const result = await budgets.listBudgets(context, query);

  const hasFilters = Boolean(query.search || query.status?.length || query.currentOnly);

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
              can(context, "finance.budget.create")
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
