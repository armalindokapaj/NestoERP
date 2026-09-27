import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ExpenseForm } from "@/components/finance/expense-form";
import { RecordContextHeader } from "@/components/modules/record-header";
import { updateExpenseAction } from "@/lib/actions/finance";
import { prisma } from "@/lib/database/prisma";
import {
  buildFinanceProjectWhere,
  hasCompanyFinanceScope,
} from "@/lib/modules/finance/finance.scope";
import { expenseBreadcrumbs, expenseLabel, loadExpense } from "../expense-context";
import { getTranslations } from "@/lib/i18n/server";

type Params = { params: Promise<{ expenseId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("finance");
  return { title: t("meta.expenseEdit") };
}

export default async function EditExpensePage({ params }: Params) {
  const t = await getTranslations("finance");
  const { expenseId } = await params;
  const { context, expense } = await loadExpense(expenseId);

  // Approved cost is fixed, so the form is never rendered for it.
  if (!expense.capabilities.canEdit) redirect(`/finance/expenses/${expenseId}`);

  const projects = await prisma.project.findMany({
    where: buildFinanceProjectWhere(context),
    select: { id: true, code: true, name: true },
    orderBy: { name: "asc" },
  });

  async function action(formData: FormData) {
    "use server";
    return updateExpenseAction(expenseId, formData);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <RecordContextHeader
        breadcrumbs={await expenseBreadcrumbs(expense, t("crumbs.edit"))}
        title={t("edit.title", { label: expenseLabel(expense) })}
        status={expense.status}
      />

      <ExpenseForm
        action={action}
        projects={projects.map((project) => ({
          value: project.id,
          label: `${project.name} (${project.code})`,
        }))}
        canCreateCompanyWide={hasCompanyFinanceScope(context)}
        values={{
          expenseNumber: expense.expenseNumber,
          projectId: expense.project?.id ?? null,
          expenseDate: expense.expenseDate,
          category: expense.category,
          description: expense.description,
          payeeName: expense.payeeName,
          currency: expense.currency,
          netAmount: expense.netAmount,
          taxAmount: expense.taxAmount,
          notes: expense.notes,
        }}
        versionUpdatedAt={expense.updatedAt}
        cancelHref={`/finance/expenses/${expense.id}`}
        submitLabel={t("edit.save")}
        pendingLabel={t("settings.saving")}
      />
    </div>
  );
}
