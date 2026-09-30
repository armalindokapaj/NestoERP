"use client";

import * as React from "react";
import { AlertTriangle } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { INCIDENT_TYPES, SEVERITIES } from "@/lib/modules/hse/hse.status";
import { isSerious, pendingHseReports, queueHseReport, validateHseReport, type HseReportInput } from "@/lib/offline/modules/hse";
import { offlineRuntime } from "@/lib/offline/runtime";

import { useOfflineQuery } from "./use-offline-data";

const nowLocal = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

/**
 * Reporting an HSE issue with no connection (MOB-09 §49, §50). The report is
 * kept on the device, and the screen says — in words, not colour — that nobody
 * has been told yet. For a high or critical report it says so more loudly.
 */
export function HseForm({ projectId, projectName, companyId, locked }: { projectId: string; projectName: string; companyId: string; locked: boolean }) {
  const t = useTranslations("offline");
  const [form, setForm] = React.useState<HseReportInput>({ incidentType: "INCIDENT", severity: "LOW", title: "", description: "", locationText: "", occurredAt: nowLocal(), immediateAction: "", injuryOccurred: false });
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const reports = useOfflineQuery((db) => pendingHseReports(db, projectId), [projectId]);

  const set = <K extends keyof HseReportInput>(key: K, value: HseReportInput[K]) => setForm((current) => ({ ...current, [key]: value }));
  const serious = isSerious(form.severity);

  const submit = async () => {
    setError(null);
    const verdict = validateHseReport({ ...form, occurredAt: new Date(form.occurredAt).toISOString() });
    if (!verdict.ok) return setError(verdict.message);
    await offlineRuntime().run((db) => queueHseReport(db, { companyId, projectId, projectLabel: projectName, report: { ...form, occurredAt: new Date(form.occurredAt).toISOString() } }));
    setSaved(true);
    setForm((current) => ({ ...current, title: "", description: "", immediateAction: "", locationText: "" }));
  };

  return (
    <div className="space-y-4" data-testid="hse-form">
      <h2 className="text-h2 font-semibold">{t("hse.newReport")}</h2>
      {!locked ? (
        <Card className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-body font-medium">{t("hse.type")}</span>
              <select className="h-10 w-full rounded-md border border-line-strong bg-surface px-2" value={form.incidentType} onChange={(event) => set("incidentType", event.target.value as HseReportInput["incidentType"])} data-testid="hse-type">
                {INCIDENT_TYPES.map((type) => <option key={type} value={type}>{t(`hse.types.${type}` as never)}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-body font-medium">{t("hse.severity")}</span>
              <select className="h-10 w-full rounded-md border border-line-strong bg-surface px-2" value={form.severity} onChange={(event) => set("severity", event.target.value as HseReportInput["severity"])} data-testid="hse-severity">
                {SEVERITIES.map((severity) => <option key={severity} value={severity}>{t(`hse.severities.${severity}` as never)}</option>)}
              </select>
            </label>
          </div>
          <label className="block space-y-1">
            <span className="text-body font-medium">{t("hse.titleLabel")}</span>
            <Input value={form.title} onChange={(event) => set("title", event.target.value)} data-testid="hse-title" />
          </label>
          <label className="block space-y-1">
            <span className="text-body font-medium">{t("hse.description")}</span>
            <Textarea rows={3} value={form.description} onChange={(event) => set("description", event.target.value)} data-testid="hse-description" />
          </label>
          <label className="block space-y-1">
            <span className="text-body font-medium">{t("hse.location")}</span>
            <Input value={form.locationText ?? ""} onChange={(event) => set("locationText", event.target.value)} />
          </label>
          <label className="block space-y-1">
            <span className="text-body font-medium">{t("hse.when")}</span>
            <Input type="datetime-local" value={form.occurredAt} onChange={(event) => set("occurredAt", event.target.value)} />
          </label>
          {serious ? (
            <label className="block space-y-1">
              <span className="text-body font-medium">{t("hse.immediateAction")}</span>
              <Textarea rows={2} value={form.immediateAction ?? ""} onChange={(event) => set("immediateAction", event.target.value)} data-testid="hse-action" />
            </label>
          ) : null}
          <label className="flex items-center gap-2 text-body">
            <input type="checkbox" checked={Boolean(form.injuryOccurred)} onChange={(event) => set("injuryOccurred", event.target.checked)} /> {t("hse.injury")}
          </label>
          <p role="note" className={serious ? "flex gap-2 rounded-md bg-danger-soft px-3 py-2 text-body text-danger-strong" : "text-body text-fg-muted"} data-testid="hse-unsent-notice">
            {serious ? <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> : null}
            <span>{serious ? t("hse.unsentSerious") : t("hse.unsent")}</span>
          </p>
          {error ? <p role="alert" className="text-body text-danger-strong">{error}</p> : null}
          <Button onClick={submit} data-testid="hse-submit">{t("hse.submit")}</Button>
          {saved ? <p role="status" className="text-body text-success-strong" data-testid="hse-saved">{t("hse.queued")}</p> : null}
        </Card>
      ) : null}

      <section className="space-y-2">
        {reports && reports.length === 0 ? <p className="text-body text-fg-muted">{t("hse.none")}</p> : null}
        {!locked && reports?.map((report) => (
          <Card key={report.mutationId} compact data-testid="hse-pending-report">
            <p className="font-medium">{report.title}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Badge tone={report.state === "FAILED" ? "danger" : "warning"}>{report.state === "FAILED" ? t("sync.state.FAILED") : t("diary.waitingToSync")}</Badge>
              <span className="text-micro text-fg-muted">{report.serious ? t("hse.unsentSerious") : t("hse.unsent")}</span>
            </div>
            {report.message ? <p className="text-body text-fg-muted">{report.message}</p> : null}
          </Card>
        ))}
      </section>
    </div>
  );
}

export { validateHseReport };
