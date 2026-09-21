import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ModulePage } from "@/components/modules/module-page";
import { Button } from "@/components/ui/button";
import { SkeletonTable } from "@/components/ui/loading-state";
import { inGroupWorkspace } from "@/config/workspace";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { financeExperience } from "@/lib/modules/finance/finance.workspace";
import { ExpensesList } from "./expenses-list";

export const metadata: Metadata = { title: "Expenses" };

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule("finance");

  // In the Group workspace the list asks each company for it and says so when
  // none has it (Workspace Context §76).
  const group = inGroupWorkspace(context);
  if (!group && !can(context, "finance.expense.view")) redirect("/access-denied");

  const experience = await financeExperience(context);
  const params = await searchParams;
  const archived = params.archived === "1";

  return (
    <ModulePage
      experience={experience}
      activeSection="expenses"
      actions={
        <div className="flex items-center gap-2">
          <Button asChild variant="secondary" size="sm">
            <Link href={archived ? "/finance/expenses" : "/finance/expenses?archived=1"}>
              {archived ? "Active expenses" : "Archived"}
            </Link>
          </Button>
          {!group && can(context, "finance.expense.create") ? (
            <Button asChild size="sm">
              <Link href="/finance/expenses/new">New expense</Link>
            </Button>
          ) : null}
        </div>
      }
    >
      <Suspense fallback={<SkeletonTable rows={8} />}>
        <ExpensesList
          context={context}
          searchParams={params}
          archived={archived}
          basePath="/finance/expenses"
        />
      </Suspense>
    </ModulePage>
  );
}
