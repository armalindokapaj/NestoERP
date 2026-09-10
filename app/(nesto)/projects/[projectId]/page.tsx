import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ProgressBar } from "@/components/charts/progress-bar";
import { DetailHeader } from "@/components/modules/detail-header";
import { ModulePlaceholder } from "@/components/modules/module-placeholder";
import { Badge } from "@/components/ui/badge";
import { modules } from "@/config/modules";
import { requirePermission } from "@/lib/auth/session";
import { demoProjects, statusLabels, statusTones } from "@/lib/mock/demo-data";
import { formatDate } from "@/lib/utils/format";

/**
 * Project detail (spec §32; design spec §65).
 * The tab architecture that later carries Tasks, Team, Documents and industry
 * extensions exists now; only Overview has content.
 */
const TABS = [
  { slug: "overview", label: "Overview" },
  { slug: "tasks", label: "Tasks" },
  { slug: "team", label: "Team" },
  { slug: "documents", label: "Documents" },
  { slug: "activity", label: "Activity" },
];

export async function generateMetadata({
  params,
}: {
  params: Promise<{ projectId: string }>;
}): Promise<Metadata> {
  const { projectId } = await params;
  const project = demoProjects.find((item) => item.id === projectId);
  return { title: project?.name ?? "Project" };
}

export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  await requirePermission(modules.projects.viewPermission);

  const { projectId } = await params;
  const { tab } = await searchParams;

  const project = demoProjects.find((item) => item.id === projectId);
  if (!project) notFound();

  const activeTab = TABS.find((item) => item.slug === tab)?.slug ?? "overview";

  const details = [
    { label: "Client", value: project.client },
    { label: "Project manager", value: project.manager },
    { label: "Location", value: project.location },
    { label: "Contract value", value: project.value },
    { label: "Start date", value: formatDate(project.startDate) },
    { label: "Due date", value: formatDate(project.dueDate) },
  ];

  return (
    <div className="space-y-5">
      <DetailHeader
        crumbs={[
          { label: "Projects", href: "/projects" },
          { label: project.name },
        ]}
        title={project.name}
        status={<Badge tone={statusTones[project.status]}>{statusLabels[project.status]}</Badge>}
        meta={
          <>
            {project.code}
            <span className="px-1.5 text-fg-subtle">·</span>
            {project.client}
          </>
        }
        tabs={TABS}
        activeTab={activeTab}
        tabHref={(slug) => `/projects/${project.id}?tab=${slug}`}
      />

      {activeTab === "overview" ? (
        <div className="grid gap-4 xl:grid-cols-3">
          <section className="nesto-card p-5 xl:col-span-2">
            <h2 className="text-card font-semibold text-fg">Project details</h2>
            <dl className="mt-3 divide-y divide-line">
              {details.map((detail) => (
                <div key={detail.label} className="flex items-center justify-between gap-3 py-2.5">
                  <dt className="text-table text-fg-muted">{detail.label}</dt>
                  <dd className="text-table font-medium text-fg">{detail.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">Progress</h2>
            <p className="mt-3 text-page font-semibold tabular-nums text-fg">
              {project.progress}%
            </p>
            <ProgressBar
              value={project.progress}
              label={`${project.name} progress`}
              className="mt-3 h-2"
            />
            <p className="mt-3 text-meta text-fg-subtle">
              Progress is demo data until the projects module becomes functional.
            </p>
          </section>
        </div>
      ) : (
        <ModulePlaceholder
          title={`Project ${TABS.find((item) => item.slug === activeTab)?.label}`}
          description="This section is part of the Projects module roadmap."
        />
      )}
    </div>
  );
}
