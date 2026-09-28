"use client";

import * as React from "react";

import { engineeringApi } from "@/components/engineering/engineering-api";
import { FormDialog, useCommand } from "@/components/engineering/form-kit";
import { PersonLink } from "@/components/people/person-link";
import { useWorkforceTranslations } from "@/components/workforce/workforce-text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { HseWorkerRef, InductionDTO } from "@/lib/modules/hse/hse.workforce";
import { localDay } from "@/components/hr/local-day";

/**
 * A project's site inductions (E-04 §71, §183, §270): who is working here
 * without one, and who was inducted when. Anybody the company employs can be
 * inducted — a NESTO account is not needed. An induction recorded in error is
 * voided with a reason, never deleted.
 */

type Option = { value: string; label: string };

const today = () => localDay();

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
  const t = useWorkforceTranslations();
  const [recording, setRecording] = React.useState<{ employeeId: string } | null>(null);
  const [voiding, setVoiding] = React.useState<InductionDTO | null>(null);

  return (
    <section className="nesto-card p-0" aria-labelledby="inductions-heading" data-testid="project-inductions">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3.5">
        <h2 id="inductions-heading" className="text-card font-semibold text-fg">
          {t("inductions.heading")}
        </h2>
        {canRecord ? (
          <Button size="sm" variant="secondary" onClick={() => setRecording({ employeeId: "" })} data-testid="record-induction">
            {t("inductions.record")}
          </Button>
        ) : null}
      </div>

      {missing.length > 0 ? (
        <div className="border-b border-line bg-warning-soft px-5 py-3" data-testid="missing-inductions">
          <p className="text-table font-medium text-warning-strong">
            {t("inductions.missing", { count: missing.length })}
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {missing.map((worker) => (
              <li key={worker.employeeId}>
                {canRecord ? (
                  <Button size="sm" variant="secondary" onClick={() => setRecording({ employeeId: worker.employeeId })} data-testid="induct-worker">
                    {t("inductions.induct", { name: worker.name })}
                  </Button>
                ) : (
                  <span className="text-table text-fg">
                    <PersonLink personId={worker.personId} name={worker.name} tab="workforce" />
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {inductions.length === 0 ? (
        <p className="px-5 py-6 text-table text-fg-muted">{t("inductions.none")}</p>
      ) : (
        <ul className="divide-y divide-line">
          {inductions.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3" data-testid="induction" data-worker-name={row.worker.name}>
              <div className="min-w-0">
                <p className="text-body font-medium text-fg">
                  <PersonLink personId={row.worker.personId} name={row.worker.name} tab="workforce" />
                </p>
                <p className="text-meta text-fg-subtle">
                  {row.inductedOn}
                  {row.validUntil ? t("inductions.validUntil", { date: row.validUntil }) : ""}
                  {row.site ? ` · ${row.site.name}` : ""}{t("inductions.by")} <PersonLink memberId={row.conductedByMemberId} name={row.conductedBy} />
                  {row.voidReason ? t("inductions.voidReason", { reason: row.voidReason }) : ""}
                </p>
              </div>
              <span className="flex items-center gap-2">
                <Badge tone={row.voided ? "default" : row.valid ? "success" : "warning"}>{row.voided ? t("inductions.void") : row.valid ? t("inductions.valid") : t("inductions.expired")}</Badge>
                {row.canVoid ? (
                  <Button size="sm" variant="ghost" disabled={pending !== null} onClick={() => setVoiding(row)}>
                    {t("inductions.void")}<span className="sr-only">{t("inductions.voidSr", { name: row.worker.name })}</span>
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
        title={t("inductions.recordTitle")}
        description={t("inductions.recordDescription")}
        fields={[
          { name: "employeeId", label: t("inductions.who"), type: "select", required: true, emptyLabel: t("inductions.chooseSomebody"), options: employees, wide: true },
          { name: "siteId", label: t("inductions.site"), type: "select", emptyLabel: sites.length ? t("inductions.wholeProject") : "—", options: sites, disabled: sites.length === 0 },
          { name: "inductedOn", label: t("inductions.givenOn"), type: "date", required: true },
          { name: "validUntil", label: t("inductions.validUntilLabel"), type: "date", hint: t("inductions.validHint") },
          { name: "notes", label: t("inductions.note"), type: "textarea", rows: 2 },
        ]}
        initial={{ employeeId: recording?.employeeId ?? "", inductedOn: today() }}
        submitLabel={t("inductions.recordSubmit")}
        saveKind="create"
        module="workforce"
        testId="induction-dialog"
        onSubmit={async (payload) => {
          await engineeringApi("/api/hse/inductions", { body: { ...payload, projectId } });
          await run("induct", async () => null, t("inductions.recorded"));
        }}
      />
      <FormDialog
        open={voiding !== null}
        onOpenChange={(open) => !open && setVoiding(null)}
        title={voiding ? t("inductions.voidTitle", { name: voiding.worker.name }) : t("inductions.voidInduction")}
        description={t("inductions.voidDescription")}
        fields={[{ name: "reason", label: t("inductions.reason"), type: "textarea", required: true, rows: 2 }]}
        submitLabel={t("inductions.void")}
        saveKind="none"
        module="workforce"
        onSubmit={async (payload) => {
          if (!voiding) return;
          await engineeringApi(`/api/hse/inductions/${voiding.id}/void`, { body: payload });
          await run("void", async () => null, t("inductions.voided"));
        }}
      />
    </section>
  );
}
