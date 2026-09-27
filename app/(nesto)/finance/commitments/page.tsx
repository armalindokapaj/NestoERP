import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { redirect } from "next/navigation";
import { Handshake } from "lucide-react";

import { ListToolbar } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { CommitmentTable } from "@/components/finance/commitment-table";
import { ModulePage } from "@/components/modules/module-page";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonTable } from "@/components/ui/loading-state";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { getTranslations } from "@/lib/i18n/server";
import type { UserContext } from "@/lib/context/types";
import * as commitments from "@/lib/modules/finance/commitments/commitment.service";
import { expenseCategoryLabels } from "@/lib/modules/finance/expenses/expense.status";
import { parseCommitmentQuery } from "@/lib/modules/finance/finance.query";
import { listPageRedirect, pageHref } from "@/lib/modules/shared/list-query";
import { COMMITMENT_SORT_KEYS } from "@/lib/modules/finance/commitments/commitment.schema";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("finance");
  return { title: t("meta.commitments") };
}

type SearchParams = Record<string, string | string[] | undefined>;

export default async function CommitmentsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const context = await requireModule("finance");

  if (!can(context, "finance.commitment.view")) redirect("/access-denied");

  const t = await getTranslations("finance");
  const experience = resolveModuleExperience(context, "finance");
  const params = await searchParams;

  return (
    <ModulePage
      experience={experience}
      activeSection="commitments"
      actions={
        can(context, "finance.commitment.create") ? (
          <Button asChild size="sm">
            <Link href="/finance/commitments/new">{t("commitments.new")}</Link>
          </Button>
        ) : null
      }
    >
      <Suspense fallback={<SkeletonTable rows={6} />}>
        <CommitmentsList context={context} searchParams={params} />
      </Suspense>
    </ModulePage>
  );
}

async function CommitmentsList({
  context,
  searchParams,
}: {
  context: UserContext;
  searchParams: SearchParams;
}) {
  const t = await getTranslations("finance");
  const query = parseCommitmentQuery(searchParams);

  const [result, options] = await Promise.all([
    commitments.listCommitments(context, query),
    commitments.commitmentFilterOptions(context),
  ]);

  const hasFilters = Boolean(
    query.search || query.status?.length || query.category?.length || query.projectId || query.openOnly,
  );

  // A page past the end moves once to the last real page (AUD-08 §4, DT-05).
  if (result.pagination.page !== query.page) redirect(listPageRedirect("/finance/commitments", searchParams, result.pagination.page));
  const buildHref = (page: number) => pageHref("/finance/commitments", searchParams, page);

  return (
    <div className="space-y-4">
      <ListToolbar
        searchPlaceholder={t("commitments.search")}
        filters={[
          {
            param: "status",
            label: t("columns.status"),
            options: [
              { value: "DRAFT", label: t("recordStatus.DRAFT") },
              { value: "PENDING_APPROVAL", label: t("recordStatus.PENDING_APPROVAL") },
              { value: "APPROVED", label: t("recordStatus.APPROVED") },
              { value: "CLOSED", label: t("recordStatus.CLOSED") },
              { value: "REJECTED", label: t("recordStatus.REJECTED") },
              { value: "CANCELLED", label: t("recordStatus.CANCELLED") },
            ],
          },
          {
            param: "open",
            label: t("columns.forecast"),
            options: [{ value: "1", label: t("commitments.countsToward") }],
          },
          {
            param: "category",
            label: t("columns.category"),
            options: (Object.keys(expenseCategoryLabels) as (keyof typeof expenseCategoryLabels)[]).map((value) => ({
              value,
              label: t(`category.${value}`),
            })),
          },
          {
            param: "projectId",
            label: t("form.project"),
            options: options.projects.map((project) => ({
              value: project.id,
              label: project.name,
            })),
          },
        ]}
        sortOptions={[
          { value: "expected-asc", label: t("sort.expectedSoonest") },
          { value: "expected-desc", label: t("sort.expectedLatest") },
          { value: "amount-desc", label: t("sort.largest") },
          { value: "updated-desc", label: t("sort.updated") },
        ]}
      />

      {result.data.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={<Handshake />}
            title={t("commitments.noMatch")}
            description={t("list.noMatchBody")}
            action={{ label: t("list.clearFilters"), href: "/finance/commitments" }}
          />
        ) : (
          <EmptyState
            icon={<Handshake />}
            title={t("commitments.none")}
            description={t("commitmentForm.hint")}
            action={
              can(context, "finance.commitment.create")
                ? { label: t("commitments.new"), href: "/finance/commitments/new" }
                : undefined
            }
          />
        )
      ) : (
        <>
          <CommitmentTable commitments={result.data} sort={{ value: query.sort, keys: COMMITMENT_SORT_KEYS }} />
          <Pagination meta={result.pagination} buildHref={buildHref} />
        </>
      )}
    </div>
  );
}
