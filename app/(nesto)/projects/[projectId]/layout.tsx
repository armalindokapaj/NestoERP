import type { ReactNode } from "react";

import { ProjectNav } from "./project-tabs";

/** Every project page sits under the same pinned breadcrumbs and tabs; only the page below them changes. */
export default async function ProjectLayout({ children, params }: { children: ReactNode; params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return (
    // Tighter below lg: the project's compact header is the tab row's place there, close under the section row, and the page follows it closely.
    <div className="space-y-5 max-lg:-mt-2 max-lg:space-y-3">
      <ProjectNav projectId={projectId} />
      {children}
    </div>
  );
}
