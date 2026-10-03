import { getTranslations } from "@/lib/i18n/server";
import { ModelIngestionPanel } from "@/components/3d/platform/ModelIngestionPanel";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { getProject3DEditorWorkspace } from "@/lib/modules/project-3d/project-3d.editor";

export async function generateMetadata() { const t = await getTranslations("adminPlatform"); return { title: t("threeD.project.modelsMeta") }; }

export default async function ExperienceModelsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const context = await requirePlatformContext();
  const workspace = await getProject3DEditorWorkspace(context, projectId);
  return <ModelIngestionPanel projectId={projectId} slots={workspace.slots} uploadLimitBytes={workspace.uploadLimitBytes} />;
}
