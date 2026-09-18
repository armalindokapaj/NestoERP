import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { EmploymentForm } from "@/components/hr/employment-form";
import { RecordContextHeader } from "@/components/modules/record-header";
import { can } from "@/lib/access/can";
import { createEmployeeProfileAction } from "@/lib/actions/hr";
import { requireModule } from "@/lib/context/current-user";
import {
  departmentOptions,
  managerOptions,
  membersWithoutProfile,
  personOptions,
  tradeOptions,
} from "@/lib/modules/hr/employees/employee.repository";

export const metadata: Metadata = { title: "New employee" };

/**
 * Add an employee (PRD #16 §38, §225; E-04 §228-§230).
 *
 * Somebody new with no NESTO account is the ordinary case for a construction
 * company's workforce: a person and an employment, and nothing to sign in with.
 * A team member who already has a login, or a person the group already knows,
 * is employed as themselves — never recorded twice (E-04 §5, §89).
 */
export default async function NewEmployeePage() {
  const context = await requireModule("hr");

  if (!can(context, "hr.employee.create_profile")) redirect("/access-denied");

  const [members, managers, people, departments, trades] = await Promise.all([
    membersWithoutProfile(context),
    managerOptions(context),
    personOptions(context),
    departmentOptions(context),
    tradeOptions(context),
  ]);

  async function action(formData: FormData) {
    "use server";
    return createEmployeeProfileAction(formData);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <RecordContextHeader
        breadcrumbs={[
          { label: "HR", href: "/hr" },
          { label: "Employees", href: "/hr/employees" },
          { label: "New employee" },
        ]}
        title="New employee"
        subtitle="With or without a NESTO account. A login can be requested later for the same record."
      />

      <EmploymentForm
        action={action}
        members={members.map((member) => ({
          value: member.id,
          label: `${member.user.firstName} ${member.user.lastName}${member.user.email ? ` (${member.user.email})` : ""}`,
        }))}
        people={people.map((person) => ({
          value: person.id,
          label: person.companies.length > 0 ? `${person.name} — ${person.companies.join(", ")}` : person.name,
        }))}
        departments={departments.map((department) => ({ value: department.id, label: department.name }))}
        trades={trades.map((trade) => ({ value: trade.id, label: trade.name }))}
        managers={managers.map((manager) => ({
          value: manager.id,
          label: `${manager.user.firstName} ${manager.user.lastName} — ${manager.role.name}`,
        }))}
        cancelHref="/hr/employees"
        submitLabel="Create employee"
        pendingLabel="Creating…"
      />
    </div>
  );
}
