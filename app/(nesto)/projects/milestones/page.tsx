import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { redirect } from "next/navigation";

import { selectClass } from "@/components/forms/record-form";
import { ModulePage } from "@/components/modules/module-page";
import { PersonLink } from "@/components/people/person-link";
import { PlanningSettingsForm } from "@/components/project-planning/planning-settings-form";
import { MilestoneStatusBadge, Variance } from "@/components/project-planning/planning-ui";
import { ReportFilterForm } from "@/components/project-planning/report-filter-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollRegion } from "@/components/ui/scroll-region";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { dateLabel } from "@/lib/modules/project-planning/planning.dates";
import { planningOpen } from "@/lib/modules/project-planning/planning.permissions";
import { planningReport, type ReportRow } from "@/lib/modules/project-planning/planning.reports";
import { reportQuerySchema } from "@/lib/modules/project-planning/planning.schema";
import { resolvePlanningSettings } from "@/lib/modules/project-planning/planning.settings";
import { MILESTONE_STATUSES, STATUS_LABELS } from "@/lib/modules/project-planning/planning.types";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = { title: "Milestones" };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) || undefined;

function Figure({ label, value, tone, testId }: { label: string; value: string | number; tone?: "warning" | "danger"; testId?: string }) {
  return (
    <div>
      <dt className="text-meta text-fg-muted">{label}</dt>
      <dd className={cn("text-section font-semibold tabular-nums", tone === "danger" ? "text-danger-strong" : tone === "warning" ? "text-warning-strong" : "text-fg")} data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

/** "Showing the top 50 of 73, most overdue first" when a list is cut; nothing when it is whole (AUD-08 §4: no unlabelled cut). */
function ListScope({ shown, total, order }: { shown: number; total: number; order: string }) {
  if (total <= shown) return null;
  return <p className="px-5 text-meta text-fg-muted" data-testid="report-list-scope">Showing the top {shown} of {total}, {order}.</p>;
}

function MilestoneTable({ rows, caption, empty, testId }: { rows: ReportRow[]; caption: string; empty: string; testId: string }) {
  if (!rows.length) return <p className="px-5 py-4 text-table text-fg-muted">{empty}</p>;
  return (
    <>
      {/* Phones read each milestone as a card carrying every column, instead of panning a 760px table (AUD-04 §5, MW-05). */}
      <ul className="divide-y divide-line md:hidden" aria-label={caption} data-testid={`${testId}-cards`}>
        {rows.map((row) => (
          <li key={row.id} className="space-y-1 px-5 py-3 text-table">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <Link href={row.href} className="min-w-0 break-words font-medium text-fg hover:text-accent-strong">
                {row.name}
              </Link>
              <MilestoneStatusBadge status={row.status} delayed={row.delayed} />
            </div>
            <p className="break-words text-meta text-fg-muted">
              {row.projectName} · {row.phaseName ?? "No phase"}
              {row.owner ? <> · <PersonLink memberId={row.owner.memberId} name={row.owner.name} /></> : null}
              {row.critical ? " · Critical" : ""}
            </p>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-meta">
              <dt className="text-fg-muted">Baseline</dt>
              <dd className="tabular-nums text-fg-muted">{dateLabel(row.baselineDate)}</dd>
              <dt className="text-fg-muted">Forecast</dt>
              <dd className="tabular-nums">{dateLabel(row.forecastDate)}</dd>
              <dt className="text-fg-muted">Actual</dt>
              <dd className="tabular-nums">{dateLabel(row.actualDate)}</dd>
              <dt className="text-fg-muted">Variance</dt>
              <dd>
                <Variance days={row.varianceDays} />
              </dd>
            </dl>
          </li>
        ))}
      </ul>
      <ScrollRegion label={caption} className="hidden md:block">
      <table className="w-full min-w-[760px] border-collapse text-table" data-testid={testId}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line text-left text-meta text-fg-muted">
            <th scope="col" className="px-5 py-2 font-medium">Milestone</th>
            <th scope="col" className="px-3 py-2 font-medium">Project</th>
            <th scope="col" className="px-3 py-2 font-medium">Status</th>
            <th scope="col" className="px-3 py-2 font-medium">Baseline</th>
            <th scope="col" className="px-3 py-2 font-medium">Forecast</th>
            <th scope="col" className="px-3 py-2 font-medium">Actual</th>
            <th scope="col" className="px-5 py-2 font-medium">Variance</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row) => (
            <tr key={row.id}>
              <th scope="row" className="px-5 py-2 text-left font-normal">
                <Link href={row.href} className="font-medium text-fg hover:text-accent-strong">
                  {row.name}
                </Link>
                <span className="block text-meta text-fg-muted">
                  {row.phaseName ?? "No phase"}
                  {row.owner ? <> · <PersonLink memberId={row.owner.memberId} name={row.owner.name} /></> : null}
                  {row.critical ? " · Critical" : ""}
                </span>
              </th>
              <td className="px-3 py-2 text-fg-muted">{row.projectName}</td>
              <td className="px-3 py-2">
                <MilestoneStatusBadge status={row.status} delayed={row.delayed} />
              </td>
              <td className="px-3 py-2 tabular-nums text-fg-muted">{dateLabel(row.baselineDate)}</td>
              <td className="px-3 py-2 tabular-nums">{dateLabel(row.forecastDate)}</td>
              <td className="px-3 py-2 tabular-nums">{dateLabel(row.actualDate)}</td>
              <td className="px-5 py-2">
                <Variance days={row.varianceDays} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </ScrollRegion>
    </>
  );
}

/**
 * Milestones across projects (PRD #44 §168-§175, §254-§256): what is late,
 * what moved against its baseline, which critical milestones need attention,
 * and each project's next key date — for the projects this reader can open.
 * The company's planning rules sit beneath, for the planning authority.
 */
export default async function MilestonesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const context = await requireModule("projects");
  if (!planningOpen(context)) redirect("/access-denied");
  const experience = resolveModuleExperience(context, "projects");
  const params = await searchParams;
  const query = reportQuerySchema.parse({ projectId: one(params.projectId), phaseId: one(params.phaseId), status: one(params.status), ownerId: one(params.ownerId), critical: one(params.critical), from: one(params.from), to: one(params.to) });
  const [report, settings] = await Promise.all([planningReport(context, query), can(context, "project_planning.settings.manage") ? resolvePlanningSettings(context.companyId) : Promise.resolve(null)]);
  const { totals } = report;
  const maxStatus = Math.max(1, ...report.byStatus.map((row) => row.count));
  const activeFilters = [query.projectId, query.phaseId, query.status, query.ownerId, query.critical, query.from, query.to].filter((value) => value !== undefined && value !== "").length;

  return (
    <ModulePage experience={experience} activeSection="milestones" description="Key dates across your projects: delays, variance against baseline and critical milestones.">
      <div className="space-y-5">
        {report.truncated ? (
          // A bounded read is said out loud, never shown as the whole portfolio (AUD-08 §4, DT-05).
          <p role="status" data-testid="report-truncated" className="rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-table text-warning-strong">
            More milestones match than the report reads at once; these figures cover the first 10,000. Narrow the report to a project or status.
          </p>
        ) : null}
        <ReportFilterForm className="nesto-card flex flex-wrap items-end gap-3 px-4 py-3" aria-label="Report filters" activeCount={activeFilters}>
          <label className="flex min-w-[13rem] flex-[2] flex-col">
            <span className="text-meta text-fg-muted">Project</span>
            <select name="projectId" defaultValue={query.projectId ?? ""} className={cn(selectClass, "mt-1 h-9")}>
              <option value="">All my projects</option>
              {report.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.label}
                </option>
              ))}
            </select>
            {report.projectsTruncated ? <span className="mt-1 text-meta text-fg-muted">The first 500 projects by name are listed.</span> : null}
          </label>
          {report.phases.length ? (
            <label className="flex min-w-[10rem] flex-1 flex-col">
              <span className="text-meta text-fg-muted">Phase</span>
              <select name="phaseId" defaultValue={query.phaseId ?? ""} className={cn(selectClass, "mt-1 h-9")}>
                <option value="">All phases</option>
                {report.phases.map((phase) => (
                  <option key={phase.id} value={phase.id}>
                    {phase.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="flex min-w-[9rem] flex-1 flex-col">
            <span className="text-meta text-fg-muted">Status</span>
            <select name="status" defaultValue={query.status ?? ""} className={cn(selectClass, "mt-1 h-9")}>
              <option value="">Any status</option>
              {MILESTONE_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-[9rem] flex-1 flex-col">
            <span className="text-meta text-fg-muted">Owner</span>
            <select name="ownerId" defaultValue={query.ownerId ?? ""} className={cn(selectClass, "mt-1 h-9")}>
              <option value="">Anyone</option>
              {report.owners.map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {owner.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex w-36 flex-col">
            <span className="text-meta text-fg-muted">Critical</span>
            <select name="critical" defaultValue={query.critical === undefined ? "" : query.critical ? "1" : "0"} className={cn(selectClass, "mt-1 h-9")}>
              <option value="">All</option>
              <option value="1">Critical only</option>
              <option value="0">Not critical</option>
            </select>
          </label>
          <label className="flex w-40 flex-col">
            <span className="text-meta text-fg-muted">From</span>
            <Input type="date" name="from" defaultValue={query.from} className="mt-1 h-9" />
          </label>
          <label className="flex w-40 flex-col">
            <span className="text-meta text-fg-muted">To</span>
            <Input type="date" name="to" defaultValue={query.to} className="mt-1 h-9" />
          </label>
          <Button type="submit" size="sm">
            Apply
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link href="/projects/milestones">Reset</Link>
          </Button>
        </ReportFilterForm>

        <section className="nesto-card px-5 py-4" aria-label="Totals">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-8" data-testid="planning-report-totals">
            <Figure label="Milestones" value={totals.total} testId="report-total" />
            <Figure label="Completed" value={totals.completed} />
            <Figure label="Delayed" value={totals.delayed} tone={totals.delayed ? "danger" : undefined} testId="report-delayed" />
            <Figure label="At risk" value={totals.atRisk} tone={totals.atRisk ? "warning" : undefined} />
            <Figure label="Critical" value={totals.critical} />
            <Figure label="Next 30 days" value={totals.upcoming} />
            <Figure label="Average variance" value={totals.averageVariance === null ? "—" : `${totals.averageVariance > 0 ? "+" : ""}${totals.averageVariance}d`} />
            <Figure label="Delayed this month" value={totals.delayedThisMonth} />
          </dl>
        </section>

        <div className="grid gap-5 lg:grid-cols-3">
          <section className="nesto-card px-5 py-4" aria-labelledby="by-status">
            <h2 id="by-status" className="text-card font-semibold text-fg">By status</h2>
            <p className="text-meta text-fg-muted">As recorded. Delay is also read from the dates.</p>
            <ul className="mt-3 space-y-2.5">
              {report.byStatus.map((row) => (
                <li key={row.status}>
                  <div className="flex justify-between text-table">
                    <span className="text-fg">{row.label}</span>
                    <span className="font-medium tabular-nums text-fg">{row.count}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-hover" aria-hidden="true">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${(row.count / maxStatus) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </section>
          <section className="nesto-card min-w-0 lg:col-span-2" aria-labelledby="portfolio">
            <h2 id="portfolio" className="px-5 pt-4 text-card font-semibold text-fg">Portfolio</h2>
            <p className="px-5 text-meta text-fg-muted">Each project&apos;s next milestone and its critical delays.</p>
            <ScrollRegion label="Portfolio" className="mt-2">
            <table className="w-full min-w-[560px] border-collapse text-table" data-testid="planning-portfolio">
              <thead>
                <tr className="border-b border-line text-left text-meta text-fg-muted">
                  <th scope="col" className="px-5 py-2 font-medium">Project</th>
                  <th scope="col" className="px-3 py-2 font-medium">Next milestone</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Critical delays</th>
                  <th scope="col" className="px-5 py-2 font-medium">Plan ends</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {report.portfolio.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-5 py-3 text-fg-muted">No plans yet.</td>
                  </tr>
                ) : null}
                {report.portfolio.map((row) => (
                  <tr key={row.projectId}>
                    <th scope="row" className="px-5 py-2 text-left font-normal">
                      <Link href={`/projects/${row.projectId}/planning`} className="font-medium text-fg hover:text-accent-strong">
                        {row.name}
                      </Link>
                    </th>
                    <td className="px-3 py-2">
                      {row.next ? (
                        <Link href={row.next.href} className="text-fg hover:text-accent-strong">
                          {row.next.name} <span className="text-fg-muted">· {dateLabel(row.next.displayDate)}</span>
                        </Link>
                      ) : (
                        <span className="text-fg-muted">—</span>
                      )}
                    </td>
                    <td className={cn("px-3 py-2 text-right tabular-nums", row.criticalDelays ? "font-medium text-danger-strong" : "text-fg-muted")}>{row.criticalDelays}</td>
                    <td className="px-5 py-2 tabular-nums text-fg-muted">{dateLabel(row.forecastEnd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </ScrollRegion>
            <div className="h-3" />
          </section>
        </div>

        <section className="nesto-card" aria-labelledby="overdue">
          <h2 id="overdue" className="px-5 pt-4 text-card font-semibold text-fg">Overdue milestones</h2>
          <ListScope shown={report.overdue.length} total={report.listTotals.overdue} order="most overdue first" />
          <MilestoneTable rows={report.overdue} caption="Overdue milestones" empty="Nothing is overdue." testId="report-overdue" />
          <div className="h-2" />
        </section>

        <section className="nesto-card" aria-labelledby="variance">
          <h2 id="variance" className="px-5 pt-4 text-card font-semibold text-fg">Forecast variance</h2>
          <p className="px-5 text-meta text-fg-muted">Baseline against forecast — or actual, once achieved. Largest slips first.</p>
          <ListScope shown={report.variance.length} total={report.listTotals.variance} order="largest slips first" />
          <MilestoneTable rows={report.variance} caption="Forecast variance" empty="No milestone has a baseline yet." testId="report-variance" />
          <div className="h-2" />
        </section>

        <section className="nesto-card" aria-labelledby="critical">
          <h2 id="critical" className="px-5 pt-4 text-card font-semibold text-fg">Critical milestones</h2>
          <ListScope shown={report.critical.length} total={report.listTotals.critical} order="late first" />
          <MilestoneTable rows={report.critical} caption="Critical milestones" empty="No critical milestones." testId="report-critical" />
          <div className="h-2" />
        </section>

        {report.byProject.length > 1 || report.byPhase.length ? (
          <div className="grid gap-5 lg:grid-cols-2">
            <section className="nesto-card min-w-0" aria-labelledby="by-project">
              <h2 id="by-project" className="px-5 pt-4 text-card font-semibold text-fg">By project</h2>
              <ScrollRegion label="By project" className="mt-2">
              <table className="w-full min-w-[480px] border-collapse text-table">
                <thead>
                  <tr className="border-b border-line text-left text-meta text-fg-muted">
                    <th scope="col" className="px-5 py-2 font-medium">Project</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Milestones</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Complete</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Delayed</th>
                    <th scope="col" className="px-5 py-2 text-right font-medium">At risk</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {report.byProject.map((row) => (
                    <tr key={row.projectId}>
                      <th scope="row" className="px-5 py-2 text-left font-normal">
                        <Link href={`/projects/${row.projectId}/planning`} className="text-fg hover:text-accent-strong">
                          {row.name}
                        </Link>
                      </th>
                      <td className="px-3 py-2 text-right tabular-nums">{row.total}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.completed}</td>
                      <td className={cn("px-3 py-2 text-right tabular-nums", row.delayed ? "text-danger-strong" : "text-fg-muted")}>{row.delayed}</td>
                      <td className={cn("px-5 py-2 text-right tabular-nums", row.atRisk ? "text-warning-strong" : "text-fg-muted")}>{row.atRisk}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </ScrollRegion>
              <div className="h-3" />
            </section>
            {report.byPhase.length ? (
              <section className="nesto-card min-w-0" aria-labelledby="by-phase">
                <h2 id="by-phase" className="px-5 pt-4 text-card font-semibold text-fg">By phase</h2>
                <ScrollRegion label="By phase" className="mt-2">
                <table className="w-full min-w-[400px] border-collapse text-table">
                  <thead>
                    <tr className="border-b border-line text-left text-meta text-fg-muted">
                      <th scope="col" className="px-5 py-2 font-medium">Phase</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Milestones</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Complete</th>
                      <th scope="col" className="px-5 py-2 text-right font-medium">Delayed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {report.byPhase.map((row) => (
                      <tr key={row.name}>
                        <th scope="row" className="px-5 py-2 text-left font-normal text-fg">{row.name}</th>
                        <td className="px-3 py-2 text-right tabular-nums">{row.total}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{row.completed}</td>
                        <td className={cn("px-5 py-2 text-right tabular-nums", row.delayed ? "text-danger-strong" : "text-fg-muted")}>{row.delayed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </ScrollRegion>
                <div className="h-3" />
              </section>
            ) : null}
          </div>
        ) : null}

        {settings ? (
          <section aria-labelledby="planning-settings" className="max-w-2xl space-y-2">
            <h2 id="planning-settings" className="text-card font-semibold text-fg">Planning settings</h2>
            {/* A filter change asked first and replaces the form, as the full reload it once was did (AUD-03 §4). */}
            <PlanningSettingsForm key={JSON.stringify(query)} initial={settings} />
          </section>
        ) : null}
      </div>
    </ModulePage>
  );
}
