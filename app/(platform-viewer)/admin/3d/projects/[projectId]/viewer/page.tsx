import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ModuleMessages } from "@/components/i18n/module-messages";
import { getViewerBrand } from "@/lib/modules/project-3d/project-3d.viewer-brand";
import { ProjectViewerPage } from "@/components/3d/viewer/ProjectViewerPage";
import { canPlatform, requirePlatformContext } from "@/lib/context/platform-context";
import { prisma } from "@/lib/database/prisma";
import { getTranslations } from "@/lib/i18n/server";

type Params = { params: Promise<{ projectId: string }> };

async function findProject(projectId: string) {
  return prisma.project.findFirst({
    where: { id: projectId, company: { parentGroup: { isTestFixture: false } } },
    select: { id: true, name: true },
  });
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const [project, t] = await Promise.all([findProject((await params).projectId), getTranslations("adminPlatform")]);
  const viewer = t("threeD.project.companyViewer");
  return { title: project ? `${project.name} · ${viewer}` : viewer };
}

/**
 * The Company viewer as a signed-in company reader sees it, opened from
 * Platform Admin without company credentials: the project's active published
 * release, every unit fact shown. Nothing here writes.
 */
export default async function PlatformCompanyViewerPage({ params }: Params) {
  const context = await requirePlatformContext();
  const { projectId } = await params;
  if (!canPlatform(context, "platform.3d.view")) notFound();
  const project = await findProject(projectId);
  if (!project) notFound();

  return (
    <div data-project-viewer className={`h-full w-full overflow-hidden antialiased`}>
      <ModuleMessages namespaces={["threeD"]}>
        <ProjectViewerPage
          brand={await getViewerBrand(project.id)}
          projectId={project.id}
          projectName={project.name}
          apiBase={`/api/platform/3d/projects/${encodeURIComponent(project.id)}/viewer`}
          backHref={`/admin/3d/projects/${project.id}`}
        />
      </ModuleMessages>
    </div>
  );
}
