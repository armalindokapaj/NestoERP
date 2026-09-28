import type { ReactNode } from "react";
import { notFound } from "next/navigation";

import { EditorStateScreen } from "@/components/3d/platform/editor/EditorStateScreen";
import { Button } from "@/components/ui/button";
import { AccessError } from "@/lib/access/guards";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { authorizeProject3DEditor } from "@/lib/modules/project-3d/project-3d.editor";

/**
 * The editor address checks access for itself (3D Editor PRD §26-§31, §85,
 * §86): the link that opened the tab proves nothing, and a bookmarked or typed
 * address gets the same checks. They run here, above the loading state, so a
 * missing Experience is a real 404 rather than a streamed page.
 */
export default async function ExperienceEditorAccess({ children, params }: { children: ReactNode; params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const context = await requirePlatformContext();
  try {
    await authorizeProject3DEditor(context, projectId);
  } catch (error) {
    if (!(error instanceof AccessError)) throw error;
    if (error.code === "NOT_FOUND") notFound();
    if (error.code !== "FORBIDDEN") throw error;
    return (
      <EditorStateScreen
        code="Access denied"
        title="You can't author this Experience."
        actions={<Button asChild variant="secondary"><a href="/admin/3d">Open 3D Experiences</a></Button>}
      >
        The 3D Experience Editor needs the Platform Admin 3D authoring permission. Contact a Platform Administrator if you need it.
      </EditorStateScreen>
    );
  }
  return children;
}
