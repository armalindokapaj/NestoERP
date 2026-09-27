import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ModulePage } from "@/components/modules/module-page";
import { resolveModuleExperience, resolveSection } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { CompanyDetails, CompanyModules, CompanyOverview } from "../company-sections";

/** A page title of its own (AUD-11 §3, AV-02). */
export const metadata: Metadata = { title: "Company" };

export default async function CompanySectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  const context = await requireModule("company");
  const experience = resolveModuleExperience(context, "company");

  const resolved = resolveSection(experience, section);
  if (!resolved) notFound();

  return (
    <ModulePage experience={experience} activeSection={resolved.key}>
      {resolved.key === "details" ? (
        <CompanyDetails context={context} />
      ) : resolved.key === "modules" ? (
        <CompanyModules context={context} />
      ) : (
        <CompanyOverview context={context} />
      )}
    </ModulePage>
  );
}
