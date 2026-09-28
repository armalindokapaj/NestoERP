import type { Metadata } from "next";
import { notFound } from "next/navigation";

import Link from "@/components/navigation/nav-link";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { AccessError } from "@/lib/access/guards";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { getPlatformProject } from "@/lib/modules/platform/platform-control.query";
import { formatDate } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Project" };

type Props = { params: Promise<{ projectId: string }> };

/**
 * A project's Platform Admin page (Admin IA §7, §58): where it sits and its 3D
 * state. Its full administration arrives with the Projects PRD; its business
 * records stay in the tenant workspace.
 */
export default async function PlatformProjectPage({ params }: Props) {
  const { projectId } = await params;
  const context = await requirePlatformContext();
  const project = await getPlatformProject(context, projectId).catch((error: unknown) => {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const status = project.archivedAt ? "ARCHIVED" : project.status;
  const rows: [string, React.ReactNode][] = [
    ["Code", <span key="code" className="font-mono">{project.code}</span>],
    ["Company", <Link key="company" href={`/admin/organizations/${project.company.id}`} className="text-accent-strong hover:underline">{project.company.name}</Link>],
    ["Group", project.company.parentGroup.kind === "STANDALONE" ? "Standalone company" : <Link key="group" href={`/admin/organizations/${project.company.parentGroup.id}`} className="text-accent-strong hover:underline">{project.company.parentGroup.name}</Link>],
    ["Members", project.members],
    ["Created", formatDate(project.createdAt)],
    ["Updated", formatDate(project.updatedAt)],
  ];

  return (
    <div className="space-y-5">
      <Breadcrumbs items={[{ label: "Projects", href: "/admin/projects" }, { label: project.name }]} />
      <PageHeader
        title={project.name}
        description={project.description ?? undefined}
        actions={project.threeD ? <Button asChild size="sm" variant="secondary"><Link href={`/admin/3d/projects/${project.id}`}>Open 3D</Link></Button> : undefined}
      />
      <div className="flex flex-wrap gap-2">
        <Badge tone={project.archivedAt ? "danger" : project.status === "ACTIVE" ? "success" : "warning"}>{status}</Badge>
        <Badge tone={project.threeD === "Published" ? "success" : "neutral"}>3D: {project.threeD ?? "Not configured"}</Badge>
      </div>
      <section className="nesto-card p-5" aria-labelledby="project-details">
        <h2 id="project-details" className="text-card font-semibold text-fg">Details</h2>
        <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt className="text-meta text-fg-subtle">{label}</dt>
              <dd className="text-body text-fg">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
