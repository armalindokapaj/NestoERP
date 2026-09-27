import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ExpenseForm } from "@/components/finance/expense-form";
import { RecordContextHeader } from "@/components/modules/record-header";
import { can } from "@/lib/access/can";
import { createExpenseAction } from "@/lib/actions/finance";
import { requireModule } from "@/lib/context/current-user";
import { prisma } from "@/lib/database/prisma";
import { buildFinanceProjectWhere, hasCompanyFinanceScope } from "@/lib/modules/finance/finance.scope";
import { baseCurrency, companyToday } from "@/lib/modules/finance/finance.settings";

export const metadata: Metadata = { title: "New expense" };

export default async function NewExpensePage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string }>;
}) {
  const context = await requireModule("finance");

  if (!can(context, "finance.expense.create")) redirect("/access-denied");

  const params = await searchParams;
  const [projects, currency, today] = await Promise.all([
    prisma.project.findMany({
      where: buildFinanceProjectWhere(context),
      select: { id: true, code: true, name: true },
      orderBy: { name: "asc" },
    }),
    baseCurrency(context.companyId),
    companyToday(context.companyId),
  ]);

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
        subtitle="Saved as a draft. It becomes actual cost once it has been approved. Attach the receipt from the expense’s Documents tab once it is saved."
      />

      <ExpenseForm
        action={action}
        projects={projects.map((project) => ({
          value: project.id,
          label: `${project.name} (${project.code})`,
        }))}
        canCreateCompanyWide={hasCompanyFinanceScope(context)}
        defaultCurrency={currency}
        today={today}
        values={
          params.projectId
            ? {
                expenseNumber: null,
                projectId: params.projectId,
                expenseDate: today,
                category: "MATERIALS",
                description: "",
                payeeName: null,
                currency,
                netAmount: "",
                taxAmount: "",
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
