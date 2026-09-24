import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
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
 * The company's departments (PRD #14 §34, §112; E-13 §39).
 *
 * Read here; activated, deactivated and staffed from Organization, where the
 * group's departments live (ADR 0003). A static route rather than a
 * `[section]` segment: Team also has `/team/[memberId]`, and Next.js will not
 * accept two different slug names at the same position.
 */
export default async function TeamDepartmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ inactive?: string }>;
}) {
  const context = await requireModule("team");

  if (!can(context, "team.department.view")) redirect("/access-denied");

  const experience = resolveModuleExperience(context, "team");
  const { inactive } = await searchParams;
  const includeInactive = inactive === "1";

  const rows = await departments.listDepartments(context, { includeInactive });
  const organization = can(context, "organization.department.view");
  const manageHref = `/organization/companies/${encodeURIComponent(context.companyId)}`;

  return (
    <ModulePage
      experience={experience}
      activeSection="departments"
      actions={
        <div className="flex items-center gap-2">
          <Button asChild variant="secondary" size="sm">
            <Link href={includeInactive ? "/team/departments" : "/team/departments?inactive=1"}>
              {includeInactive ? "Hide inactive" : "Show inactive"}
            </Link>
          </Button>
          {organization ? (
            <Button asChild size="sm">
              <Link href={manageHref}>Manage in Organization</Link>
            </Button>
          ) : null}
        </div>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<Building2 />}
          title="No departments are active here."
          description="A company runs the group's departments it needs. They are activated from Organization."
          action={organization ? { label: "Open Organization", href: manageHref } : undefined}
        />
      ) : (
        <DepartmentTable departments={rows} linkToOrganization={organization} />
      )}
    </ModulePage>
  );
}
