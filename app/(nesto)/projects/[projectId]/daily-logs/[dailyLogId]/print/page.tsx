import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { notFound } from "next/navigation";

import { PrintButton } from "@/components/meetings/print-button";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { prisma } from "@/lib/database/prisma";
import { getDailyLog } from "@/lib/modules/daily-logs/daily-log.service";
import { dateLabel, formatDuration, longDateLabel } from "@/lib/modules/daily-logs/daily-log.time";
import {
  DAILY_LOG_STATUS_LABELS,
  DELAY_CATEGORY_LABELS,
  DELAY_IMPACT_LABELS,
  DOCUMENT_CATEGORY_LABELS,
  EQUIPMENT_STATUS_LABELS,
  SITE_CONDITION_LABELS,
  TASK_LINK_TYPE_LABELS,
  WEATHER_CONDITION_LABELS,
} from "@/lib/modules/daily-logs/daily-log.types";

type Params = { params: Promise<{ projectId: string; dailyLogId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("projects"))("dailyLogs.printTitle") };
}

const joined = (...parts: Array<string | number | null | undefined | false>) => parts.filter((part) => part !== null && part !== undefined && part !== false && part !== "").join(" · ");

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="break-inside-avoid border-t border-line pt-3">
      <h2 className="text-card font-semibold text-fg">{title}</h2>
      <div className="mt-1.5 text-table text-fg">{children}</div>
    </section>
  );
}

/** The print-friendly daily log (PRD #43 §211, §212): everything the record holds, on paper. */
export default async function DailyLogPrintPage({ params }: Params) {
  const { projectId, dailyLogId } = await params;
  const context = await requireModule("dailyLogs");
  let log;
  try {
    log = await getDailyLog(context, dailyLogId);
  } catch (error) {
    if (error instanceof AccessError) notFound();
    throw error;
  }
  if (log.project.id !== projectId) notFound();
  const company = await prisma.company.findUnique({ where: { id: context.companyId }, select: { name: true } });
  const t = await getTranslations("projects");
  const none = <p className="text-fg-muted">{t("dailyLogs.noneRecorded")}</p>;

  return (
    <article className="mx-auto max-w-3xl space-y-4 bg-surface p-6 print:p-0" data-testid="daily-log-print">
      {/* Wraps on a phone: the Print button drops under a long project name (AUD-04 §3, MW-01). */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 break-words">
          <p className="text-meta text-fg-muted">{company?.name}</p>
          <h1 className="text-page font-semibold text-fg">{t("dailyLogs.heading", { project: log.project.name })}</h1>
          <p className="text-body text-fg">{longDateLabel(log.workDate)}</p>
          <p className="text-meta text-fg-muted">
            {joined(DAILY_LOG_STATUS_LABELS[log.status], log.lateEntry && t("dailyLogs.lateEntry"), log.corrections.length > 0 && t("dailyLogs.corrected"), log.createdBy && t("dailyLogs.author", { name: log.createdBy.name }), log.reviewedBy && t("dailyLogs.reviewedBy", { name: log.reviewedBy.name }), log.lockedBy && t("dailyLogs.lockedBy", { name: log.lockedBy.name }))}
          </p>
        </div>
        <PrintButton />
      </header>

      {log.summary ? <Block title={t("dailyLogs.summary")}><p className="whitespace-pre-line">{log.summary}</p></Block> : null}
      <Block title={t("dailyLogs.weather")}>
        <p>{joined(log.weatherSummary, log.siteCondition && t("dailyLogs.site", { condition: SITE_CONDITION_LABELS[log.siteCondition] }), log.siteConditionNotes)}</p>
        <ul className="mt-1 list-disc pl-5">{log.weather.map((entry) => <li key={entry.id}>{joined(entry.observedAt, entry.condition && WEATHER_CONDITION_LABELS[entry.condition], entry.temperatureC !== null && `${entry.temperatureC} °C`, entry.precipitationMm !== null && `${entry.precipitationMm} mm`, entry.windKph !== null && `${entry.windKph} km/h`, entry.notes)}</li>)}</ul>
      </Block>
      <Block title={t("dailyLogs.workforce", { count: log.counts.workforce })}>{log.workforce.length ? <ul className="list-disc pl-5">{log.workforce.map((entry) => <li key={entry.id}>{joined(entry.organizationName, entry.trade, entry.crewName, t("dailyLogs.people", { count: entry.headcount }))}</li>)}</ul> : none}</Block>
      <Block title={t("dailyLogs.workCompleted")}>{log.activities.length ? <ul className="list-disc pl-5">{log.activities.map((entry) => <li key={entry.id}>{joined(entry.title, entry.projectArea, entry.floorZone, entry.progressPercent !== null && `${entry.progressPercent}%`, entry.task?.label, entry.description)}</li>)}</ul> : none}</Block>
      <Block title={t("dailyLogs.equipment")}>{log.equipment.length ? <ul className="list-disc pl-5">{log.equipment.map((entry) => <li key={entry.id}>{joined(entry.equipmentName, `× ${entry.quantity}`, entry.hoursUsed !== null && `${entry.hoursUsed} h`, entry.status && EQUIPMENT_STATUS_LABELS[entry.status])}</li>)}</ul> : none}</Block>
      <Block title={t("dailyLogs.deliveries")}>{log.deliveries.length ? <ul className="list-disc pl-5">{log.deliveries.map((entry) => <li key={entry.id}>{joined(entry.description, entry.quantityText, entry.supplier?.label, entry.purchaseOrder?.label, entry.goodsReceipt?.label, entry.deliveredTime, entry.conditionNote)}</li>)}</ul> : none}</Block>
      <Block title={t("dailyLogs.visitors")}>{log.visitors.length ? <ul className="list-disc pl-5">{log.visitors.map((entry) => <li key={entry.id}>{joined(entry.name, entry.organization, entry.purpose, entry.arrivedAt && `${entry.arrivedAt}–${entry.departedAt ?? ""}`)}</li>)}</ul> : none}</Block>
      <Block title={t("dailyLogs.delays")}>{log.delays.length ? <ul className="list-disc pl-5">{log.delays.map((entry) => <li key={entry.id}>{joined(entry.title, DELAY_CATEGORY_LABELS[entry.category], entry.impact && t("dailyLogs.impact", { impact: DELAY_IMPACT_LABELS[entry.impact] }), entry.durationMinutes && formatDuration(entry.durationMinutes), entry.responsiblePartyText)}</li>)}</ul> : none}</Block>
      <Block title={t("dailyLogs.instructions")}>{log.instructions.length ? <ul className="list-disc pl-5">{log.instructions.map((entry) => <li key={entry.id}>{joined(entry.title, entry.issuedByText ?? entry.issuedBy?.name, entry.issuedAt, entry.description)}</li>)}</ul> : none}</Block>
      <Block title={t("dailyLogs.qaqcHse")}>{log.records.length ? <ul className="list-disc pl-5">{log.records.map((record) => <li key={record.linkId}>{joined(record.domain === "hse" ? "HSE" : "QA/QC", record.label)}</li>)}</ul> : none}</Block>
      <Block title={t("dailyLogs.photos")}>{log.evidence?.length ? <ul className="list-disc pl-5">{log.evidence.map((item) => <li key={item.documentId}>{joined(DOCUMENT_CATEGORY_LABELS[item.category], item.caption ?? item.name)}</li>)}</ul> : none}</Block>
      <Block title={t("dailyLogs.tasks")}>{log.tasks.length ? <ul className="list-disc pl-5">{log.tasks.map((task) => <li key={task.linkId}>{joined(task.title, TASK_LINK_TYPE_LABELS[task.linkType], task.status)}</li>)}</ul> : none}</Block>
      {log.corrections.length ? (
        <Block title={t("dailyLogs.corrections")}>
          <ul className="list-disc pl-5">{log.corrections.map((correction) => <li key={correction.id}>{joined(dateLabel(correction.createdAt.slice(0, 10)), correction.createdBy?.name, correction.correctionSummary, t("dailyLogs.reason", { reason: correction.reason }))}</li>)}</ul>
        </Block>
      ) : null}
    </article>
  );
}
