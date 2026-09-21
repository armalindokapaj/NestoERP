import { ExperienceEditor, type Project3DEditorWorkspace } from "@/components/3d/platform/ExperienceEditor";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { getProject3DEditorWorkspace } from "@/lib/modules/project-3d/project-3d.editor";

export const metadata = { title: "3D Experience Editor" };

export default async function ExperienceEditorPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const context = await requirePlatformContext();
  const workspace = await getProject3DEditorWorkspace(context, projectId);
  return <ExperienceEditor initial={workspace as Project3DEditorWorkspace} />;
}
