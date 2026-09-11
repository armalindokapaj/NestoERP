import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2 } from "lucide-react";

import { ModulePage } from "@/components/modules/module-page";
import { DepartmentTable } from "@/components/team/department-table";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import * as departments from "@/lib/modules/team/departments/department.service";

export const metadata: Metadata = { title: "Departments" };

/**
 * Departments (PRD #14 §34, §112).
 *
 * A static route rather than a `[section]` segment: Team also has
 * `/team/[memberId]`, and Next.js will not accept two different slug names at
 * the same position.
 */
export default async function TeamDepartmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
  const context = await requireModule("team");

  if (!can(context, "team.department.view")) redirect("/access-denied");

  const experience = resolveModuleExperience(context, "team");
  const { archived } = await searchParams;
  const includeArchived = archived === "1";

  const rows = await departments.listDepartments(context, { includeArchived });
  const canCreate = can(context, "team.department.create");

  return (
    <ModulePage
      experience={experience}
      activeSection="departments"
      actions={
        <div className="flex items-center gap-2">
          <Button asChild variant="secondary" size="sm">
            <Link href={includeArchived ? "/team/departments" : "/team/departments?archived=1"}>
              {includeArchived ? "Hide archived" : "Show archived"}
            </Link>
          </Button>
          {canCreate ? (
            <Button asChild size="sm">
              <Link href="/team/departments/new">New department</Link>
            </Button>
          ) : null}
        </div>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<Building2 />}
          title={includeArchived ? "No departments." : "No departments yet."}
          description="Departments group people for reporting and for department-scoped access."
          action={
            canCreate ? { label: "New department", href: "/team/departments/new" } : undefined
          }
        />
      ) : (
        <DepartmentTable
          departments={rows}
          canUpdate={can(context, "team.department.update")}
          canArchive={can(context, "team.department.archive")}
          canRestore={can(context, "team.department.restore")}
        />
      )}
    </ModulePage>
  );
}
