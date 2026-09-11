import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { RecordContextHeader } from "@/components/modules/record-header";
import { DepartmentForm } from "@/components/team/department-form";
import { can } from "@/lib/access/can";
import { createDepartmentAction } from "@/lib/actions/team";
import { requireModule } from "@/lib/context/current-user";
import { departmentManagerOptions } from "@/lib/modules/team/team.options";

export const metadata: Metadata = { title: "New department" };

export default async function NewDepartmentPage() {
  const context = await requireModule("team");

  if (!can(context, "team.department.create")) redirect("/access-denied");

  const managers = await departmentManagerOptions(context);

  async function action(formData: FormData) {
    "use server";
    return createDepartmentAction(formData);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <RecordContextHeader
        breadcrumbs={[
          { label: "Team", href: "/team" },
          { label: "Departments", href: "/team/departments" },
          { label: "New department" },
        ]}
        title="New department"
      />

      <DepartmentForm
        action={action}
        managers={managers}
        cancelHref="/team/departments"
        submitLabel="Create department"
        pendingLabel="Creating…"
      />
    </div>
  );
}
