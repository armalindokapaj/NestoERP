import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import Link from "@/components/navigation/nav-link";

import { ModulePage } from "@/components/modules/module-page";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { ProjectsList } from "../projects-list";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("projects"))("pages.archived") };
}

export default async function ProjectsSectionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule("projects");
  const t = await getTranslations("projects");
  const experience = resolveModuleExperience(context, "projects");
  const params = await searchParams;

  return (
    <ModulePage
      experience={experience}
      activeSection="archived"
      actions={
        can(context, "project.create") ? (
          <Button asChild size="sm">
            <Link href="/projects/new">{t("pages.newProject")}</Link>
          </Button>
        ) : null
      }
    >
      <ProjectsList
        context={context}
        searchParams={params}
        basePath="/projects/archived"
      />
    </ModulePage>
  );
}
