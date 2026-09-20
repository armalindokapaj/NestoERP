import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Project3DViewer } from "@/components/3d/company/Project3DViewer";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { hasActiveProject3DViewer } from "@/lib/modules/project-3d/project-3d.viewer";
import { loadProject } from "../project-context";

type Params = { params: Promise<{ projectId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { projectId } = await params;
  const { project } = await loadProject(projectId);
  return { title: `${project.name} · 3D Explorer` };
}

export default async function ProjectThreeDPage({ params }: Params) {
  const { projectId } = await params;
  const { context, project } = await loadProject(projectId);
  if (!await hasActiveProject3DViewer(context, project.id)) notFound();

  return (
    <div className="space-y-5">
      <PageHeader
        title={`${project.name} · 3D Explorer`}
        description="Explore the active published experience and open mapped units in their canonical NESTO records."
        actions={<Button asChild size="sm" variant="secondary"><Link href={`/projects/${project.id}`}>Back to project</Link></Button>}
      />
      <Project3DViewer projectId={project.id} />
    </div>
  );
}
