"use client";

import * as React from "react";

import { engineeringApi } from "@/components/engineering/engineering-api";
import { FormDialog, useCommand } from "@/components/engineering/form-kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { HseWorkerRef, InductionDTO } from "@/lib/modules/hse/hse.workforce";

/**
 * A project's site inductions (E-04 §71, §183, §270): who is working here
 * without one, and who was inducted when. Anybody the company employs can be
 * inducted — a NESTO account is not needed. An induction recorded in error is
 * voided with a reason, never deleted.
 */

type Option = { value: string; label: string };

const today = () => new Date().toISOString().slice(0, 10);

export function ProjectInductions({
  projectId,
  inductions,
  missing,
  canRecord,
  employees,
  sites,
}: {
  projectId: string;
  inductions: InductionDTO[];
  missing: HseWorkerRef[];
  canRecord: boolean;
  employees: Option[];
  sites: Option[];
}) {
  const { run, pending } = useCommand();
  const [recording, setRecording] = React.useState<{ employeeId: string } | null>(null);
  const [voiding, setVoiding] = React.useState<InductionDTO | null>(null);

  return (
    <section className="nesto-card p-0" aria-labelledby="inductions-heading" data-testid="project-inductions">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3.5">
        <h2 id="inductions-heading" className="text-card font-semibold text-fg">
          Site inductions
        </h2>
        {canRecord ? (
          <Button size="sm" variant="secondary" onClick={() => setRecording({ employeeId: "" })} data-testid="record-induction">
            Record induction
          </Button>
        ) : null}
      </div>

      {missing.length > 0 ? (
        <div className="border-b border-line bg-warning-soft px-5 py-3" data-testid="missing-inductions">
          <p className="text-table font-medium text-warning-strong">
            {missing.length} {missing.length === 1 ? "person works" : "people work"} here without a valid induction
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {missing.map((worker) => (
              <li key={worker.employeeId}>
                {canRecord ? (
                  <Button size="sm" variant="secondary" onClick={() => setRecording({ employeeId: worker.employeeId })} data-testid="induct-worker">
                    Induct {worker.name}
                  </Button>
                ) : (
                  <span className="text-table text-fg">{worker.name}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {inductions.length === 0 ? (
        <p className="px-5 py-6 text-table text-fg-muted">No inductions recorded on this project.</p>
      ) : (
        <ul className="divide-y divide-line">
          {inductions.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3" data-testid="induction" data-worker-name={row.worker.name}>
              <div className="min-w-0">
                <p className="text-body font-medium text-fg">{row.worker.name}</p>
                <p className="text-meta text-fg-subtle">
                  {row.inductedOn}
                  {row.validUntil ? ` · valid until ${row.validUntil}` : ""}
                  {row.site ? ` · ${row.site.name}` : ""} · by {row.conductedBy}
                  {row.voidReason ? ` · void: ${row.voidReason}` : ""}
                </p>
              </div>
              <span className="flex items-center gap-2">
                <Badge tone={row.voided ? "default" : row.valid ? "success" : "warning"}>{row.voided ? "Void" : row.valid ? "Valid" : "Expired"}</Badge>
                {row.canVoid ? (
                  <Button size="sm" variant="ghost" disabled={pending !== null} onClick={() => setVoiding(row)}>
                    Void<span className="sr-only"> {row.worker.name}&apos;s induction</span>
                  </Button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}

      <FormDialog
        open={recording !== null}
        onOpenChange={(open) => !open && setRecording(null)}
        title="Record a site induction"
        description="Given today or earlier. Anybody the company employs — with or without a NESTO account."
        fields={[
          { name: "employeeId", label: "Who was inducted", type: "select", required: true, emptyLabel: "Choose somebody…", options: employees, wide: true },
          { name: "siteId", label: "Site", type: "select", emptyLabel: sites.length ? "The whole project" : "—", options: sites, disabled: sites.length === 0 },
          { name: "inductedOn", label: "Given on", type: "date", required: true },
          { name: "validUntil", label: "Valid until", type: "date", hint: "Leave empty if it does not expire." },
          { name: "notes", label: "Note", type: "textarea", rows: 2 },
        ]}
        initial={{ employeeId: recording?.employeeId ?? "", inductedOn: today() }}
        submitLabel="Record"
        testId="induction-dialog"
        onSubmit={async (payload) => {
          await engineeringApi("/api/hse/inductions", { body: { ...payload, projectId } });
          await run("induct", async () => null, "Induction recorded.");
        }}
      />
      <FormDialog
        open={voiding !== null}
        onOpenChange={(open) => !open && setVoiding(null)}
        title={voiding ? `Void ${voiding.worker.name}'s induction` : "Void induction"}
        description="It stays on the record, marked void with the reason."
        fields={[{ name: "reason", label: "Reason", type: "textarea", required: true, rows: 2 }]}
        submitLabel="Void"
        onSubmit={async (payload) => {
          if (!voiding) return;
          await engineeringApi(`/api/hse/inductions/${voiding.id}/void`, { body: payload });
          await run("void", async () => null, "Induction voided.");
        }}
      />
    </section>
  );
}
