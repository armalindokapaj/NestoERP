import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ModulePage } from "@/components/modules/module-page";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { listGroupDepartments, type PersonRefDTO } from "@/lib/modules/organization/department.service";

export const metadata: Metadata = { title: "Departments" };

const names = (people: PersonRefDTO[]) => (people.length === 0 ? "—" : people.map((person) => person.name).join(", "));

/**
 * The group's departments (E-06 §11, §12, §67): each function once for the
 * group, its head, and the companies that run a branch of it with their managers.
 */
export default async function DepartmentsPage() {
  const context = await requireModule("organization");
  if (!can(context, "organization.department.view")) redirect("/access-denied");
  const departments = await listGroupDepartments(context);

  return (
    <ModulePage
      experience={resolveModuleExperience(context, "organization")}
      activeSection="departments"
      title="Departments"
      description="Every function once for the group, with its head, and each company's branch of it with its manager."
    >
      <section className="nesto-card p-0">
        <Table flush aria-label="Group departments">
          <TableHead>
            <TableRow>
              <TableHeaderCell>Department</TableHeaderCell>
              <TableHeaderCell>Group head</TableHeaderCell>
              <TableHeaderCell>Company branches</TableHeaderCell>
              <TableHeaderCell>Managers</TableHeaderCell>
              <TableHeaderCell>People</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {departments.map((department) => (
              <TableRow key={department.id} data-testid="department-row">
                <TableCell className="font-medium">
                  <Link href={`/organization/departments/${encodeURIComponent(department.id)}`} className="text-fg hover:text-accent-strong hover:underline">
                    {department.name}
                  </Link>
                </TableCell>
                <TableCell>{names(department.heads)}</TableCell>
                <TableCell>{department.branches.length === 0 ? "—" : department.branches.map((branch) => branch.company.name).join(", ")}</TableCell>
                <TableCell>{names(department.branches.flatMap((branch) => branch.managers))}</TableCell>
                <TableCell className="tabular-nums">{department.branches.reduce((sum, branch) => sum + branch.memberCount, 0)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </ModulePage>
  );
}
