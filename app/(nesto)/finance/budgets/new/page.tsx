import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { BudgetForm } from "@/components/finance/budget-form";
import { RecordContextHeader } from "@/components/modules/record-header";
import { can } from "@/lib/access/can";
import { createBudgetAction } from "@/lib/actions/finance";
import { requireModule } from "@/lib/context/current-user";
import { prisma } from "@/lib/database/prisma";
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

  // Once a project has an approved budget its currency is settled, because its
  // costs are already recorded in it (PRD #15 §117).
  const approved = params.projectId
    ? await prisma.projectBudget.findFirst({
        where: { projectId: params.projectId, status: "APPROVED" },
        select: { currency: true },
      })
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
          params.projectId
            ? {
                projectId: params.projectId,
                name: null,
                currency: approved?.currency ?? "EUR",
                notes: null,
                lineItems: [],
              }
            : undefined
        }
        lockedCurrency={approved?.currency ?? null}
        cancelHref="/finance/budgets"
        submitLabel="Create budget"
        pendingLabel="Creating…"
      />
    </div>
  );
}
