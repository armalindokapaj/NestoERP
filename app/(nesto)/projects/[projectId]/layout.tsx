import type { ReactNode } from "react";

import { ProjectNav } from "./project-tabs";

/** Every project page sits under the same pinned breadcrumbs and tabs; only the page below them changes. */
export default async function ProjectLayout({ children, params }: { children: ReactNode; params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return (
    <div className="space-y-5">
      <ProjectNav projectId={projectId} />
      {children}
    </div>
  );
}
