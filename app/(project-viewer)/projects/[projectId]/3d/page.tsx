import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";

import { ProjectViewerPage } from "@/components/3d/viewer/ProjectViewerPage";
import { hasActiveProject3DViewer } from "@/lib/modules/project-3d/project-3d.viewer";
import { loadProject } from "@/app/(nesto)/projects/[projectId]/project-context";
import { requireProjectPortfolio } from "@/app/(nesto)/projects/portfolio-access";

type Params = { params: Promise<{ projectId: string }> };

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { projectId } = await params;
  const { project } = await loadProject(projectId);
  return { title: `${project.name} · 3D Explorer` };
}

/**
 * The published 3D experience of one project, full screen. The same doors as
 * the project's other tabs — the Projects module guard their layout runs
 * (requireProjectPortfolio), then loadProject: company scope, the open step
 * for another of the person's companies, a 404 otherwise — and the 3D gate.
 * What the viewer then shows of each unit is trimmed by the bootstrap API.
 */
export default async function ProjectThreeDPage({ params }: Params) {
  await requireProjectPortfolio();
  const { projectId } = await params;
  const { context, project } = await loadProject(projectId);
  if (!await hasActiveProject3DViewer(context, project.id)) notFound();

  return <ProjectViewerPage projectId={project.id} projectName={project.name} />;
}
