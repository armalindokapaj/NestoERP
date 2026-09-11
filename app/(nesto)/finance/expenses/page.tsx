import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ModulePage } from "@/components/modules/module-page";
import { Button } from "@/components/ui/button";
import { SkeletonTable } from "@/components/ui/loading-state";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { ExpensesList } from "./expenses-list";

export const metadata: Metadata = { title: "Expenses" };

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule("finance");

  if (!can(context, "finance.expense.view")) redirect("/access-denied");

  const experience = resolveModuleExperience(context, "finance");
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
          {can(context, "finance.expense.create") ? (
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
