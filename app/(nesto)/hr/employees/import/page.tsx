import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { EmployeeImport } from "@/components/hr/employee-import";
import { ModulePage } from "@/components/modules/module-page";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { IMPORT_TEMPLATE } from "@/lib/modules/workforce/workforce.import";

export const metadata: Metadata = { title: "Import employees" };

/** Adding the workforce in bulk, from a spreadsheet (E-04 §93-§98). */
export default async function ImportEmployeesPage() {
  const context = await requireModule("hr");
  if (!can(context, "hr.employee.import")) notFound();
  return (
    <ModulePage
      experience={resolveModuleExperience(context, "hr")}
      activeSection="employees"
      title="Import employees"
      description={`Add many people to ${context.company.name} at once — most of a site workforce never signs in to NESTO, and none of them needs to for this.`}
    >
      <EmployeeImport template={IMPORT_TEMPLATE} />
    </ModulePage>
  );
}
