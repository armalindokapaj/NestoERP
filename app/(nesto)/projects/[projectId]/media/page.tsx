import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { redirect } from "next/navigation";

import { ProjectMediaGallery } from "@/components/projects/project-media-gallery";
import { ProjectMediaManager } from "@/components/projects/project-media-manager";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { listProjectMedia } from "@/lib/modules/project-media/project-media.service";
import { loadProject } from "../project-context";

type Props = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { projectId } = await params;
  const { project } = await loadProject(projectId);
  return { title: `${project.name} · Media` };
}

const one = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

export default async function ProjectMediaPage({ params, searchParams }: Props) {
  const { projectId } = await params;
  const query = await searchParams;
  const { context, project } = await loadProject(projectId);
  const media = await listProjectMedia(context, project.id);
  if (!media.capabilities.canView) redirect(`/projects/${project.id}`);
  const managing = one(query.manage) === "1" && media.capabilities.canManage;
  const type = one(query.type);
  const showRenders = type !== "animations";
  const showAnimations = type !== "renders";

  return (
    <div className="space-y-6">
      <PageHeader
        title={managing ? "Manage project media" : "Project media"}
        description={managing ? `Upload, order and curate the media shown for ${project.name}.` : `Renders and animations for ${project.name}.`}
        actions={
          <div className="flex gap-2">
            <Button asChild size="sm" variant="secondary"><Link href={`/projects/${project.id}`}>Back to project</Link></Button>
            {!managing && media.capabilities.canManage ? <Button asChild size="sm"><Link href={`/projects/${project.id}/media?manage=1`}>Manage media</Link></Button> : null}
            {managing ? <Button asChild size="sm"><Link href={`/projects/${project.id}/media`}>View gallery</Link></Button> : null}
          </div>
        }
      />

      {managing ? <ProjectMediaManager projectId={project.id} initial={media} /> : (
        <div className="space-y-8">
          {showRenders && media.renders.length ? <section><div className="mb-4 flex items-end justify-between gap-3"><div><p className="text-meta font-semibold uppercase tracking-[0.14em] text-fg-subtle">Project media</p><h2 className="mt-1 text-section font-semibold text-fg">Renders</h2></div><span className="text-table text-fg-muted">{media.renders.length}</span></div><ProjectMediaGallery items={media.renders} type="renders" /></section> : null}
          {showAnimations && media.animations.length ? <section><div className="mb-4 flex items-end justify-between gap-3"><div><p className="text-meta font-semibold uppercase tracking-[0.14em] text-fg-subtle">Project media</p><h2 className="mt-1 text-section font-semibold text-fg">Animations</h2></div><span className="text-table text-fg-muted">{media.animations.length}</span></div><ProjectMediaGallery items={media.animations} type="animations" /></section> : null}
          {(!showRenders || media.renders.length === 0) && (!showAnimations || media.animations.length === 0) ? <div className="nesto-card grid min-h-56 place-items-center p-6 text-center"><div><p className="text-body font-medium text-fg">No {type === "animations" ? "animations" : type === "renders" ? "renders" : "project media"} yet.</p><p className="mt-1 text-table text-fg-muted">Available media appears here automatically.</p></div></div> : null}
        </div>
      )}
    </div>
  );
}
