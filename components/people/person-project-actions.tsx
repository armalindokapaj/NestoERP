"use client";

import * as React from "react";

import { engineeringApi } from "@/components/engineering/engineering-api";
import { FormDialog, useCommand } from "@/components/engineering/form-kit";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type Assignable = { projectId: string; code: string; name: string; company: { name: string } };

/**
 * Putting a person on a project from their profile (E-08 §49, §64): shown to a
 * department manager, or whoever runs a project's team, for the projects they
 * may assign this person to. The server decides again when it is sent.
 */
export function AssignProjectButton({ personId, name, projects }: { personId: string; name: string; projects: Assignable[] }) {
  const { run } = useCommand();
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Assign to a project
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={`Assign ${name} to a project`}
        description="Projects of their companies that you may staff."
        fields={[
          { name: "projectId", label: "Project", type: "select", required: true, options: projects.map((project) => ({ value: project.projectId, label: `${project.code} · ${project.name} — ${project.company.name}` })), emptyLabel: "Choose a project" },
          { name: "projectRole", label: "Role on the project", type: "text", placeholder: "Optional, e.g. Site architect" },
        ]}
        initial={{ projectId: "", projectRole: "" }}
        submitLabel="Assign"
        testId="assign-project-dialog"
        onSubmit={async (payload) => {
          await engineeringApi(`/api/people/${personId}/projects`, { method: "POST", body: payload });
          await run("assign-project", async () => null, `${name} is on the project.`);
        }}
      />
    </>
  );
}

export function RemoveFromProjectButton({ personId, name, project }: { personId: string; name: string; project: { id: string; name: string } }) {
  const { pending, run } = useCommand();
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)} aria-label={`Take ${name} off ${project.name}`}>
        Remove
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Take ${name} off ${project.name}?`}
        description="They leave the project team; what they did on it stays."
        confirmLabel="Remove"
        destructive
        pending={pending === "remove-project"}
        onConfirm={() => void run("remove-project", () => engineeringApi(`/api/people/${personId}/projects/${project.id}`, { method: "DELETE" }), `${name} is off the project.`, () => setOpen(false))}
      />
    </>
  );
}
