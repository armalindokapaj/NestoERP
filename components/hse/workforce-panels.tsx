"use client";

import * as React from "react";

import { engineeringApi } from "@/components/engineering/engineering-api";
import { FormDialog, useCommand } from "@/components/engineering/form-kit";
import { PersonLink } from "@/components/people/person-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { IncidentPersonDTO, PermitWorkerDTO } from "@/lib/modules/hse/hse.workforce";
import { useHseTranslations } from "@/components/hse/hse-text";

/**
 * The people on a safety record who need no login (E-04 §73, §74): who an
 * incident involved, and who a permit covers — employees of the company, or a
 * name for somebody it does not employ, or a whole crew. Each change is the
 * server's to decide; this collects it and says what happened.
 */

type Option = { value: string; label: string };

const INVOLVEMENT_LABELS: Record<IncidentPersonDTO["involvement"], true> = { INJURED: true, WITNESS: true, INVOLVED: true };

export function IncidentPeople({ incidentId, people, canEdit, employees }: { incidentId: string; people: IncidentPersonDTO[]; canEdit: boolean; employees: Option[] }) {
  const { run, pending } = useCommand();
  const t = useHseTranslations();
  const [open, setOpen] = React.useState(false);
  return (
    <section className="nesto-card p-5" aria-labelledby="incident-people-heading" data-testid="incident-people">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="incident-people-heading" className="text-card font-semibold text-fg">
          {t("people.heading")}
        </h2>
        {canEdit ? (
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)} data-testid="add-incident-person">
            {t("people.add")}
          </Button>
        ) : null}
      </div>
      {people.length === 0 ? (
        <p className="mt-2 text-table text-fg-subtle">{t("people.nobody")}</p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {people.map((person) => (
            <li key={person.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5" data-testid="incident-person">
              <span className="text-table text-fg">
                {person.worker ? <PersonLink personId={person.worker.personId} name={person.worker.name} /> : person.externalName}
                {person.worker ? null : <span className="ml-2 text-meta text-fg-subtle">{t("people.notEmployee")}</span>}
                {person.notes ? <span className="block text-meta text-fg-subtle">{person.notes}</span> : null}
              </span>
              <span className="flex items-center gap-2">
                <Badge tone={person.involvement === "INJURED" ? "danger" : "default"}>{t(`people.involvementLabel.${person.involvement}`)}</Badge>
                {canEdit ? (
                  <Button size="sm" variant="ghost" disabled={pending !== null} onClick={() => void run(person.id, () => engineeringApi(`/api/hse/incidents/${incidentId}/people/${person.id}`, { method: "DELETE" }), t("people.removed"))}>
                    {t("people.remove")}<span className="sr-only"> {person.worker?.name ?? person.externalName}</span>
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
        title={t("people.dialogTitle")}
        description={t("people.dialogDescription")}
        fields={[
          { name: "employeeId", label: t("people.employee"), type: "select", emptyLabel: t("people.notEmployee"), options: employees, wide: true },
          { name: "externalName", label: t("people.orName"), type: "text", placeholder: t("people.subOrVisitor"), wide: true },
          { name: "involvement", label: t("people.involvement"), type: "select", required: true, options: Object.keys(INVOLVEMENT_LABELS).map((value) => ({ value, label: t(`people.involvementLabel.${value as IncidentPersonDTO["involvement"]}`) })) },
          { name: "notes", label: t("people.note"), type: "textarea", rows: 2 },
        ]}
        initial={{ involvement: "INVOLVED" }}
        submitLabel={t("people.addButton")}
        module="hse"
        testId="incident-person-dialog"
        onSubmit={async (payload) => {
          await engineeringApi(`/api/hse/incidents/${incidentId}/people`, { body: payload });
          await run("person", async () => null, t("people.recorded"));
        }}
      />
    </section>
  );
}

export function PermitWorkers({ permitId, workers, canEdit, employees, crews }: { permitId: string; workers: PermitWorkerDTO[]; canEdit: boolean; employees: Option[]; crews: Option[] }) {
  const { run, pending } = useCommand();
  const t = useHseTranslations();
  const [open, setOpen] = React.useState(false);
  return (
    <section className="nesto-card p-5" aria-labelledby="permit-workers-heading" data-testid="permit-workers">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="permit-workers-heading" className="text-card font-semibold text-fg">
          {t("workers.heading")}
        </h2>
        {canEdit ? (
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)} data-testid="add-permit-worker">
            {t("workers.add")}
          </Button>
        ) : null}
      </div>
      {workers.length === 0 ? (
        <p className="mt-2 text-table text-fg-subtle">{t("workers.nobody")}</p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {workers.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5" data-testid="permit-worker">
              <span className="text-table text-fg">
                {row.worker ? <PersonLink personId={row.worker.personId} name={row.worker.name} /> : row.crew?.name}
                {row.crew ? <span className="ml-2 text-meta text-fg-subtle">{t("workers.crewSize", { count: row.crew.size })}</span> : null}
              </span>
              {canEdit ? (
                <Button size="sm" variant="ghost" disabled={pending !== null} onClick={() => void run(row.id, () => engineeringApi(`/api/hse/permits/${permitId}/workers/${row.id}`, { method: "DELETE" }), t("people.removed"))}>
                  {t("people.remove")}<span className="sr-only"> {row.worker?.name ?? row.crew?.name}</span>
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t("workers.dialogTitle")}
        description={t("workers.dialogDescription")}
        fields={[
          { name: "employeeId", label: t("workers.person"), type: "select", emptyLabel: "—", options: employees, wide: true },
          { name: "crewId", label: t("workers.orCrew"), type: "select", emptyLabel: "—", options: crews, wide: true },
        ]}
        submitLabel={t("people.addButton")}
        module="hse"
        testId="permit-worker-dialog"
        onSubmit={async (payload) => {
          await engineeringApi(`/api/hse/permits/${permitId}/workers`, { body: payload });
          await run("worker", async () => null, t("people.added"));
        }}
      />
    </section>
  );
}
