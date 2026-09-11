import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { EmploymentForm } from "@/components/hr/employment-form";
import { RecordContextHeader } from "@/components/modules/record-header";
import { EmptyState } from "@/components/ui/empty-state";
import { UserRoundPlus } from "lucide-react";
import { can } from "@/lib/access/can";
import { createEmployeeProfileAction } from "@/lib/actions/hr";
import { requireModule } from "@/lib/context/current-user";
import {
  managerOptions,
  membersWithoutProfile,
} from "@/lib/modules/hr/employees/employee.repository";

export const metadata: Metadata = { title: "New employment record" };

/**
 * Create an employment record (PRD #16 §38, §225).
 *
 * Employment is added to somebody who already has company access, rather than
 * creating a person: one CompanyMember has at most one EmployeeProfile
 * (PRD #16 §25).
 */
export default async function NewEmployeePage() {
  const context = await requireModule("hr");

  if (!can(context, "hr.employee.create_profile")) redirect("/access-denied");

  const [members, managers] = await Promise.all([
    membersWithoutProfile(context),
    managerOptions(context),
  ]);

  async function action(formData: FormData) {
    "use server";
    return createEmployeeProfileAction(formData);
  }

  const breadcrumbs = [
    { label: "HR", href: "/hr" },
    { label: "Employees", href: "/hr/employees" },
    { label: "New employment record" },
  ];

  if (members.length === 0) {
    return (
      <div className="mx-auto max-w-3xl space-y-5">
        <RecordContextHeader
          breadcrumbs={breadcrumbs}
          title="New employment record"
          subtitle="Every team member in your view already has one."
        />
        <EmptyState
          icon={<UserRoundPlus />}
          title="No team member is waiting for an employment record."
          description="Invite somebody to the company in Team first; their employment record is added here afterwards."
          action={{ label: "Go to Team", href: "/team/invite" }}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <RecordContextHeader
        breadcrumbs={breadcrumbs}
        title="New employment record"
        subtitle="Employment terms for somebody who already has company access."
      />

      <EmploymentForm
        action={action}
        members={members.map((member) => ({
          value: member.id,
          label: `${member.user.firstName} ${member.user.lastName} (${member.user.email})`,
        }))}
        managers={managers.map((manager) => ({
          value: manager.id,
          label: `${manager.user.firstName} ${manager.user.lastName} — ${manager.role.name}`,
        }))}
        cancelHref="/hr/employees"
        submitLabel="Create employment record"
        pendingLabel="Creating…"
      />
    </div>
  );
}
