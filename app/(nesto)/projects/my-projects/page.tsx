import type { Metadata } from "next";
import Link from "next/link";

import { ModulePage } from "@/components/modules/module-page";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { ProjectsList } from "../projects-list";

export const metadata: Metadata = { title: "My Projects" };

export default async function ProjectsSectionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule("projects");
  const experience = resolveModuleExperience(context, "projects");
  const params = await searchParams;

  return (
    <ModulePage
      experience={experience}
      activeSection="my-projects"
      actions={
        can(context, "project.create") ? (
          <Button asChild size="sm">
            <Link href="/projects/new">New project</Link>
          </Button>
        ) : null
      }
    >
      <ProjectsList
        context={context}
        searchParams={params}
        variant="mine"
        basePath="/projects/my-projects"
      />
    </ModulePage>
  );
}
