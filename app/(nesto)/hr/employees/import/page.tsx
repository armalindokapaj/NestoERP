import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { EmployeeImport } from "@/components/hr/employee-import";
import { ModulePage } from "@/components/modules/module-page";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { IMPORT_TEMPLATE } from "@/lib/modules/workforce/workforce.import";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("hr");
  return { title: t("meta.importEmployees") };
}

/** Adding the workforce in bulk, from a spreadsheet (E-04 §93-§98). */
export default async function ImportEmployeesPage() {
  const context = await requireModule("hr");
  if (!can(context, "hr.employee.import")) notFound();
  const t = await getTranslations("hr");
  return (
    <ModulePage
      experience={resolveModuleExperience(context, "hr")}
      activeSection="employees"
      title={t("meta.importEmployees")}
      description={t("import.description", { company: context.company.name })}
    >
      <EmployeeImport template={IMPORT_TEMPLATE} />
    </ModulePage>
  );
}
