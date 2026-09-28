import type { Metadata } from "next";

import { ModulePage } from "@/components/modules/module-page";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { getTranslations } from "@/lib/i18n/server";
import { CompanyOverview } from "./company-sections";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("misc"))("company.title") };
}

export default async function CompanyPage() {
  const context = await requireModule("company");
  const experience = resolveModuleExperience(context, "company");

  return (
    <ModulePage experience={experience} activeSection="overview">
      <CompanyOverview context={context} />
    </ModulePage>
  );
}
