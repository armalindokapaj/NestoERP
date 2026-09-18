import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { HrExportLink } from "@/components/hr/export-link";
import { ModulePage } from "@/components/modules/module-page";
import { Button } from "@/components/ui/button";
import { SkeletonTable } from "@/components/ui/loading-state";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { employmentIdForMember } from "@/lib/modules/hr/employees/employee.service";
import { hrScopeKind } from "@/lib/modules/hr/hr.scope";
import { EmployeesList } from "./employees-list";

export const metadata: Metadata = { title: "Employees" };

/**
 * The employee directory (PRD #16 §39).
 *
 * Somebody who can only ever see themselves never reaches this list: the tab
 * they followed says "My employment", and a directory of one is not a
 * directory — so it leads straight to their own record (PRD #16 §11).
 */
export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule("hr");

  const own = await employmentIdForMember(context, context.membershipId);
  if (!can(context, "hr.employee.view")) {
    if (own) redirect(`/hr/employees/${own}`);
    redirect("/access-denied");
  }

  if (hrScopeKind(context) === "SELF" && own) {
    redirect(`/hr/employees/${own}`);
  }

  const experience = resolveModuleExperience(context, "hr");
  const params = await searchParams;

  return (
    <ModulePage
      experience={experience}
      activeSection="employees"
      actions={
        <div className="flex items-center gap-2">
          {can(context, "hr.export") ? <HrExportLink type="employees" /> : null}
          {can(context, "hr.employee.import") ? (
            <Button asChild size="sm" variant="secondary">
              <Link href="/hr/employees/import">Import</Link>
            </Button>
          ) : null}
          {can(context, "hr.employee.create_profile") ? (
            <Button asChild size="sm">
              <Link href="/hr/employees/new">Add employment record</Link>
            </Button>
          ) : null}
        </div>
      }
    >
      {/* Below the guard, so an unauthorised request is refused by the response
          itself rather than streamed a 200 (PRD #16 §313). */}
      <Suspense fallback={<SkeletonTable rows={8} />}>
        <EmployeesList context={context} searchParams={params} />
      </Suspense>
    </ModulePage>
  );
}
