import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { BudgetForm } from "@/components/finance/budget-form";
import { RecordContextHeader } from "@/components/modules/record-header";
import { can } from "@/lib/access/can";
import { createBudgetAction } from "@/lib/actions/finance";
import { requireModule } from "@/lib/context/current-user";
import { prisma } from "@/lib/database/prisma";
import * as budgets from "@/lib/modules/finance/budgets/budget.service";
import { buildFinanceProjectWhere } from "@/lib/modules/finance/finance.scope";

export const metadata: Metadata = { title: "New budget" };

export default async function NewBudgetPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string }>;
}) {
  const context = await requireModule("finance");

  if (!can(context, "finance.budget.create")) redirect("/access-denied");

  const params = await searchParams;

  const projects = await prisma.project.findMany({
    where: buildFinanceProjectWhere(context),
    select: { id: true, code: true, name: true },
    orderBy: { name: "asc" },
  });

  // The query string is a claim: only a project this reader can offer is
  // preselected, and its budget is read through the finance scope — otherwise
  // `?projectId=` would confirm another company's approved budget and its
  // currency (PRD #47 §17, §40).
  const projectId = projects.some((project) => project.id === params.projectId)
    ? params.projectId
    : undefined;

  // Once a project has an approved budget its currency is settled, because its
  // costs are already recorded in it (PRD #15 §117).
  const approvedCurrency = projectId
    ? await budgets.approvedBudgetCurrency(context, projectId)
    : null;

  async function action(formData: FormData) {
    "use server";
    return createBudgetAction(formData);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <RecordContextHeader
        breadcrumbs={[
          { label: "Finance", href: "/finance" },
          { label: "Budgets", href: "/finance/budgets" },
          { label: "New budget" },
        ]}
        title="New project budget"
        subtitle="Saved as a draft. It becomes the project's current budget once approved."
      />

      <BudgetForm
        action={action}
        projects={projects.map((project) => ({
          value: project.id,
          label: `${project.name} (${project.code})`,
        }))}
        values={
          projectId
            ? {
                projectId,
                name: null,
                currency: approvedCurrency ?? "EUR",
                notes: null,
                lineItems: [],
              }
            : undefined
        }
        lockedCurrency={approvedCurrency}
        cancelHref="/finance/budgets"
        submitLabel="Create budget"
        pendingLabel="Creating…"
      />
    </div>
  );
}
