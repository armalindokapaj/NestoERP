import type { Metadata } from "next";

import { ModulePage } from "@/components/modules/module-page";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { TeamPeople } from "./team-directory";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage() {
  const context = await requireModule("team");
  const experience = resolveModuleExperience(context, "team");

  return (
    <ModulePage experience={experience} activeSection="people">
      <TeamPeople context={context} />
    </ModulePage>
  );
}
