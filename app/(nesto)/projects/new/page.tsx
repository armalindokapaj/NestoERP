import type { Metadata } from "next";

import { ProjectForm } from "@/components/projects/project-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { createProjectAction } from "@/lib/actions/projects";
import { requirePermission } from "@/lib/context/current-user";
import { projectFormOptions } from "@/lib/modules/projects/project.options";
import { EDITABLE_STATUSES } from "@/lib/modules/projects/project.status";
import { statusLabel } from "@/components/modules/status-badge";

export const metadata: Metadata = { title: "New project" };

/**
 * Create a project (PRD #10 §30).
 *
 * The route itself requires project.create, so a role without it is refused
 * even when it reaches the URL directly (PRD #10 §214).
 */
export default async function NewProjectPage() {
  const context = await requirePermission("project.create");
  const options = await projectFormOptions(context);

  async function action(formData: FormData) {
    "use server";
    return createProjectAction(formData);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <Breadcrumbs items={[{ label: "Projects", href: "/projects" }, { label: "New project" }]} />
        <h1 className="mt-3 text-page font-semibold text-fg">New project</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          Create a project record. You can add the team and documents afterwards.
        </p>
      </div>

      <ProjectForm
        mode="create"
        cancelHref="/projects/all"
        clients={options.clients}
        managers={options.managers}
        statuses={EDITABLE_STATUSES.map((status) => ({
          value: status,
          label: statusLabel(status),
        }))}
        initial={{
          code: "",
          name: "",
          description: "",
          clientId: "",
          projectManagerMemberId: "",
          status: "DRAFT",
          priority: "",
          startDate: "",
          endDate: "",
          address: "",
          city: "",
          country: "",
        }}
        action={action}
      />
    </div>
  );
}
