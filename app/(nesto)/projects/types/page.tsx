import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ModulePage } from "@/components/modules/module-page";
import { ProjectTypesManager } from "@/components/projects/project-types-manager";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { listProjectTypes } from "@/lib/modules/projects/project-type.service";

export const metadata: Metadata = { title: "Project types" };

/**
 * Project types (E-05A §30, §62).
 *
 * The company's own list — the session's company, like the module's other
 * sections. Somebody without the grant is told nothing is here rather than
 * that something is withheld.
 */
export default async function ProjectTypesPage() {
  const context = await requireModule("projects");
  if (!can(context, "project.type.manage")) notFound();
  const types = await listProjectTypes(context);

  return (
    <ModulePage
      experience={resolveModuleExperience(context, "projects")}
      activeSection="types"
      description={`How ${context.company.name} sorts its projects. New projects choose from the types in use; retiring a type leaves the projects that have it alone.`}
    >
      <ProjectTypesManager initial={types} />
    </ModulePage>
  );
}
