import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ExpenseForm } from "@/components/finance/expense-form";
import { RecordContextHeader } from "@/components/modules/record-header";
import { can } from "@/lib/access/can";
import { createExpenseAction } from "@/lib/actions/finance";
import { requireModule } from "@/lib/context/current-user";
import { prisma } from "@/lib/database/prisma";
import { buildFinanceProjectWhere, hasCompanyFinanceScope } from "@/lib/modules/finance/finance.scope";

export const metadata: Metadata = { title: "New expense" };

export default async function NewExpensePage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string }>;
}) {
  const context = await requireModule("finance");

  if (!can(context, "finance.expense.create")) redirect("/access-denied");

  const params = await searchParams;
  const projects = await prisma.project.findMany({
    where: buildFinanceProjectWhere(context),
    select: { id: true, code: true, name: true },
    orderBy: { name: "asc" },
  });

  async function action(formData: FormData) {
    "use server";
    return createExpenseAction(formData);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <RecordContextHeader
        breadcrumbs={[
          { label: "Finance", href: "/finance" },
          { label: "Expenses", href: "/finance/expenses" },
          { label: "New expense" },
        ]}
        title="New expense"
        subtitle="Saved as a draft. It becomes actual cost once it has been approved."
      />

      <ExpenseForm
        action={action}
        projects={projects.map((project) => ({
          value: project.id,
          label: `${project.name} (${project.code})`,
        }))}
        canCreateCompanyWide={hasCompanyFinanceScope(context)}
        values={
          params.projectId
            ? {
                expenseNumber: null,
                projectId: params.projectId,
                expenseDate: new Date().toISOString().slice(0, 10),
                category: "MATERIALS",
                description: "",
                payeeName: null,
                currency: "EUR",
                netAmount: "0",
                taxAmount: "0",
                notes: null,
              }
            : undefined
        }
        cancelHref="/finance/expenses"
        submitLabel="Create expense"
        pendingLabel="Creating…"
      />
    </div>
  );
}
