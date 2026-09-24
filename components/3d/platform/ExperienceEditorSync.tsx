"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { subscribeExperienceEditorSaved } from "@/lib/3d/platform/editor-sync";

/**
 * Keeps an Experience's management pages current while its editor, in another
 * tab, saves (3D Editor PRD §143-§147). The page is read again under this
 * tab's own session; the message only says that something changed.
 */
export function ExperienceEditorSync({ projectId }: { projectId: string }) {
  const router = useRouter();
  React.useEffect(() => subscribeExperienceEditorSaved(projectId, () => router.refresh()), [projectId, router]);
  return null;
}
