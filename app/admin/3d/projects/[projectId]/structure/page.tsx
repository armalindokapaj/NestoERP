import { ProjectStructureManager, type PlatformProjectStructure } from "@/components/3d/platform/ProjectStructureManager";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { getPlatformProjectStructure } from "@/lib/modules/project-3d/project-3d.structure";

export const metadata = { title: "3D Project Structure" };

export default async function ExperienceStructurePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const context = await requirePlatformContext();
  const structure = await getPlatformProjectStructure(context, projectId);
  return <ProjectStructureManager projectId={projectId} structure={structure as PlatformProjectStructure} />;
}
