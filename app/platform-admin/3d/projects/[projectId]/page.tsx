import { notFound } from "next/navigation";

import { ExperienceEditor, type Project3DEditorWorkspace } from "@/components/3d/platform/ExperienceEditor";
import { EntitlementControl } from "@/components/3d/platform/EntitlementControl";
import { ModelIngestionPanel } from "@/components/3d/platform/ModelIngestionPanel";
import { ReleaseManager } from "@/components/3d/platform/ReleaseManager";
import { PageHeader } from "@/components/ui/page-header";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { getProject3DEditorWorkspace } from "@/lib/modules/project-3d/project-3d.editor";

export const metadata = { title: "3D Experience" };

export default async function Project3DWorkspacePage({ params }: { params: Promise<{ projectId: string }> }) {
  const context = await requirePlatformContext();
  const { projectId } = await params;
  try {
    const workspace = await getProject3DEditorWorkspace(context, projectId);
    return <div className="space-y-5"><PageHeader title={`${workspace.project.name} · 3D`} description={`${workspace.project.company.parentGroup.name} · ${workspace.project.company.name} · Platform authoring workspace`} /><EntitlementControl projectId={projectId} entitlement={workspace.entitlement} /><ModelIngestionPanel projectId={projectId} slots={workspace.slots} /><ExperienceEditor initial={workspace as Project3DEditorWorkspace} /><ReleaseManager projectId={projectId} slots={workspace.slots} /></div>;
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}
