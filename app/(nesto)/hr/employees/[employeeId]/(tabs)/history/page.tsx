import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { notFound } from "next/navigation";

import { CancelScheduledChange, CorrectHistoryRow } from "@/components/hr/employment-history-actions";
import { EmploymentTimeline } from "@/components/hr/employment-timeline";
import { PersonLink } from "@/components/people/person-link";
import { Badge } from "@/components/ui/badge";
import { ScrollRegion } from "@/components/ui/scroll-region";
import { AccessError } from "@/lib/access/guards";
import { employmentChangeOptions } from "@/lib/modules/hr/employment/employment.options";
import { getEmploymentHistory } from "@/lib/modules/hr/employment/employment.query";
import { hrLabel } from "@/components/hr/hr-labels";
import { getTranslations } from "@/lib/i18n/server";
import { formatDate, orDash } from "@/lib/utils/format";
import { loadEmployee } from "../../employee-context";

type Params = { params: Promise<{ employeeId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("hr");
  return { title: t("meta.employmentHistory") };
}

const period = (from: string, to: string | null, now: string) => `${formatDate(from)} – ${to ? formatDate(to) : now}`;

/**
 * Employment history (E-03 §55-§58, §123-§131, §162, §169, §171).
 *
 * HR sees the timeline, what is scheduled, and every row — corrected ones too,
 * beside what replaced them and why — with the private reason behind a status
 * only with its own permission. The employee sees their own timeline and rows
 * without HR's notes, corrections or private reasons. Anybody else is not here:
 * the current record is not the history (§56, §195).
 */
export default async function EmploymentHistoryPage({ params }: Params) {
  const { employeeId } = await params;
  const { context, employee } = await loadEmployee(employeeId, "/history");
  if (!employee.capabilities.canViewHistory) notFound();

  let history;
  try {
    history = await getEmploymentHistory(context, employeeId);
  } catch (error) {
    if (error instanceof AccessError) notFound();
    throw error;
  }
  const hr = history.view === "HR";
  const caps = history.capabilities;
  const options = hr && caps.canCorrect ? await employmentChangeOptions(context, employeeId) : null;
  const t = await getTranslations("hr");
  const now = t("history.now");
  const scheduled = history.scheduled.filter((row) => row.status === "SCHEDULED" || row.status === "FAILED");

  return (
    <div className="space-y-5">
      {hr && scheduled.length > 0 ? (
        <section className="nesto-card p-5" aria-labelledby="scheduled-changes">
          <h2 id="scheduled-changes" className="text-card font-semibold text-fg">
            {t("history.scheduledChanges")}
          </h2>
          <ul className="mt-3 divide-y divide-line">
            {scheduled.map((change) => (
              <li key={change.id} className="flex flex-wrap items-center justify-between gap-3 py-3" data-testid="scheduled-change">
                <div className="space-y-0.5">
                  <p className="flex flex-wrap items-center gap-2 text-table font-medium text-fg">
                    {hrLabel(t, "changeType", change.type)}
                    <Badge tone={change.status === "FAILED" ? "danger" : "info"}>{change.status === "FAILED" ? hrLabel(t, "changeStatus", "FAILED") : t("history.scheduledFor", { date: formatDate(change.effectiveDate) })}</Badge>
                  </p>
                  <p className="text-meta text-fg-muted">{change.summary}</p>
                  {change.failureReason ? <p className="text-meta text-danger-strong">{change.failureReason}</p> : null}
                  {change.requestedBy ? (
                    <p className="text-meta text-fg-subtle">
                      {t("history.scheduledBy")} <PersonLink userId={change.requestedByUserId} name={change.requestedBy} />
                    </p>
                  ) : null}
                </div>
                {change.canCancel ? <CancelScheduledChange employeeId={employeeId} changeId={change.id} label={t("history.changeOn", { change: hrLabel(t, "changeType", change.type).toLowerCase(), date: formatDate(change.effectiveDate) })} /> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="nesto-card p-5" aria-labelledby="timeline">
        <h2 id="timeline" className="text-card font-semibold text-fg">
          {t("history.timeline")}
        </h2>
        <p className="mt-1 text-meta text-fg-subtle">{hr ? t("history.timelineHr") : t("history.timelineSelf")}</p>
        <div className="mt-4">
          <EmploymentTimeline events={history.timeline} />
        </div>
      </section>

      <section className="nesto-card p-5" aria-labelledby="assignments">
        <h2 id="assignments" className="text-card font-semibold text-fg">
          {t("history.positions")}
        </h2>
        {/* The tables pan in labelled regions; headings stay put (AUD-04 §5, D-07-15, MW-19). */}
        <ScrollRegion label={t("history.positions")} className="mt-3">
        <table className="w-full min-w-[720px] text-table">
          <thead>
            <tr className="text-left text-meta text-fg-subtle">
              <th className="py-2 pr-3 font-medium">{t("history.period")}</th>
              <th className="py-2 pr-3 font-medium">{t("fields.jobTitle")}</th>
              <th className="py-2 pr-3 font-medium">{t("columns.department")}</th>
              <th className="py-2 pr-3 font-medium">{t("columns.manager")}</th>
              <th className="py-2 pr-3 font-medium">{t("history.location")}</th>
              <th className="py-2 pr-3 font-medium">{t("columns.type")}</th>
              <th className="py-2 pr-3 font-medium">{t("history.why")}</th>
              {hr ? <th className="py-2 font-medium">{t("history.recorded")}</th> : null}
            </tr>
          </thead>
          <tbody>
            {history.assignments.map((row) => (
              <tr key={row.id} className={row.supersededAt ? "border-t border-line text-fg-subtle line-through decoration-fg-subtle/40" : "border-t border-line"} data-testid={row.supersededAt ? "assignment-superseded" : "assignment-row"}>
                <td className="py-2 pr-3 whitespace-nowrap">{period(row.startDate, row.endDate, now)}</td>
                <td className="py-2 pr-3">{orDash(row.jobTitle)}</td>
                <td className="py-2 pr-3">{orDash(row.department?.name)}</td>
                <td className="py-2 pr-3">{row.manager ? <PersonLink memberId={row.manager.memberId} name={row.manager.name} /> : "—"}</td>
                <td className="py-2 pr-3">{orDash([row.workLocationType ? hrLabel(t, "workLocationType", row.workLocationType) : null, row.workLocation].filter(Boolean).join(", "))}</td>
                <td className="py-2 pr-3">{hrLabel(t, "employmentType", row.employmentType)}</td>
                <td className="py-2 pr-3">
                  {hrLabel(t, "assignmentReason", row.reason)}
                  {row.document ? (
                    <>
                      {" · "}
                      <Link href={row.document.href} className="text-accent-strong hover:underline">
                        {row.document.name}
                      </Link>
                    </>
                  ) : null}
                </td>
                {hr ? (
                  <td className="py-2 align-top text-meta">
                    <span className="block no-underline">{hrLabel(t, "historySource", row.source)}
                      {row.createdBy ? (
                        <>
                          {" · "}
                          <PersonLink userId={row.createdByUserId} name={row.createdBy} />
                        </>
                      ) : null}
                    </span>
                    {row.supersededAt ? <Badge tone="warning">{t("history.corrected")}</Badge> : null}
                    {row.correctionReason ? <span className="block text-fg-muted no-underline">{t("history.correction", { reason: row.correctionReason })}</span> : null}
                    {row.note ? <span className="block text-fg-muted no-underline">{t("history.note", { note: row.note })}</span> : null}
                    {!row.supersededAt && options ? <CorrectHistoryRow employeeId={employeeId} kind="ASSIGNMENT" row={row} options={options} /> : null}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
        </ScrollRegion>
      </section>

      <section className="nesto-card p-5" aria-labelledby="statuses">
        <h2 id="statuses" className="text-card font-semibold text-fg">
          {t("columns.status")}
        </h2>
        <ScrollRegion label={t("history.statusHistory")} className="mt-3">
        <table className="w-full min-w-[560px] text-table">
          <thead>
            <tr className="text-left text-meta text-fg-subtle">
              <th className="py-2 pr-3 font-medium">{t("history.period")}</th>
              <th className="py-2 pr-3 font-medium">{t("columns.status")}</th>
              <th className="py-2 pr-3 font-medium">{t("history.reason")}</th>
              {caps.canViewPrivateReason ? <th className="py-2 pr-3 font-medium">{t("history.privateReason")}</th> : null}
              {hr ? <th className="py-2 font-medium">{t("history.recorded")}</th> : null}
            </tr>
          </thead>
          <tbody>
            {history.statuses.map((row) => (
              <tr key={row.id} className={row.supersededAt ? "border-t border-line text-fg-subtle line-through decoration-fg-subtle/40" : "border-t border-line"}>
                <td className="py-2 pr-3 whitespace-nowrap">{period(row.effectiveFrom, row.effectiveTo, now)}</td>
                <td className="py-2 pr-3">{hrLabel(t, "employmentStatus", row.status)}</td>
                <td className="py-2 pr-3">{hrLabel(t, "statusReason", row.reason)}</td>
                {caps.canViewPrivateReason ? <td className="py-2 pr-3">{orDash(row.privateReason)}</td> : null}
                {hr ? (
                  <td className="py-2 align-top text-meta">
                    <span className="block no-underline">{hrLabel(t, "historySource", row.source)}
                      {row.createdBy ? (
                        <>
                          {" · "}
                          <PersonLink userId={row.createdByUserId} name={row.createdBy} />
                        </>
                      ) : null}
                    </span>
                    {row.correctionReason ? <span className="block text-fg-muted no-underline">{t("history.correction", { reason: row.correctionReason })}</span> : null}
                    {!row.supersededAt && options ? <CorrectHistoryRow employeeId={employeeId} kind="STATUS" row={row} options={options} /> : null}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
        </ScrollRegion>
      </section>

      {hr && history.scheduled.some((row) => row.status === "APPLIED" || row.status === "CANCELLED") ? (
        <section className="nesto-card p-5" aria-labelledby="past-schedule">
          <h2 id="past-schedule" className="text-card font-semibold text-fg">
            {t("history.pastScheduled")}
          </h2>
          <ul className="mt-3 space-y-1 text-table text-fg-muted">
            {history.scheduled
              .filter((row) => row.status === "APPLIED" || row.status === "CANCELLED")
              .map((row) => (
                <li key={row.id}>
                  {t("history.pastRow", { change: hrLabel(t, "changeType", row.type), date: formatDate(row.effectiveDate), status: hrLabel(t, "changeStatus", row.status).toLowerCase() })}
                  {row.cancelReason ? ` (${row.cancelReason})` : ""}
                </li>
              ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
