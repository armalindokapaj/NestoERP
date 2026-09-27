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
import { getTranslations } from "@/lib/i18n/server";
import { firstValue, listPageRedirect, pageHref } from "@/lib/modules/shared/list-query";
import { BUDGET_SORT_KEYS } from "@/lib/modules/finance/budgets/budget.schema";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("finance");
  return { title: t("meta.budgets") };
}

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

  const t = await getTranslations("finance");
  const experience = await financeExperience(context);
  const params = await searchParams;

  return (
    <ModulePage
      experience={experience}
      activeSection="budgets"
      actions={
        !group && can(context, "finance.budget.create") ? (
          <Button asChild size="sm">
            <Link href="/finance/budgets/new">{t("budgets.new")}</Link>
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
  const t = await getTranslations("finance");
  const query = parseBudgetQuery(searchParams);
  const group = inGroupWorkspace(context);
  const company = group ? firstValue(searchParams.company) : undefined;
  const readable = group ? await financeContexts(context, "finance.budget.view") : [];
  if (group && readable.length === 0) return <NoAccessibleData />;

  const result = await budgets.listBudgetsForWorkspace(context, query, { company });

  const hasFilters = Boolean(query.search || query.status?.length || query.currentOnly || company);

  // A page past the end moves once to the last real page (AUD-08 §4, DT-05).
  if (result.pagination.page !== query.page) redirect(listPageRedirect("/finance/budgets", searchParams, result.pagination.page));
  const buildHref = (page: number) => pageHref("/finance/budgets", searchParams, page);

  return (
    <div className="space-y-4">
      <ListToolbar
        searchPlaceholder={t("budgets.search")}
        filters={[
          ...(group ? [{ param: "company", label: t("group.company"), options: companyFilterOptions(readable) }] : []),
          {
            param: "status",
            label: t("columns.status"),
            options: [
              { value: "DRAFT", label: t("recordStatus.DRAFT") },
              { value: "PENDING_APPROVAL", label: t("recordStatus.PENDING_APPROVAL") },
              { value: "APPROVED", label: t("recordStatus.APPROVED") },
              { value: "REJECTED", label: t("recordStatus.REJECTED") },
            ],
          },
          {
            param: "current",
            label: t("budgets.version"),
            options: [{ value: "1", label: t("budgets.currentOnly") }],
          },
        ]}
        sortOptions={[
          { value: "updated-desc", label: t("sort.updated") },
          { value: "project-asc", label: t("sort.projectAz") },
          { value: "amount-desc", label: t("sort.largest") },
          { value: "version-desc", label: t("sort.latestVersion") },
        ]}
      />

      {result.data.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={<ChartPie />}
            title={t("budgets.noMatch")}
            description={t("list.noMatchBody")}
            action={{ label: t("list.clearFilters"), href: "/finance/budgets" }}
          />
        ) : (
          <EmptyState
            icon={<ChartPie />}
            title={t("budgets.none")}
            description={t("budgets.noneBody")}
            action={
              !group && can(context, "finance.budget.create")
                ? { label: t("budgets.new"), href: "/finance/budgets/new" }
                : undefined
            }
          />
        )
      ) : (
        <>
          <BudgetTable budgets={result.data} sort={{ value: query.sort, keys: BUDGET_SORT_KEYS }} />
          <Pagination meta={result.pagination} buildHref={buildHref} />
        </>
      )}
    </div>
  );
}
