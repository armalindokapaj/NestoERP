import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { notFound } from "next/navigation";
import { FolderKanban } from "lucide-react";

import { selectClass } from "@/components/forms/record-form";
import { ModulePage } from "@/components/modules/module-page";
import { Button } from "@/components/ui/button";
import { ScrollRegion } from "@/components/ui/scroll-region";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PersonLink } from "@/components/people/person-link";
import { AccessError } from "@/lib/access/guards";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { getTranslations } from "@/lib/i18n/server";
import { timesheetsLabel } from "@/lib/i18n/modules/timesheets/labels";
import { projectTimeSummary } from "@/lib/modules/timesheets/timesheet.reports";
import { parseProjectSummaryQuery } from "@/lib/modules/timesheets/timesheet.schema";
import { dayLabel, formatMinutes, weekLabel } from "@/lib/modules/timesheets/timesheet.time";
import { TIMESHEET_STATUS_LABELS, WORK_LOG_TYPE_LABELS } from "@/lib/modules/timesheets/timesheet.types";
import { cn } from "@/lib/utils/cn";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("timesheets"))("meta.projectTime") };
}

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
  const t = await getTranslations("timesheets");

  return (
    <ModulePage experience={experience} activeSection="projects" description={t("projects.description")}>
      <div className="space-y-5">
        <form method="get" className="nesto-card flex flex-wrap items-end gap-3 px-4 py-3" aria-label={t("projects.filters")}>
          <label className="flex min-w-[14rem] flex-[2] flex-col">
            <span className="text-meta text-fg-muted">{t("common.project")}</span>
            <select name="projectId" defaultValue={summary.project?.id ?? ""} className={cn(selectClass, "mt-1 h-9")}>
              <option value="">{t("projects.allProjects")}</option>
              {summary.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.code ? `${project.code} · ` : ""}
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-[9rem] flex-1 flex-col">
            <span className="text-meta text-fg-muted">{t("common.from")}</span>
            <Input type="date" name="from" defaultValue={summary.from} className="mt-1 h-9" />
          </label>
          <label className="flex min-w-[9rem] flex-1 flex-col">
            <span className="text-meta text-fg-muted">{t("common.to")}</span>
            <Input type="date" name="to" defaultValue={summary.to} className="mt-1 h-9" />
          </label>
          {summary.members.length ? (
            <label className="flex min-w-[10rem] flex-1 flex-col">
              <span className="text-meta text-fg-muted">{t("common.person")}</span>
              <select name="memberId" defaultValue={typeof params.memberId === "string" ? params.memberId : ""} className={cn(selectClass, "mt-1 h-9")}>
                <option value="">{t("projects.everyone")}</option>
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
              <span className="text-meta text-fg-muted">{t("common.task")}</span>
              <select name="taskId" defaultValue={typeof params.taskId === "string" ? params.taskId : ""} className={cn(selectClass, "mt-1 h-9")}>
                <option value="">{t("projects.allTasks")}</option>
                {summary.tasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="flex w-40 flex-none flex-col">
            <span className="text-meta text-fg-muted">{t("common.billable")}</span>
            <select name="billable" defaultValue={summary.billable} className={cn(selectClass, "mt-1 h-9")}>
              <option value="all">{t("projects.allTime")}</option>
              <option value="billable">{t("common.billable")}</option>
              <option value="non_billable">{t("common.nonBillable")}</option>
            </select>
          </label>
          <label className="flex w-40 flex-none flex-col">
            <span className="text-meta text-fg-muted">{t("projects.weeks")}</span>
            <select name="include" defaultValue={summary.approvedOnly ? "approved" : "all"} className={cn(selectClass, "mt-1 h-9")}>
              <option value="approved">{t("projects.approvedOnly")}</option>
              <option value="all">{t("projects.allLogged")}</option>
            </select>
          </label>
          <div className="flex gap-2">
            <Button type="submit" size="sm">
              {t("common.apply")}
            </Button>
            <Button asChild type="button" size="sm" variant="ghost">
              <Link href="/timesheets/projects">{t("common.reset")}</Link>
            </Button>
          </div>
        </form>

        <section aria-label={t("projects.totals")} className="nesto-card px-5 py-4">
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 className="text-section font-semibold text-fg">{summary.project ? summary.project.name : t("projects.allProjects")}</h2>
            <span className="text-table text-fg-muted">
              {dayLabel(summary.from).day} – {dayLabel(summary.to).day} {summary.to.slice(0, 4)} · {summary.approvedOnly ? t("projects.approvedWeeks") : t("projects.allLoggedTime")}
            </span>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <dt className="text-meta text-fg-muted">{t("common.total")}</dt>
              <dd className="text-section font-semibold tabular-nums text-fg" data-testid="project-total">{formatMinutes(totals.totalMinutes)}</dd>
            </div>
            <div>
              <dt className="text-meta text-fg-muted">{t("common.billable")}</dt>
              <dd className="text-section font-semibold tabular-nums text-fg">{formatMinutes(totals.billableMinutes)}</dd>
            </div>
            <div>
              <dt className="text-meta text-fg-muted">{t("common.nonBillable")}</dt>
              <dd className="text-section font-semibold tabular-nums text-fg">{formatMinutes(totals.nonBillableMinutes)}</dd>
            </div>
            <div>
              <dt className="text-meta text-fg-muted">{t("projects.markedOvertime")}</dt>
              <dd className="text-section font-semibold tabular-nums text-fg-muted">{formatMinutes(totals.overtimeFlaggedMinutes)}</dd>
            </div>
          </dl>
        </section>

        {totals.totalMinutes === 0 ? (
          <EmptyState icon={<FolderKanban />} title={t("projects.emptyTitle")} description={summary.approvedOnly ? t("projects.emptyApproved") : t("projects.emptyAll")} />
        ) : (
          <>
            <div className="grid gap-5 lg:grid-cols-3">
              {!summary.project ? (
                <section className="nesto-card px-5 py-4" aria-labelledby="by-project">
                  <h2 id="by-project" className="text-card font-semibold text-fg">{t("projects.byProject")}</h2>
                  <div className="mt-3">
                    <Bars testId="by-project" total={totals.totalMinutes} items={summary.byProject.map((row) => ({ key: row.projectId, label: row.name, minutes: row.minutes }))} />
                  </div>
                </section>
              ) : null}
              <section className="nesto-card px-5 py-4" aria-labelledby="by-member">
                <h2 id="by-member" className="text-card font-semibold text-fg">{t("projects.byPerson")}</h2>
                <div className="mt-3">
                  <Bars testId="by-member" total={totals.totalMinutes} items={summary.byMember.map((row) => ({ key: row.memberId, label: <PersonLink memberId={row.memberId} name={row.name} />, minutes: row.minutes, sub: row.billableMinutes ? t("projects.billableSub", { time: formatMinutes(row.billableMinutes) }) : undefined }))} />
                </div>
              </section>
              <section className="nesto-card px-5 py-4" aria-labelledby="by-task">
                <h2 id="by-task" className="text-card font-semibold text-fg">{t("projects.byTask")}</h2>
                {/* The ten tasks with most hours, said as such when there are more (AUD-08 §4: no unlabelled cut). */}
                {summary.byTaskCount > 10 ? <p className="text-meta text-fg-muted" data-testid="by-task-scope">{t("projects.topTasks", { count: summary.byTaskCount })}</p> : null}
                <div className="mt-3">
                  <Bars testId="by-task" total={totals.totalMinutes} items={summary.byTask.slice(0, 10).map((row) => ({ key: row.taskId ?? "none", label: row.title, minutes: row.minutes }))} />
                </div>
              </section>
              <section className={cn("nesto-card px-5 py-4", summary.project && "lg:col-span-1")} aria-labelledby="by-week">
                <h2 id="by-week" className="text-card font-semibold text-fg">{t("projects.byWeek")}</h2>
                <div className="mt-3">
                  <Bars testId="by-week" total={Math.max(...summary.byWeek.map((row) => row.minutes))} items={summary.byWeek.map((row) => ({ key: row.weekStart, label: weekLabel(row.weekStart), minutes: row.minutes }))} />
                </div>
              </section>
            </div>

            <section className="nesto-card" aria-labelledby="entries-title">
              <div className="flex items-baseline justify-between gap-3 px-5 pt-4">
                <h2 id="entries-title" className="text-card font-semibold text-fg">{t("common.entries")}</h2>
                {!summary.showsDescriptions ? <p className="text-meta text-fg-muted">{t("projects.descriptionsHidden")}</p> : null}
              </div>
              {/* The entries pan in a labelled region, the heading stays put (AUD-04 §5, D-07-15, MW-19). */}
              <ScrollRegion label={t("common.entries")} className="mt-2">
              <table className="w-full min-w-[720px] border-collapse text-table" data-testid="project-entries">
                <thead>
                  <tr className="border-b border-line text-left text-meta text-fg-muted">
                    <th scope="col" className="px-5 py-2 font-medium">{t("projects.date")}</th>
                    <th scope="col" className="px-3 py-2 font-medium">{t("common.person")}</th>
                    <th scope="col" className="px-3 py-2 font-medium">{t("projects.projectTask")}</th>
                    {summary.showsDescriptions ? <th scope="col" className="px-3 py-2 font-medium">{t("projects.description_")}</th> : null}
                    <th scope="col" className="px-3 py-2 font-medium">{t("projects.week")}</th>
                    <th scope="col" className="px-5 py-2 text-right font-medium">{t("projects.hours")}</th>
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
                        <span className="block text-fg">{entry.project?.name ?? timesheetsLabel(t, "workType", entry.workType, WORK_LOG_TYPE_LABELS[entry.workType])}</span>
                        {entry.task ? <span className="block text-meta text-fg-muted">{entry.task.title}</span> : null}
                      </td>
                      {summary.showsDescriptions ? <td className="max-w-[20rem] px-3 py-2 text-fg-muted">{entry.description ?? "—"}</td> : null}
                      <td className="px-3 py-2 text-fg-muted">{timesheetsLabel(t, "status", entry.status, TIMESHEET_STATUS_LABELS[entry.status])}</td>
                      <td className="px-5 py-2 text-right font-medium tabular-nums text-fg">
                        {formatMinutes(entry.minutes)}
                        {entry.billable ? null : <span className="ml-1 text-micro font-normal text-fg-subtle">{t("projects.nonBillableShort")}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </ScrollRegion>
              {summary.entriesTruncated ? <p className="px-5 py-3 text-meta text-fg-muted">{t("projects.truncated")}</p> : <div className="h-2" />}
            </section>
          </>
        )}
      </div>
    </ModulePage>
  );
}
