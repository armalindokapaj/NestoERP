import { ReleaseManager } from "@/components/3d/platform/ReleaseManager";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { getProject3DEditorWorkspace } from "@/lib/modules/project-3d/project-3d.editor";

export const metadata = { title: "3D Releases" };

export default async function ExperienceReleasesPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const context = await requirePlatformContext();
  const workspace = await getProject3DEditorWorkspace(context, projectId);
  return <ReleaseManager projectId={projectId} slots={workspace.slots} />;
}
