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
import type { UserContext } from "@/lib/context/types";
import * as commitments from "@/lib/modules/finance/commitments/commitment.service";
import { expenseCategoryLabels } from "@/lib/modules/finance/expenses/expense.status";
import { parseCommitmentQuery } from "@/lib/modules/finance/finance.query";

export const metadata: Metadata = { title: "Commitments" };

type SearchParams = Record<string, string | string[] | undefined>;

export default async function CommitmentsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const context = await requireModule("finance");

  if (!can(context, "finance.commitment.view")) redirect("/access-denied");

  const experience = resolveModuleExperience(context, "finance");
  const params = await searchParams;

  return (
    <ModulePage
      experience={experience}
      activeSection="commitments"
      actions={
        can(context, "finance.commitment.create") ? (
          <Button asChild size="sm">
            <Link href="/finance/commitments/new">New commitment</Link>
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
  const query = parseCommitmentQuery(searchParams);

  const [result, options] = await Promise.all([
    commitments.listCommitments(context, query),
    commitments.commitmentFilterOptions(context),
  ]);

  const hasFilters = Boolean(
    query.search || query.status?.length || query.category?.length || query.projectId || query.openOnly,
  );

  function buildHref(page: number) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (typeof value === "string" && key !== "page") params.set(key, value);
    }
    if (page > 1) params.set("page", String(page));
    const search = params.toString();
    return search ? `/finance/commitments?${search}` : "/finance/commitments";
  }

  return (
    <div className="space-y-4">
      <ListToolbar
        searchPlaceholder="Search description, counterparty or reference…"
        filters={[
          {
            param: "status",
            label: "Status",
            options: [
              { value: "DRAFT", label: "Draft" },
              { value: "PENDING_APPROVAL", label: "Pending approval" },
              { value: "APPROVED", label: "Approved" },
              { value: "CLOSED", label: "Closed" },
              { value: "REJECTED", label: "Rejected" },
              { value: "CANCELLED", label: "Cancelled" },
            ],
          },
          {
            param: "open",
            label: "Forecast",
            options: [{ value: "1", label: "Counts toward forecast" }],
          },
          {
            param: "category",
            label: "Category",
            options: Object.entries(expenseCategoryLabels).map(([value, label]) => ({
              value,
              label,
            })),
          },
          {
            param: "projectId",
            label: "Project",
            options: options.projects.map((project) => ({
              value: project.id,
              label: project.name,
            })),
          },
        ]}
        sortOptions={[
          { value: "expected-asc", label: "Expected soonest" },
          { value: "expected-desc", label: "Expected latest" },
          { value: "amount-desc", label: "Largest first" },
          { value: "updated-desc", label: "Recently updated" },
        ]}
      />

      {result.data.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={<Handshake />}
            title="No commitments match these filters."
            description="Adjust or clear the filters to see more."
            action={{ label: "Clear filters", href: "/finance/commitments" }}
          />
        ) : (
          <EmptyState
            icon={<Handshake />}
            title="No commitments yet."
            description="Money the company has undertaken to spend, but has not yet incurred."
            action={
              can(context, "finance.commitment.create")
                ? { label: "New commitment", href: "/finance/commitments/new" }
                : undefined
            }
          />
        )
      ) : (
        <>
          <CommitmentTable commitments={result.data} />
          <Pagination meta={result.pagination} buildHref={buildHref} />
        </>
      )}
    </div>
  );
}
