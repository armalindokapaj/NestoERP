"use client";

import * as React from "react";
import { X } from "lucide-react";

import { engineeringApi } from "@/components/engineering/engineering-api";
import { FormDialog, useCommand } from "@/components/engineering/form-kit";
import { Button } from "@/components/ui/button";
import type { TeamMemberDTO } from "@/lib/modules/organization/departments/department.types";

/**
 * A department manager's work assignment (E-06 §31, §65; E-13 §60, §88): put
 * one of their people on a project of a company they cover, or take them off
 * one. The same ProjectMember the project's own team page keeps — being in a
 * department puts nobody on a project by itself.
 */
export function DepartmentMemberProjects({ member }: { member: TeamMemberDTO }) {
  const { pending, run } = useCommand();
  const [open, setOpen] = React.useState(false);
  const name = member.person.name;
  const options = member.assignable.flatMap((row) =>
    row.projects.map((project) => ({ value: `${row.companyMemberId}|${project.id}`, label: `${project.code} · ${project.name}${member.assignable.length > 1 ? ` (${row.company.name})` : ""}` })),
  );

  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="member-projects">
      {member.projects.length === 0 ? <span className="text-meta text-fg-subtle">No projects</span> : null}
      {member.projects.map((project) => (
        <span key={project.projectMemberId} className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-muted px-2 py-0.5 text-meta text-fg" data-testid="member-project">
          {project.name}
          {member.canUnassignProjects ? (
            <button
              type="button"
              className="rounded-full p-0.5 text-fg-subtle hover:bg-hover hover:text-fg disabled:opacity-50"
              aria-label={`Take ${name} off ${project.name}`}
              disabled={pending === project.projectMemberId}
              onClick={() => void run(project.projectMemberId, () => engineeringApi(`/api/projects/${project.projectId}/members/${project.projectMemberId}`, { method: "DELETE" }), `${name} is off ${project.name}.`)}
            >
              <X aria-hidden="true" className="size-3" />
            </button>
          ) : null}
        </span>
      ))}
      {options.length > 0 ? (
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)} aria-label={`Assign ${name} to a project`}>
          Assign project
        </Button>
      ) : null}
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={`Assign ${name} to a project`}
        description="Projects of the companies they work in for this department, that they are not on yet."
        fields={[
          { name: "target", label: "Project", type: "select", required: true, options },
          { name: "projectRole", label: "Role on the project", type: "text", placeholder: member.person.jobTitle ?? undefined },
        ]}
        initial={{ target: options[0]?.value }}
        submitLabel="Assign"
        testId="assign-project-dialog"
        onSubmit={async (payload) => {
          const [companyMemberId, projectId] = String(payload.target).split("|");
          await engineeringApi(`/api/projects/${projectId}/members`, { body: { companyMemberId, projectRole: payload.projectRole ?? undefined } });
          await run("assign", async () => null, `${name} is assigned.`);
        }}
      />
    </div>
  );
}
