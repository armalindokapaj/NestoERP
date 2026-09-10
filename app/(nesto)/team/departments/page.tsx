import type { Metadata } from "next";

import { ModulePage } from "@/components/modules/module-page";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { TeamDepartments } from "../team-directory";

export const metadata: Metadata = { title: "Departments" };

/**
 * A static route rather than a `[section]` segment: Team also has
 * `/team/[userId]`, and Next.js will not accept two different slug names at the
 * same position. Team has exactly two sections, so naming them is simpler than
 * disambiguating a member id from a section slug at runtime.
 */
export default async function TeamDepartmentsPage() {
  const context = await requireModule("team");
  const experience = resolveModuleExperience(context, "team");

  return (
    <ModulePage experience={experience} activeSection="departments">
      <TeamDepartments context={context} />
    </ModulePage>
  );
}
