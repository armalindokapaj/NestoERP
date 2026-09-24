import type { Metadata } from "next";
import { cache } from "react";

import { ExperienceEditor, type Project3DEditorWorkspace } from "@/components/3d/platform/ExperienceEditor";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { openProject3DEditor } from "@/lib/modules/project-3d/project-3d.editor";

type Params = { params: Promise<{ projectId: string }> };

/** Read once per request, for the title and the editor alike; the layout has already checked access. */
const loadEditor = cache(async (projectId: string) => openProject3DEditor(await requirePlatformContext(), projectId));

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { projectId } = await params;
  const workspace = await loadEditor(projectId).catch(() => null);
  return { title: workspace ? `${workspace.config.experienceName} — 3D Experience Editor` : "3D Experience Editor" };
}

export default async function ExperienceEditorPage({ params }: Params) {
  const { projectId } = await params;
  return <ExperienceEditor initial={(await loadEditor(projectId)) as Project3DEditorWorkspace} />;
}
