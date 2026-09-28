"use client";

import * as React from "react";

import { engineeringApi } from "@/components/engineering/engineering-api";
import { FormDialog, useCommand } from "@/components/engineering/form-kit";
import { usePeopleTranslations } from "@/components/people/people-text";
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
  const t = usePeopleTranslations();
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        {t("projectActions.assignButton")}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t("projectActions.assignTitle", { name })}
        description={t("projectActions.assignDescription")}
        fields={[
          { name: "projectId", label: t("projectActions.project"), type: "select", required: true, options: projects.map((project) => ({ value: project.projectId, label: `${project.code} · ${project.name} — ${project.company.name}` })), emptyLabel: t("projectActions.chooseProject") },
          { name: "projectRole", label: t("projectActions.roleOnProject"), type: "text", placeholder: t("projectActions.rolePlaceholder") },
        ]}
        initial={{ projectId: "", projectRole: "" }}
        submitLabel={t("projectActions.assign")}
        // Putting somebody on a project is a record like any other: the prompt may save it (AUD-03 §3).
        saveKind="create"
        module="people"
        testId="assign-project-dialog"
        onSubmit={async (payload) => {
          await engineeringApi(`/api/people/${personId}/projects`, { method: "POST", body: payload });
          await run("assign-project", async () => null, t("projectActions.onProject", { name }));
        }}
      />
    </>
  );
}

export function RemoveFromProjectButton({ personId, name, project }: { personId: string; name: string; project: { id: string; name: string } }) {
  const { pending, run } = useCommand();
  const t = usePeopleTranslations();
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)} aria-label={t("projectActions.takeOff", { name, project: project.name })}>
        {t("projectActions.remove")}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t("projectActions.takeOffTitle", { name, project: project.name })}
        description={t("projectActions.takeOffDescription")}
        confirmLabel={t("projectActions.remove")}
        destructive
        pending={pending === "remove-project"}
        onConfirm={() => void run("remove-project", () => engineeringApi(`/api/people/${personId}/projects/${project.id}`, { method: "DELETE" }), t("projectActions.offProject", { name }), () => setOpen(false))}
      />
    </>
  );
}
