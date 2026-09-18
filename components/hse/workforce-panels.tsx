"use client";

import * as React from "react";

import { engineeringApi } from "@/components/engineering/engineering-api";
import { FormDialog, useCommand } from "@/components/engineering/form-kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { IncidentPersonDTO, PermitWorkerDTO } from "@/lib/modules/hse/hse.workforce";

/**
 * The people on a safety record who need no login (E-04 §73, §74): who an
 * incident involved, and who a permit covers — employees of the company, or a
 * name for somebody it does not employ, or a whole crew. Each change is the
 * server's to decide; this collects it and says what happened.
 */

type Option = { value: string; label: string };

const INVOLVEMENT_LABELS: Record<IncidentPersonDTO["involvement"], string> = { INJURED: "Injured", WITNESS: "Witness", INVOLVED: "Involved" };

export function IncidentPeople({ incidentId, people, canEdit, employees }: { incidentId: string; people: IncidentPersonDTO[]; canEdit: boolean; employees: Option[] }) {
  const { run, pending } = useCommand();
  const [open, setOpen] = React.useState(false);
  return (
    <section className="nesto-card p-5" aria-labelledby="incident-people-heading" data-testid="incident-people">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="incident-people-heading" className="text-card font-semibold text-fg">
          People involved
        </h2>
        {canEdit ? (
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)} data-testid="add-incident-person">
            Add person
          </Button>
        ) : null}
      </div>
      {people.length === 0 ? (
        <p className="mt-2 text-table text-fg-subtle">Nobody recorded.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {people.map((person) => (
            <li key={person.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5" data-testid="incident-person">
              <span className="text-table text-fg">
                {person.worker?.name ?? person.externalName}
                {person.worker ? null : <span className="ml-2 text-meta text-fg-subtle">Not an employee</span>}
                {person.notes ? <span className="block text-meta text-fg-subtle">{person.notes}</span> : null}
              </span>
              <span className="flex items-center gap-2">
                <Badge tone={person.involvement === "INJURED" ? "danger" : "default"}>{INVOLVEMENT_LABELS[person.involvement]}</Badge>
                {canEdit ? (
                  <Button size="sm" variant="ghost" disabled={pending !== null} onClick={() => void run(person.id, () => engineeringApi(`/api/hse/incidents/${incidentId}/people/${person.id}`, { method: "DELETE" }), "Removed.")}>
                    Remove<span className="sr-only"> {person.worker?.name ?? person.externalName}</span>
                  </Button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="Add somebody the incident involved"
        description="An employee — with or without a NESTO account — or the name of a subcontractor or visitor. What happened to them stays in the incident."
        fields={[
          { name: "employeeId", label: "Employee", type: "select", emptyLabel: "Not an employee", options: employees, wide: true },
          { name: "externalName", label: "Or a name", type: "text", placeholder: "Subcontractor or visitor", wide: true },
          { name: "involvement", label: "Involvement", type: "select", required: true, options: Object.entries(INVOLVEMENT_LABELS).map(([value, label]) => ({ value, label })) },
          { name: "notes", label: "Note", type: "textarea", rows: 2 },
        ]}
        initial={{ involvement: "INVOLVED" }}
        submitLabel="Add"
        testId="incident-person-dialog"
        onSubmit={async (payload) => {
          await engineeringApi(`/api/hse/incidents/${incidentId}/people`, { body: payload });
          await run("person", async () => null, "Recorded.");
        }}
      />
    </section>
  );
}

export function PermitWorkers({ permitId, workers, canEdit, employees, crews }: { permitId: string; workers: PermitWorkerDTO[]; canEdit: boolean; employees: Option[]; crews: Option[] }) {
  const { run, pending } = useCommand();
  const [open, setOpen] = React.useState(false);
  return (
    <section className="nesto-card p-5" aria-labelledby="permit-workers-heading" data-testid="permit-workers">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="permit-workers-heading" className="text-card font-semibold text-fg">
          Who it covers
        </h2>
        {canEdit ? (
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)} data-testid="add-permit-worker">
            Add worker or crew
          </Button>
        ) : null}
      </div>
      {workers.length === 0 ? (
        <p className="mt-2 text-table text-fg-subtle">Nobody named yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {workers.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5" data-testid="permit-worker">
              <span className="text-table text-fg">
                {row.worker?.name ?? row.crew?.name}
                {row.crew ? <span className="ml-2 text-meta text-fg-subtle">Crew · {row.crew.size} {row.crew.size === 1 ? "person" : "people"} today</span> : null}
              </span>
              {canEdit ? (
                <Button size="sm" variant="ghost" disabled={pending !== null} onClick={() => void run(row.id, () => engineeringApi(`/api/hse/permits/${permitId}/workers/${row.id}`, { method: "DELETE" }), "Removed.")}>
                  Remove<span className="sr-only"> {row.worker?.name ?? row.crew?.name}</span>
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="Add to the permit"
        description="A person the company employs — a NESTO account is not needed — or one of its crews."
        fields={[
          { name: "employeeId", label: "Person", type: "select", emptyLabel: "—", options: employees, wide: true },
          { name: "crewId", label: "Or a crew", type: "select", emptyLabel: "—", options: crews, wide: true },
        ]}
        submitLabel="Add"
        testId="permit-worker-dialog"
        onSubmit={async (payload) => {
          await engineeringApi(`/api/hse/permits/${permitId}/workers`, { body: payload });
          await run("worker", async () => null, "Added.");
        }}
      />
    </section>
  );
}
