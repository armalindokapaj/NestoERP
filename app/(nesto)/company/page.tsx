import type { Metadata } from "next";

import { ModulePage } from "@/components/modules/module-page";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { CompanyOverview } from "./company-sections";

export const metadata: Metadata = { title: "Company" };

export default async function CompanyPage() {
  const context = await requireModule("company");
  const experience = resolveModuleExperience(context, "company");

  return (
    <ModulePage experience={experience} activeSection="overview">
      <CompanyOverview context={context} />
    </ModulePage>
  );
}
