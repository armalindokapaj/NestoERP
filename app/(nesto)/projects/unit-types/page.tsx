import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ModulePage } from "@/components/modules/module-page";
import { UnitTypesManager } from "@/components/projects/unit-types-manager";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { listUnitTypes } from "@/lib/modules/project-structure/unit-type.service";

export const metadata: Metadata = { title: "Unit types" };

/**
 * Unit types (E-05B §20, §21, §116).
 *
 * The session company's own list, beside its project types. Somebody without
 * the grant is told nothing is here rather than that something is withheld.
 */
export default async function UnitTypesPage() {
  const context = await requireModule("projects");
  if (!can(context, "project.unit_type.manage")) notFound();
  const types = await listUnitTypes(context);

  return (
    <ModulePage
      experience={resolveModuleExperience(context, "projects")}
      activeSection="unit-types"
      description={`The kinds of unit that make up ${context.company.name}'s projects. The category decides which details a unit is asked for; retiring a type leaves the units that have it alone.`}
    >
      <UnitTypesManager initial={types} />
    </ModulePage>
  );
}
