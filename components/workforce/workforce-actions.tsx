"use client";

import * as React from "react";

import { engineeringApi } from "@/components/engineering/engineering-api";
import { FormDialog, useCommand, type FormField, type FormValues } from "@/components/engineering/form-kit";
import { Button } from "@/components/ui/button";

/**
 * The workforce's commands (E-04 §114, §115, §138): put somebody in a crew or
 * move them, assign them to a project and a site or move them, and end either
 * after a last day. Every one of them is decided by the server — these only
 * collect what it needs and say what happened.
 */

type Option = { value: string; label: string };
export type SiteOption = { id: string; projectId: string; name: string };

const today = () => new Date().toISOString().slice(0, 10);

/* Crews ---------------------------------------------------------------------- */

export function AssignCrewButton({
  employeeId,
  workers = [],
  crewId,
  crews = [],
  name,
  label = "Add to crew",
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
  const [open, setOpen] = React.useState(false);
  const fields: FormField[] = [
    ...(employeeId ? [] : [{ name: "employeeId", label: "Worker", type: "select" as const, required: true, emptyLabel: "Choose somebody…", options: workers, wide: true }]),
    ...(crewId ? [] : [{ name: "crewId", label: "Crew", type: "select" as const, required: true, emptyLabel: "Choose a crew…", options: crews, wide: true }]),
    { name: "startDate", label: "From", type: "date", required: true },
    { name: "role", label: "Role in the crew", type: "text", placeholder: "For example Foreman's assistant" },
    { name: "transfer", label: "If they are in another crew, move them from it", type: "checkbox", hint: "Their membership there ends the day before; both stay in their history." },
  ];
  return (
    <>
      <Button size="sm" variant={variant} onClick={() => setOpen(true)} data-testid="assign-crew">
        {label}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={name ? `Put ${name} in a crew` : "Add somebody to this crew"}
        description="Somebody is in one crew at a time. With or without a NESTO account."
        fields={fields}
        initial={{ startDate: today(), transfer: false }}
        submitLabel="Add to crew"
        testId="assign-crew-dialog"
        onSubmit={async (payload) => {
          const worker = employeeId ?? String(payload.employeeId ?? "");
          await engineeringApi(`/api/workforce/employees/${worker}/crew-assignments`, { body: { crewId: crewId ?? payload.crewId, startDate: payload.startDate, role: payload.role, transfer: payload.transfer } });
          await run("crew", async () => null, "Added to the crew.");
        }}
      />
    </>
  );
}

export function EndMembershipButton({ employeeId, membershipId, what, url, label = "End" }: { employeeId: string; membershipId: string; what: string; url: "crew-assignments" | "project-assignments"; label?: string }) {
  const { run } = useCommand();
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)} data-testid={`end-${url}`}>
        {label}
        <span className="sr-only"> {what}</span>
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={`End ${what}`}
        description="The last day is included. The history keeps it."
        fields={[
          { name: "endDate", label: "Last day", type: "date", required: true },
          { name: "reason", label: "Reason", type: "textarea", rows: 2 },
        ]}
        initial={{ endDate: today() }}
        submitLabel="End"
        testId="end-assignment-dialog"
        onSubmit={async (payload) => {
          await engineeringApi(`/api/workforce/employees/${employeeId}/${url}/${membershipId}/end`, { body: payload });
          await run("end", async () => null, "Ended.");
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
  label = "Assign to project",
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
  const [open, setOpen] = React.useState(false);
  const [values, setValues] = React.useState<FormValues>({});
  const chosenProject = projectId ?? String(values.projectId ?? "");
  const siteOptions = sites.filter((site) => site.projectId === chosenProject).map((site) => ({ value: site.id, label: site.name }));
  const fields: FormField[] = [
    ...(employeeId ? [] : [{ name: "employeeId", label: "Worker", type: "select" as const, required: true, emptyLabel: "Choose somebody…", options: workers, wide: true }]),
    ...(projectId ? [] : [{ name: "projectId", label: "Project", type: "select" as const, required: true, emptyLabel: "Choose a project…", options: projects.map((project) => ({ value: project.id, label: project.name })), wide: true }]),
    { name: "siteId", label: "Site", type: "select", emptyLabel: siteOptions.length ? "The whole project" : "The project has no sites", options: siteOptions, disabled: siteOptions.length === 0 },
    { name: "tradeId", label: "Trade on this project", type: "select", emptyLabel: "Their usual trade", options: trades },
    { name: "role", label: "Role", type: "text", placeholder: "For example Site foreman" },
    { name: "startDate", label: "From", type: "date", required: true },
    ...(moveFrom.length ? [{ name: "transferFromId", label: "Moving from", type: "select" as const, emptyLabel: "Not a move — an extra assignment", options: moveFrom, wide: true, hint: "That assignment ends the day before this one starts." }] : []),
    { name: "isPrimary", label: "Their main project", type: "checkbox", hint: "One main project at a time. A move keeps it main." },
  ];
  return (
    <>
      <Button size="sm" variant={variant} onClick={() => setOpen(true)} data-testid="assign-project">
        {label}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={name ? `Assign ${name}` : "Assign somebody to this project"}
        description="A workforce assignment: where they work. It gives no NESTO access to the project."
        fields={fields}
        initial={{ startDate: today(), isPrimary: false }}
        onValuesChange={setValues}
        submitLabel="Assign"
        testId="assign-project-dialog"
        onSubmit={async (payload) => {
          const worker = employeeId ?? String(payload.employeeId ?? "");
          const { employeeId: _chosen, ...body } = payload;
          void _chosen;
          await engineeringApi(`/api/workforce/employees/${worker}/project-assignments`, { body: { ...body, projectId: projectId ?? payload.projectId } });
          await run("assign", async () => null, "Assigned.");
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
  const [open, setOpen] = React.useState(false);
  const [values, setValues] = React.useState<FormValues>({});
  const chosenProject = String(values.projectId ?? crew?.projectId ?? "");
  const siteOptions = sites.filter((site) => site.projectId === chosenProject).map((site) => ({ value: site.id, label: site.name }));
  const fields: FormField[] = [
    { name: "name", label: "Name", type: "text", required: true, placeholder: "For example Block A formwork", wide: true },
    { name: "projectId", label: "Project", type: "select", required: projectRequired, emptyLabel: projectRequired ? "Choose a project…" : "No project — company crew", options: projects.map((project) => ({ value: project.id, label: project.name })) },
    { name: "siteId", label: "Site", type: "select", emptyLabel: siteOptions.length ? "The whole project" : "—", options: siteOptions, disabled: siteOptions.length === 0 },
    { name: "supervisorEmployeeId", label: "Supervisor (foreman)", type: "select", emptyLabel: "Nobody yet", options: supervisors, hint: "Anybody employed here — a NESTO account is not needed." },
    { name: "tradeId", label: "Trade", type: "select", emptyLabel: "Mixed", options: trades },
    { name: "notes", label: "Notes", type: "textarea", rows: 2 },
  ];
  return (
    <>
      <Button size="sm" variant={crew ? "secondary" : "primary"} onClick={() => setOpen(true)} data-testid={crew ? "edit-crew" : "new-crew"}>
        {label ?? (crew ? "Edit crew" : "New crew")}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={crew ? `Edit ${crew.name}` : "New crew"}
        fields={fields}
        initial={crew ?? {}}
        onValuesChange={setValues}
        submitLabel={crew ? "Save" : "Create crew"}
        testId="crew-dialog"
        onSubmit={async (payload) => {
          if (crew?.id) await engineeringApi(`/api/workforce/crews/${crew.id}`, { method: "PATCH", body: payload });
          else await engineeringApi("/api/workforce/crews", { body: payload });
          await run("crew", async () => null, crew ? "Crew saved." : "Crew created.");
        }}
      />
    </>
  );
}

export function CrewStatusButton({ crewId, archived }: { crewId: string; archived: boolean }) {
  const { run, pending } = useCommand();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending !== null}
      onClick={() => void run("status", () => engineeringApi(`/api/workforce/crews/${crewId}`, { method: "PATCH", body: { status: archived ? "ACTIVE" : "ARCHIVED" } }), archived ? "Crew in use again." : "Crew archived.")}
    >
      {archived ? "Use again" : "Archive"}
    </Button>
  );
}
