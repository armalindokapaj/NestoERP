import { ThreeDViewer } from "@/components/projects/three-d-viewer";
import { PageHeader } from "@/components/ui/page-header";
import { getPublishedThreeDForProject } from "@/lib/modules/platform/platform-control.query";
import { loadProject } from "../project-context";
import { notFound } from "next/navigation";

type Params = { params: Promise<{ projectId: string }> };
export async function generateMetadata({ params }: Params) { const { projectId } = await params; const { project } = await loadProject(projectId); return { title: `${project.name} · 3D Viewer` }; }
export default async function ProjectThreeDPage({ params }: Params) { const { projectId } = await params; const { project } = await loadProject(projectId); const published = await getPublishedThreeDForProject(project.id); if (!published) notFound(); return <div className="space-y-5"><PageHeader title={`${project.name} · 3D Viewer`} description={`Published model v${published.version} · ${published.name}. Authoring, processing and publishing controls are restricted to the Platform Admin.`} /><ThreeDViewer projectId={project.id} /></div>; }
