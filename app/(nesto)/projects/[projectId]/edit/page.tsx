import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ProjectForm } from "@/components/projects/project-form";
import { statusLabel } from "@/components/modules/status-badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { updateProjectAction } from "@/lib/actions/projects";
import { projectFormOptions } from "@/lib/modules/projects/project.options";
import { allowedTransitions } from "@/lib/modules/projects/project.status";
import { loadProject } from "../project-context";

type Params = { params: Promise<{ projectId: string }> };

export const metadata: Metadata = { title: "Edit project" };

/**
 * Edit a project (PRD #10 §55–§57).
 *
 * The status dropdown offers only transitions the backend will accept, so the
 * two cannot disagree (PRD #10 §61, §196). An archived project is read-only and
 * redirects back to the record (PRD #10 §58).
 */
export default async function EditProjectPage({ params }: Params) {
  const { projectId } = await params;
  const { context, project } = await loadProject(projectId);

  if (!can(context, "project.update")) redirect("/access-denied");
  if (project.archivedAt !== null || project.status === "ARCHIVED") {
    redirect(`/projects/${project.id}`);
  }

  const options = await projectFormOptions(context);

  async function action(formData: FormData) {
    "use server";
    return updateProjectAction(projectId, formData);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <Breadcrumbs
          items={[
            { label: "Projects", href: "/projects" },
            { label: project.name, href: `/projects/${project.id}` },
            { label: "Edit" },
          ]}
        />
        <h1 className="mt-3 text-page font-semibold text-fg">Edit {project.name}</h1>
        <p className="mt-1.5 text-body text-fg-muted">{project.code}</p>
      </div>

      <ProjectForm
        mode="edit"
        cancelHref={`/projects/${project.id}`}
        versionUpdatedAt={project.updatedAt}
        clients={options.clients}
        managers={options.managers}
        statuses={allowedTransitions(project.status)
          .filter((status) => status !== "ARCHIVED")
          .map((status) => ({ value: status, label: statusLabel(status) }))}
        initial={{
          code: project.code,
          name: project.name,
          description: project.description ?? "",
          clientId: project.client?.id ?? "",
          projectManagerMemberId: project.projectManager?.memberId ?? "",
          status: project.status,
          priority: project.priority ?? "",
          startDate: project.schedule.startDate?.slice(0, 10) ?? "",
          endDate: project.schedule.endDate?.slice(0, 10) ?? "",
          address: project.location.address ?? "",
          city: project.location.city ?? "",
          country: project.location.country ?? "",
        }}
        action={action}
      />
    </div>
  );
}
