import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { notFound } from "next/navigation";

import { ModulePage } from "@/components/modules/module-page";
import { ProjectTypesManager } from "@/components/projects/project-types-manager";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { listProjectTypes } from "@/lib/modules/projects/project-type.service";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("projects"))("pages.projectTypes") };
}

/**
 * Project types (E-05A §30, §62).
 *
 * The company's own list — the session's company, like the module's other
 * sections. Somebody without the grant is told nothing is here rather than
 * that something is withheld.
 */
export default async function ProjectTypesPage() {
  const context = await requireModule("projects");
  const t = await getTranslations("projects");
  if (!can(context, "project.type.manage")) notFound();
  const types = await listProjectTypes(context);

  return (
    <ModulePage
      experience={resolveModuleExperience(context, "projects")}
      activeSection="types"
      description={t("pages.projectTypesIntro", { company: context.company.name })}
    >
      <ProjectTypesManager initial={types} />
    </ModulePage>
  );
}
