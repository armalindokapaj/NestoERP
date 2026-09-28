"use client";

import * as React from "react";

import { engineeringApi } from "@/components/engineering/engineering-api";
import { FormDialog, useCommand, type FormField, type FormValues } from "@/components/engineering/form-kit";
import { useWorkforceTranslations } from "@/components/workforce/workforce-text";
import { Button } from "@/components/ui/button";
import { localDay } from "@/components/hr/local-day";

/**
 * The workforce's commands (E-04 §114, §115, §138): put somebody in a crew or
 * move them, assign them to a project and a site or move them, and end either
 * after a last day. Every one of them is decided by the server — these only
 * collect what it needs and say what happened.
 */

type Option = { value: string; label: string };
export type SiteOption = { id: string; projectId: string; name: string };

const today = () => localDay();

/* Crews ---------------------------------------------------------------------- */

export function AssignCrewButton({
  employeeId,
  workers = [],
  crewId,
  crews = [],
  name,
  label,
  variant = "secondary",
}: {
  /** The worker, when the button sits on their page; otherwise one is chosen. */
  employeeId?: string;
  workers?: Option[];
  /** The crew, when the button sits on its page; otherwise one is chosen. */
  crewId?: string;
  crews?: Option[];
  name?: string;
  label?: string;
  variant?: "primary" | "secondary";
}) {
  const { run } = useCommand();
  const t = useWorkforceTranslations();
  const [open, setOpen] = React.useState(false);
  const fields: FormField[] = [
    ...(employeeId ? [] : [{ name: "employeeId", label: t("actions.worker"), type: "select" as const, required: true, emptyLabel: t("actions.chooseSomebody"), options: workers, wide: true }]),
    ...(crewId ? [] : [{ name: "crewId", label: t("actions.crew"), type: "select" as const, required: true, emptyLabel: t("actions.chooseCrew"), options: crews, wide: true }]),
    { name: "startDate", label: t("actions.from"), type: "date", required: true },
    { name: "role", label: t("actions.roleInCrew"), type: "text", placeholder: t("actions.roleInCrewPlaceholder") },
    { name: "transfer", label: t("actions.transfer"), type: "checkbox", hint: t("actions.transferHint") },
  ];
  return (
    <>
      <Button size="sm" variant={variant} onClick={() => setOpen(true)} data-testid="assign-crew">
        {label ?? t("actions.addToCrew")}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={name ? t("actions.putInCrew", { name }) : t("actions.addSomebody")}
        description={t("actions.crewDescription")}
        fields={fields}
        initial={{ startDate: today(), transfer: false }}
        submitLabel={t("actions.addToCrew")}
        saveKind="create"
        module="workforce"
        testId="assign-crew-dialog"
        onSubmit={async (payload) => {
          const worker = employeeId ?? String(payload.employeeId ?? "");
          await engineeringApi(`/api/workforce/employees/${worker}/crew-assignments`, { body: { crewId: crewId ?? payload.crewId, startDate: payload.startDate, role: payload.role, transfer: payload.transfer } });
          await run("crew", async () => null, t("actions.added"));
        }}
      />
    </>
  );
}

export function EndMembershipButton({ employeeId, membershipId, what, url, label }: { employeeId: string; membershipId: string; what: string; url: "crew-assignments" | "project-assignments"; label?: string }) {
  const { run } = useCommand();
  const t = useWorkforceTranslations();
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)} data-testid={`end-${url}`}>
        {label ?? t("actions.end")}
        <span className="sr-only"> {what}</span>
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t("actions.endTitle", { what })}
        description={t("actions.endDescription")}
        fields={[
          { name: "endDate", label: t("actions.lastDay"), type: "date", required: true },
          { name: "reason", label: t("actions.reason"), type: "textarea", rows: 2 },
        ]}
        initial={{ endDate: today() }}
        submitLabel={t("actions.end")}
        saveKind="none"
        module="workforce"
        testId="end-assignment-dialog"
        onSubmit={async (payload) => {
          await engineeringApi(`/api/workforce/employees/${employeeId}/${url}/${membershipId}/end`, { body: payload });
          await run("end", async () => null, t("actions.ended"));
        }}
      />
    </>
  );
}

/* Projects ------------------------------------------------------------------- */

export function AssignProjectButton({
  employeeId,
  workers = [],
  projectId,
  projects = [],
  sites,
  trades,
  moveFrom = [],
  name,
  label,
  variant = "secondary",
}: {
  employeeId?: string;
  workers?: Option[];
  projectId?: string;
  projects?: Array<{ id: string; name: string }>;
  sites: SiteOption[];
  trades: Option[];
  /** Their current assignments, to move from (§42). */
  moveFrom?: Option[];
  name?: string;
  label?: string;
  variant?: "primary" | "secondary";
}) {
  const { run } = useCommand();
  const t = useWorkforceTranslations();
  const [open, setOpen] = React.useState(false);
  const [values, setValues] = React.useState<FormValues>({});
  const chosenProject = projectId ?? String(values.projectId ?? "");
  const siteOptions = sites.filter((site) => site.projectId === chosenProject).map((site) => ({ value: site.id, label: site.name }));
  const fields: FormField[] = [
    ...(employeeId ? [] : [{ name: "employeeId", label: t("actions.worker"), type: "select" as const, required: true, emptyLabel: t("actions.chooseSomebody"), options: workers, wide: true }]),
    ...(projectId ? [] : [{ name: "projectId", label: t("actions.project"), type: "select" as const, required: true, emptyLabel: t("actions.chooseProject"), options: projects.map((project) => ({ value: project.id, label: project.name })), wide: true }]),
    { name: "siteId", label: t("actions.site"), type: "select", emptyLabel: siteOptions.length ? t("actions.wholeProject") : t("actions.noSites"), options: siteOptions, disabled: siteOptions.length === 0 },
    { name: "tradeId", label: t("actions.tradeOnProject"), type: "select", emptyLabel: t("actions.usualTrade"), options: trades },
    { name: "role", label: t("actions.role"), type: "text", placeholder: t("actions.rolePlaceholder") },
    { name: "startDate", label: t("actions.from"), type: "date", required: true },
    ...(moveFrom.length ? [{ name: "transferFromId", label: t("actions.movingFrom"), type: "select" as const, emptyLabel: t("actions.notAMove"), options: moveFrom, wide: true, hint: t("actions.movingHint") }] : []),
    { name: "isPrimary", label: t("actions.mainProject"), type: "checkbox", hint: t("actions.mainHint") },
  ];
  return (
    <>
      <Button size="sm" variant={variant} onClick={() => setOpen(true)} data-testid="assign-project">
        {label ?? t("actions.assignToProject")}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={name ? t("actions.assignName", { name }) : t("actions.assignSomebody")}
        description={t("actions.assignDescription")}
        fields={fields}
        initial={{ startDate: today(), isPrimary: false }}
        onValuesChange={setValues}
        submitLabel={t("actions.assign")}
        // An assignment is a record like any other: the prompt may save it (AUD-03 §3).
        saveKind="create"
        module="workforce"
        testId="assign-project-dialog"
        onSubmit={async (payload) => {
          const worker = employeeId ?? String(payload.employeeId ?? "");
          const { employeeId: _chosen, ...body } = payload;
          void _chosen;
          await engineeringApi(`/api/workforce/employees/${worker}/project-assignments`, { body: { ...body, projectId: projectId ?? payload.projectId } });
          await run("assign", async () => null, t("actions.assigned"));
        }}
      />
    </>
  );
}

/* A crew itself -------------------------------------------------------------- */

export type CrewFormValues = { id?: string; name: string; projectId: string | null; siteId: string | null; tradeId: string | null; supervisorEmployeeId: string | null; notes: string | null };

export function CrewFormButton({
  crew,
  projects,
  sites,
  trades,
  supervisors,
  projectRequired,
  label,
}: {
  crew?: CrewFormValues;
  projects: Array<{ id: string; name: string }>;
  sites: SiteOption[];
  trades: Option[];
  supervisors: Option[];
  /** A reader who sees only their projects keeps crews on those projects. */
  projectRequired: boolean;
  label?: string;
}) {
  const { run } = useCommand();
  const t = useWorkforceTranslations();
  const [open, setOpen] = React.useState(false);
  const [values, setValues] = React.useState<FormValues>({});
  const chosenProject = String(values.projectId ?? crew?.projectId ?? "");
  const siteOptions = sites.filter((site) => site.projectId === chosenProject).map((site) => ({ value: site.id, label: site.name }));
  const fields: FormField[] = [
    { name: "name", label: t("actions.name"), type: "text", required: true, placeholder: t("actions.crewNamePlaceholder"), wide: true },
    { name: "projectId", label: t("actions.project"), type: "select", required: projectRequired, emptyLabel: projectRequired ? t("actions.chooseProject") : t("actions.noProject"), options: projects.map((project) => ({ value: project.id, label: project.name })) },
    { name: "siteId", label: t("actions.site"), type: "select", emptyLabel: siteOptions.length ? t("actions.wholeProject") : "—", options: siteOptions, disabled: siteOptions.length === 0 },
    { name: "supervisorEmployeeId", label: t("actions.supervisor"), type: "select", emptyLabel: t("actions.nobodyYet"), options: supervisors, hint: t("actions.supervisorHint") },
    { name: "tradeId", label: t("actions.trade"), type: "select", emptyLabel: t("actions.mixed"), options: trades },
    { name: "notes", label: t("actions.notes"), type: "textarea", rows: 2 },
  ];
  return (
    <>
      <Button size="sm" variant={crew ? "secondary" : "primary"} onClick={() => setOpen(true)} data-testid={crew ? "edit-crew" : "new-crew"}>
        {label ?? (crew ? t("actions.editCrew") : t("actions.newCrew"))}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={crew ? t("actions.editName", { name: crew.name }) : t("actions.newCrew")}
        fields={fields}
        initial={crew ?? {}}
        onValuesChange={setValues}
        submitLabel={crew ? t("actions.save") : t("actions.createCrew")}
        saveKind={crew ? "save" : "create"}
        module="workforce"
        testId="crew-dialog"
        onSubmit={async (payload) => {
          if (crew?.id) await engineeringApi(`/api/workforce/crews/${crew.id}`, { method: "PATCH", body: payload });
          else await engineeringApi("/api/workforce/crews", { body: payload });
          await run("crew", async () => null, crew ? t("actions.crewSaved") : t("actions.crewCreated"));
        }}
      />
    </>
  );
}

export function CrewStatusButton({ crewId, archived }: { crewId: string; archived: boolean }) {
  const { run, pending } = useCommand();
  const t = useWorkforceTranslations();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending !== null}
      onClick={() => void run("status", () => engineeringApi(`/api/workforce/crews/${crewId}`, { method: "PATCH", body: { status: archived ? "ACTIVE" : "ARCHIVED" } }), archived ? t("actions.inUseAgain") : t("actions.crewArchived"))}
    >
      {archived ? t("actions.useAgain") : t("actions.archive")}
    </Button>
  );
}
