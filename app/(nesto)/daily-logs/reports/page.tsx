import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { notFound, redirect } from "next/navigation";

import { selectClass } from "@/components/forms/record-form";
import { ModulePage } from "@/components/modules/module-page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { can } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { dailyLogReport } from "@/lib/modules/daily-logs/daily-log.reports";
import { reportQuerySchema } from "@/lib/modules/daily-logs/daily-log.schema";
import { dateLabel, formatDuration, shortDayLabel } from "@/lib/modules/daily-logs/daily-log.time";
import { DELAY_CATEGORY_LABELS, DELAY_IMPACT_LABELS } from "@/lib/modules/daily-logs/daily-log.types";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = { title: "Daily log reports" };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) || undefined;

function Figure({ label, value, tone }: { label: string; value: string | number; tone?: "warning" }) {
  return (
    <div>
      <dt className="text-meta text-fg-muted">{label}</dt>
      <dd className={cn("text-section font-semibold tabular-nums", tone === "warning" ? "text-warning-strong" : "text-fg")}>{value}</dd>
    </div>
  );
}

/**
 * Site operations reporting (PRD #43 §196-§200): logs completed and missing,
 * headcount by trade, delays by category and impact, deliveries, evidence —
 * over the projects this reader can open. Headcount is not attendance, and
 * deliveries are not stock.
 */
export default async function DailyLogReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const context = await requireModule("dailyLogs");
  if (!can(context, "daily_log.review")) redirect("/access-denied");
  const experience = resolveModuleExperience(context, "dailyLogs");
  const params = await searchParams;
  const report = await dailyLogReport(context, reportQuerySchema.parse({ projectId: one(params.projectId), from: one(params.from), to: one(params.to) })).catch((error: unknown) => {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const { totals } = report;
  const maxTrade = Math.max(1, ...report.workforceByTrade.map((row) => row.headcount));

  return (
    <ModulePage experience={experience} activeSection="reports" description="What the site diaries add up to, over a range of days.">
      <div className="space-y-5">
        <form method="get" className="nesto-card flex flex-wrap items-end gap-3 px-4 py-3" aria-label="Report filters">
          <label className="flex min-w-[14rem] flex-[2] flex-col">
            <span className="text-meta text-fg-muted">Project</span>
            <select name="projectId" defaultValue={report.projectId ?? ""} className={cn(selectClass, "mt-1 h-9")}>
              <option value="">All my projects</option>
              {report.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex w-44 flex-col">
            <span className="text-meta text-fg-muted">From</span>
            <Input type="date" name="from" defaultValue={report.from} className="mt-1 h-9" />
          </label>
          <label className="flex w-44 flex-col">
            <span className="text-meta text-fg-muted">To</span>
            <Input type="date" name="to" defaultValue={report.to} className="mt-1 h-9" />
          </label>
          <Button type="submit" size="sm">
            Apply
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link href="/daily-logs/reports">Reset</Link>
          </Button>
        </form>

        <section className="nesto-card px-5 py-4" aria-label="Totals">
          <p className="text-table text-fg-muted">
            {dateLabel(report.from)} – {dateLabel(report.to)}
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-8" data-testid="daily-log-report-totals">
            <Figure label="Logs" value={totals.logs} />
            <Figure label="Submitted or locked" value={totals.completed} />
            <Figure label="Missing" value={totals.missing} tone={totals.missing ? "warning" : undefined} />
            <Figure label="Average on site" value={totals.averageWorkforce} />
            <Figure label="Activities" value={totals.activities} />
            <Figure label="Deliveries" value={totals.deliveries} />
            <Figure label="Delays" value={`${totals.delays} · ${formatDuration(totals.delayMinutes)}`} />
            <Figure label="Photos" value={totals.photos} />
          </dl>
        </section>

        <div className="grid gap-5 lg:grid-cols-3">
          <section className="nesto-card px-5 py-4" aria-labelledby="by-trade">
            <h2 id="by-trade" className="text-card font-semibold text-fg">Headcount by trade</h2>
            <p className="text-meta text-fg-muted">Summed over the logs in range. Not attendance.</p>
            <ul className="mt-3 space-y-2.5">
              {report.workforceByTrade.length === 0 ? <li className="text-table text-fg-muted">No workforce recorded.</li> : null}
              {report.workforceByTrade.map((row) => (
                <li key={row.trade}>
                  <div className="flex justify-between text-table">
                    <span className="text-fg">{row.trade}</span>
                    <span className="font-medium tabular-nums text-fg">{row.headcount}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-hover" aria-hidden="true">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${(row.headcount / maxTrade) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </section>
          <section className="nesto-card px-5 py-4" aria-labelledby="by-delay">
            <h2 id="by-delay" className="text-card font-semibold text-fg">Delays by category</h2>
            <ul className="mt-3 divide-y divide-line">
              {report.delaysByCategory.length === 0 ? <li className="py-2 text-table text-fg-muted">No delays recorded.</li> : null}
              {report.delaysByCategory.map((row) => (
                <li key={row.category} className="flex justify-between py-2 text-table">
                  <span className="text-fg">{DELAY_CATEGORY_LABELS[row.category]}</span>
                  <span className="tabular-nums text-fg-muted">
                    {row.count} · {formatDuration(row.minutes)}
                  </span>
                </li>
              ))}
            </ul>
            {report.delaysByImpact.length ? (
              <p className="mt-2 text-meta text-fg-muted">{report.delaysByImpact.map((row) => `${row.impact === "UNSET" ? "No impact set" : DELAY_IMPACT_LABELS[row.impact]} ${row.count}`).join(" · ")}</p>
            ) : null}
          </section>
          <section className="nesto-card px-5 py-4" aria-labelledby="missing">
            <h2 id="missing" className="text-card font-semibold text-fg">Missing logs</h2>
            <p className="text-meta text-fg-muted">Working days on projects that require a log.</p>
            <ul className="mt-3 divide-y divide-line">
              {report.missingDays.length === 0 ? <li className="py-2 text-table text-fg-muted">None.</li> : null}
              {report.missingDays.slice(0, 15).map((row) => (
                <li key={`${row.projectId}:${row.date}`} className="flex justify-between py-2 text-table">
                  <Link href={`/projects/${row.projectId}/daily-logs`} className="text-fg hover:text-accent-strong">
                    {row.name}
                  </Link>
                  <span className="tabular-nums text-fg-muted">{shortDayLabel(row.date)}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <section className="nesto-card overflow-x-auto" aria-labelledby="by-project">
          <h2 id="by-project" className="px-5 pt-4 text-card font-semibold text-fg">By project</h2>
          <table className="mt-2 w-full min-w-[640px] border-collapse text-table">
            <thead>
              <tr className="border-b border-line text-left text-meta text-fg-muted">
                <th scope="col" className="px-5 py-2 font-medium">Project</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Logs</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Missing</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Headcount</th>
                <th scope="col" className="px-5 py-2 text-right font-medium">Delays</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {report.byProject.map((row) => (
                <tr key={row.projectId}>
                  <th scope="row" className="px-5 py-2 text-left font-normal">
                    <Link href={`/projects/${row.projectId}/daily-logs`} className="font-medium text-fg hover:text-accent-strong">
                      {row.name}
                    </Link>
                  </th>
                  <td className="px-3 py-2 text-right tabular-nums">{row.logs}</td>
                  <td className={cn("px-3 py-2 text-right tabular-nums", row.missing ? "text-warning-strong" : "text-fg-muted")}>{row.missing}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.workforce}</td>
                  <td className="px-5 py-2 text-right tabular-nums">
                    {row.delays} · {formatDuration(row.delayMinutes)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="h-3" />
        </section>
      </div>
    </ModulePage>
  );
}
