import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { notFound } from "next/navigation";
import { FolderKanban } from "lucide-react";

import { selectClass } from "@/components/forms/record-form";
import { ModulePage } from "@/components/modules/module-page";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PersonLink } from "@/components/people/person-link";
import { AccessError } from "@/lib/access/guards";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { projectTimeSummary } from "@/lib/modules/timesheets/timesheet.reports";
import { parseProjectSummaryQuery } from "@/lib/modules/timesheets/timesheet.schema";
import { dayLabel, formatMinutes, weekLabel } from "@/lib/modules/timesheets/timesheet.time";
import { TIMESHEET_STATUS_LABELS, WORK_LOG_TYPE_LABELS } from "@/lib/modules/timesheets/timesheet.types";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = { title: "Project time" };

function Bars({ items, total, testId }: { items: Array<{ key: string; label: React.ReactNode; minutes: number; sub?: string }>; total: number; testId: string }) {
  return (
    <ul className="space-y-2.5" data-testid={testId}>
      {items.map((item) => (
        <li key={item.key}>
          <div className="flex items-baseline justify-between gap-3 text-table">
            <span className="min-w-0 truncate text-fg">{item.label}</span>
            <span className="shrink-0 font-medium tabular-nums text-fg">
              {formatMinutes(item.minutes)}
              {item.sub ? <span className="ml-1.5 font-normal text-fg-muted">{item.sub}</span> : null}
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-hover" aria-hidden="true">
            <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(2, (item.minutes / Math.max(1, total)) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Hours on projects (PRD #42 §90-§92, §170-§178): approved time by default,
 * totals, by person, by task and by week, then the entries — with what people
 * wrote shown only to readers who oversee them. No costs, no scores.
 */
export default async function ProjectTimePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const context = await requireModule("timesheets");
  const experience = resolveModuleExperience(context, "timesheets");
  const params = await searchParams;
  const summary = await projectTimeSummary(context, parseProjectSummaryQuery(params)).catch((error: unknown) => {
    // A project this reader cannot report on does not exist for them (§231).
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const { totals } = summary;

  return (
    <ModulePage experience={experience} activeSection="projects" description="Where time went on the projects you can see — approved weeks unless you ask for all.">
      <div className="space-y-5">
        <form method="get" className="nesto-card flex flex-wrap items-end gap-3 px-4 py-3" aria-label="Project time filters">
          <label className="flex min-w-[14rem] flex-[2] flex-col">
            <span className="text-meta text-fg-muted">Project</span>
            <select name="projectId" defaultValue={summary.project?.id ?? ""} className={cn(selectClass, "mt-1 h-9")}>
              <option value="">All my projects</option>
              {summary.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.code ? `${project.code} · ` : ""}
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-[9rem] flex-1 flex-col">
            <span className="text-meta text-fg-muted">From</span>
            <Input type="date" name="from" defaultValue={summary.from} className="mt-1 h-9" />
          </label>
          <label className="flex min-w-[9rem] flex-1 flex-col">
            <span className="text-meta text-fg-muted">To</span>
            <Input type="date" name="to" defaultValue={summary.to} className="mt-1 h-9" />
          </label>
          {summary.members.length ? (
            <label className="flex min-w-[10rem] flex-1 flex-col">
              <span className="text-meta text-fg-muted">Person</span>
              <select name="memberId" defaultValue={typeof params.memberId === "string" ? params.memberId : ""} className={cn(selectClass, "mt-1 h-9")}>
                <option value="">Everyone</option>
                {summary.members.map((member) => (
                  <option key={member.memberId} value={member.memberId}>
                    {member.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {summary.tasks.length ? (
            <label className="flex min-w-[10rem] flex-1 flex-col">
              <span className="text-meta text-fg-muted">Task</span>
              <select name="taskId" defaultValue={typeof params.taskId === "string" ? params.taskId : ""} className={cn(selectClass, "mt-1 h-9")}>
                <option value="">All tasks</option>
                {summary.tasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="flex w-40 flex-none flex-col">
            <span className="text-meta text-fg-muted">Billable</span>
            <select name="billable" defaultValue={summary.billable} className={cn(selectClass, "mt-1 h-9")}>
              <option value="all">All time</option>
              <option value="billable">Billable</option>
              <option value="non_billable">Non-billable</option>
            </select>
          </label>
          <label className="flex w-40 flex-none flex-col">
            <span className="text-meta text-fg-muted">Weeks</span>
            <select name="include" defaultValue={summary.approvedOnly ? "approved" : "all"} className={cn(selectClass, "mt-1 h-9")}>
              <option value="approved">Approved only</option>
              <option value="all">All logged</option>
            </select>
          </label>
          <div className="flex gap-2">
            <Button type="submit" size="sm">
              Apply
            </Button>
            <Button asChild type="button" size="sm" variant="ghost">
              <Link href="/timesheets/projects">Reset</Link>
            </Button>
          </div>
        </form>

        <section aria-label="Totals" className="nesto-card px-5 py-4">
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 className="text-section font-semibold text-fg">{summary.project ? summary.project.name : "All my projects"}</h2>
            <span className="text-table text-fg-muted">
              {dayLabel(summary.from).day} – {dayLabel(summary.to).day} {summary.to.slice(0, 4)} · {summary.approvedOnly ? "approved weeks" : "all logged time"}
            </span>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <dt className="text-meta text-fg-muted">Total</dt>
              <dd className="text-section font-semibold tabular-nums text-fg" data-testid="project-total">{formatMinutes(totals.totalMinutes)}</dd>
            </div>
            <div>
              <dt className="text-meta text-fg-muted">Billable</dt>
              <dd className="text-section font-semibold tabular-nums text-fg">{formatMinutes(totals.billableMinutes)}</dd>
            </div>
            <div>
              <dt className="text-meta text-fg-muted">Non-billable</dt>
              <dd className="text-section font-semibold tabular-nums text-fg">{formatMinutes(totals.nonBillableMinutes)}</dd>
            </div>
            <div>
              <dt className="text-meta text-fg-muted">Marked overtime</dt>
              <dd className="text-section font-semibold tabular-nums text-fg-muted">{formatMinutes(totals.overtimeFlaggedMinutes)}</dd>
            </div>
          </dl>
        </section>

        {totals.totalMinutes === 0 ? (
          <EmptyState icon={<FolderKanban />} title="No time in this range." description={summary.approvedOnly ? "Only approved weeks count here. Choose “All logged” to include weeks still in progress." : "Nobody logged time to these projects in this range."} />
        ) : (
          <>
            <div className="grid gap-5 lg:grid-cols-3">
              {!summary.project ? (
                <section className="nesto-card px-5 py-4" aria-labelledby="by-project">
                  <h2 id="by-project" className="text-card font-semibold text-fg">By project</h2>
                  <div className="mt-3">
                    <Bars testId="by-project" total={totals.totalMinutes} items={summary.byProject.map((row) => ({ key: row.projectId, label: row.name, minutes: row.minutes }))} />
                  </div>
                </section>
              ) : null}
              <section className="nesto-card px-5 py-4" aria-labelledby="by-member">
                <h2 id="by-member" className="text-card font-semibold text-fg">By person</h2>
                <div className="mt-3">
                  <Bars testId="by-member" total={totals.totalMinutes} items={summary.byMember.map((row) => ({ key: row.memberId, label: <PersonLink memberId={row.memberId} name={row.name} />, minutes: row.minutes, sub: row.billableMinutes ? `${formatMinutes(row.billableMinutes)} billable` : undefined }))} />
                </div>
              </section>
              <section className="nesto-card px-5 py-4" aria-labelledby="by-task">
                <h2 id="by-task" className="text-card font-semibold text-fg">By task</h2>
                {/* The ten tasks with most hours, said as such when there are more (AUD-08 §4: no unlabelled cut). */}
                {summary.byTaskCount > 10 ? <p className="text-meta text-fg-muted" data-testid="by-task-scope">Top 10 of {summary.byTaskCount} tasks by hours</p> : null}
                <div className="mt-3">
                  <Bars testId="by-task" total={totals.totalMinutes} items={summary.byTask.slice(0, 10).map((row) => ({ key: row.taskId ?? "none", label: row.title, minutes: row.minutes }))} />
                </div>
              </section>
              <section className={cn("nesto-card px-5 py-4", summary.project && "lg:col-span-1")} aria-labelledby="by-week">
                <h2 id="by-week" className="text-card font-semibold text-fg">By week</h2>
                <div className="mt-3">
                  <Bars testId="by-week" total={Math.max(...summary.byWeek.map((row) => row.minutes))} items={summary.byWeek.map((row) => ({ key: row.weekStart, label: weekLabel(row.weekStart), minutes: row.minutes }))} />
                </div>
              </section>
            </div>

            <section className="nesto-card overflow-x-auto" aria-labelledby="entries-title">
              <div className="flex items-baseline justify-between gap-3 px-5 pt-4">
                <h2 id="entries-title" className="text-card font-semibold text-fg">Entries</h2>
                {!summary.showsDescriptions ? <p className="text-meta text-fg-muted">Descriptions are shown to people who oversee the team.</p> : null}
              </div>
              <table className="mt-2 w-full min-w-[720px] border-collapse text-table" data-testid="project-entries">
                <thead>
                  <tr className="border-b border-line text-left text-meta text-fg-muted">
                    <th scope="col" className="px-5 py-2 font-medium">Date</th>
                    <th scope="col" className="px-3 py-2 font-medium">Person</th>
                    <th scope="col" className="px-3 py-2 font-medium">Project / task</th>
                    {summary.showsDescriptions ? <th scope="col" className="px-3 py-2 font-medium">Description</th> : null}
                    <th scope="col" className="px-3 py-2 font-medium">Week</th>
                    <th scope="col" className="px-5 py-2 text-right font-medium">Hours</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {summary.entries.map((entry) => (
                    <tr key={entry.id} className="hover:bg-row-hover">
                      <td className="whitespace-nowrap px-5 py-2 tabular-nums text-fg-muted">
                        {dayLabel(entry.workDate).weekday} {dayLabel(entry.workDate).day}
                      </td>
                      <td className="px-3 py-2 text-fg">
                        <PersonLink memberId={entry.member.memberId} name={entry.member.name} />
                      </td>
                      <td className="px-3 py-2">
                        <span className="block text-fg">{entry.project?.name ?? WORK_LOG_TYPE_LABELS[entry.workType]}</span>
                        {entry.task ? <span className="block text-meta text-fg-muted">{entry.task.title}</span> : null}
                      </td>
                      {summary.showsDescriptions ? <td className="max-w-[20rem] px-3 py-2 text-fg-muted">{entry.description ?? "—"}</td> : null}
                      <td className="px-3 py-2 text-fg-muted">{TIMESHEET_STATUS_LABELS[entry.status]}</td>
                      <td className="px-5 py-2 text-right font-medium tabular-nums text-fg">
                        {formatMinutes(entry.minutes)}
                        {entry.billable ? null : <span className="ml-1 text-micro font-normal text-fg-subtle">NB</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {summary.entriesTruncated ? <p className="px-5 py-3 text-meta text-fg-muted">Showing the latest 200 entries. Narrow the range to see the rest.</p> : <div className="h-2" />}
            </section>
          </>
        )}
      </div>
    </ModulePage>
  );
}
