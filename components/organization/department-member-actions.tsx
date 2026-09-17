"use client";

import * as React from "react";
import { X } from "lucide-react";

import { engineeringApi } from "@/components/engineering/engineering-api";
import { FormDialog, useCommand } from "@/components/engineering/form-kit";
import { Button } from "@/components/ui/button";
import type { DepartmentMemberDTO } from "@/lib/modules/organization/department.service";

/**
 * A department manager's work assignment (E-06 §31, §65): put one of their
 * people on a project of that person's company, or take them off one. The same
 * ProjectMember the project's own team page keeps (§94).
 */
export function DepartmentMemberProjects({ member }: { member: DepartmentMemberDTO }) {
  const { pending, run } = useCommand();
  const [open, setOpen] = React.useState(false);

  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="member-projects">
      {member.projects.length === 0 ? <span className="text-meta text-fg-subtle">No projects</span> : null}
      {member.projects.map((project) => (
        <span key={project.projectMemberId} className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-muted px-2 py-0.5 text-meta text-fg" data-testid="member-project">
          {project.name}
          {member.canUnassign ? (
            <button
              type="button"
              className="rounded-full p-0.5 text-fg-subtle hover:bg-hover hover:text-fg disabled:opacity-50"
              aria-label={`Take ${member.name} off ${project.name}`}
              disabled={pending === project.projectMemberId}
              onClick={() => void run(project.projectMemberId, () => engineeringApi(`/api/projects/${project.projectId}/members/${project.projectMemberId}`, { method: "DELETE" }), `${member.name} is off ${project.name}.`)}
            >
              <X aria-hidden="true" className="size-3" />
            </button>
          ) : null}
        </span>
      ))}
      {member.assignable.length > 0 ? (
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)} aria-label={`Assign ${member.name} to a project`}>
          Assign project
        </Button>
      ) : null}
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={`Assign ${member.name} to a project`}
        description={`Projects of ${member.company.name} they are not on yet.`}
        fields={[
          { name: "projectId", label: "Project", type: "select", required: true, options: member.assignable.map((project) => ({ value: project.id, label: `${project.code} · ${project.name}` })) },
          { name: "projectRole", label: "Role on the project", type: "text", placeholder: member.jobTitle ?? undefined },
        ]}
        initial={{ projectId: member.assignable[0]?.id }}
        submitLabel="Assign"
        testId="assign-project-dialog"
        onSubmit={async (payload) => {
          await engineeringApi(`/api/projects/${String(payload.projectId)}/members`, { body: { companyMemberId: member.memberId, projectRole: payload.projectRole ?? undefined } });
          await run("assign", async () => null, `${member.name} is assigned.`);
        }}
      />
    </div>
  );
}
