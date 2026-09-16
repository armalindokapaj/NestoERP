import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ProjectForm } from "@/components/projects/project-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { transitionFor } from "@/lib/core/state/machine";
import { updateProjectAction } from "@/lib/actions/projects";
import { projectMachine, statusActionFor } from "@/lib/modules/projects/project.machine";
import { projectFormOptions } from "@/lib/modules/projects/project.options";
import { projectTypeChoices } from "@/lib/modules/projects/project-type.service";
import { coverCandidates } from "@/lib/modules/projects/project.service";
import { allowedTransitions, projectStatusLabels } from "@/lib/modules/projects/project.status";
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

  const [options, covers, projectTypes] = await Promise.all([
    projectFormOptions(context, {
      clientId: project.client?.id ?? null,
      managerMemberId: project.projectManager?.memberId ?? null,
    }),
    coverCandidates(context, project.id),
    // A retired type stays offered to the project that has it (E-05A §62).
    projectTypeChoices(context, project.projectType?.id ?? null),
  ]);

  // The status is offered only to somebody who may move it, and only the moves
  // the form can make without a reason — returning to Pending is corrected
  // from Change Status on the Projects page, which asks why (E-05A §11, §12).
  const statuses = can(context, "project.status.manage")
    ? allowedTransitions(project.status)
        .filter((status) => {
          const action = status === project.status ? null : statusActionFor(project.status, status);
          return status === project.status || (action !== null && !transitionFor(projectMachine, action)?.requiresReason);
        })
        .map((status) => ({ value: status, label: projectStatusLabels[status] }))
    : [];

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
            { label: project.company.name, href: `/projects?company=${encodeURIComponent(project.company.id)}` },
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
        statuses={statuses}
        projectTypes={projectTypes}
        covers={{
          options: [
            ...covers.map((cover) => ({ value: cover.id, label: cover.name })),
            // A cover somebody else chose from a file this editor cannot open
            // stays selected, so saving the details does not remove it.
            ...(project.coverImageDocumentId && !covers.some((cover) => cover.id === project.coverImageDocumentId)
              ? [{ value: project.coverImageDocumentId, label: "Current cover" }]
              : []),
          ],
          uploadHref: `/projects/${project.id}/documents`,
        }}
        initial={{
          code: project.code,
          name: project.name,
          description: project.description ?? "",
          clientId: project.client?.id ?? "",
          projectManagerMemberId: project.projectManager?.memberId ?? "",
          status: project.status,
          priority: project.priority ?? "",
          projectTypeId: project.projectType?.id ?? "",
          coverImageDocumentId: project.coverImageDocumentId ?? "",
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
