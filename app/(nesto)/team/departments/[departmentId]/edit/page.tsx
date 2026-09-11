import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { RecordContextHeader } from "@/components/modules/record-header";
import { DepartmentForm } from "@/components/team/department-form";
import { can } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import { updateDepartmentAction } from "@/lib/actions/team";
import { requireModule } from "@/lib/context/current-user";
import * as departments from "@/lib/modules/team/departments/department.service";
import { departmentManagerOptions } from "@/lib/modules/team/team.options";

type Params = { params: Promise<{ departmentId: string }> };

export const metadata: Metadata = { title: "Edit department" };

export default async function EditDepartmentPage({ params }: Params) {
  const { departmentId } = await params;
  const context = await requireModule("team");

  if (!can(context, "team.department.update")) redirect("/access-denied");

  let department;
  try {
    department = await departments.getDepartment(context, departmentId);
  } catch (error) {
    // A department outside this company answers "not found", so the page
    // cannot be used to confirm that one exists (PRD #14 §160).
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  // An archived department is restored, not edited (PRD #14 §128).
  if (department.status === "ARCHIVED") redirect("/team/departments?archived=1");

  const managers = await departmentManagerOptions(context);

  async function action(formData: FormData) {
    "use server";
    return updateDepartmentAction(departmentId, formData);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <RecordContextHeader
        breadcrumbs={[
          { label: "Team", href: "/team" },
          { label: "Departments", href: "/team/departments" },
          { label: department.name },
        ]}
        title={`Edit ${department.name}`}
        status={department.status}
      />

      <DepartmentForm
        action={action}
        managers={managers}
        values={{
          name: department.name,
          key: department.key,
          description: department.description,
          managerMemberId: department.managerMemberId,
          status: department.status,
        }}
        versionUpdatedAt={department.updatedAt.toISOString()}
        cancelHref="/team/departments"
        submitLabel="Save changes"
        pendingLabel="Saving…"
      />
    </div>
  );
}
