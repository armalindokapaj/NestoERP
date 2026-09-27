import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { ChevronLeft, ChevronRight, Users } from "lucide-react";

import { ListToolbar, type FilterConfig } from "@/components/data/list-toolbar";
import { ModulePage } from "@/components/modules/module-page";
import { TimesheetStatusBadge } from "@/components/timesheets/timesheet-ui";
import { Button } from "@/components/ui/button";
import { ScrollRegion } from "@/components/ui/scroll-region";
import { EmptyState, NoResultsState, hasActiveFilters } from "@/components/ui/empty-state";
import { PersonLink } from "@/components/people/person-link";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { getTranslations } from "@/lib/i18n/server";
import { timesheetsLabel } from "@/lib/i18n/modules/timesheets/labels";
import type { Translate } from "@/lib/i18n/translator";
import { listTeamTimesheets } from "@/lib/modules/timesheets/timesheet.reports";
import { teamQuerySchema } from "@/lib/modules/timesheets/timesheet.schema";
import { addLocalDays, formatMinutes } from "@/lib/modules/timesheets/timesheet.time";
import { TIMESHEET_STATUS_LABELS } from "@/lib/modules/timesheets/timesheet.types";
import { cn } from "@/lib/utils/cn";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("timesheets"))("meta.team") };
}

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) || undefined;

function age(t: Translate<"timesheets">, iso: string | null): string {
  if (!iso) return "—";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return days <= 0 ? t("team.today") : days === 1 ? t("team.oneDay") : t("team.days", { count: days });
}

/**
 * The weeks of the people this reader oversees (PRD #42 §87-§89): one row per
 * person for the chosen week, what is waiting first, with its hours and how
 * long it has waited. Opening a row opens the week.
 */
export default async function TeamTimesheetsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const context = await requireModule("timesheets");
  const experience = resolveModuleExperience(context, "timesheets");
  const params = await searchParams;
  const query = teamQuerySchema.parse({
    week: one(params.week),
    status: one(params.status),
    departmentId: one(params.departmentId),
    approverMemberId: one(params.approverMemberId),
    q: one(params.q),
  });
  const [list, t] = await Promise.all([listTeamTimesheets(context, query), getTranslations("timesheets")]);

  const link = (week: string) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (typeof value === "string" && key !== "week") next.set(key, value);
    next.set("week", week);
    return `/timesheets/team?${next.toString()}`;
  };
  const filters: FilterConfig[] = [
    { param: "status", label: t("common.status"), options: [...(["SUBMITTED", "RETURNED", "REJECTED", "DRAFT", "APPROVED"] as const).map((status) => ({ value: status, label: timesheetsLabel(t, "status", status, TIMESHEET_STATUS_LABELS[status]) })), { value: "NOT_STARTED", label: timesheetsLabel(t, "status", "NOT_STARTED", "Not started") }] },
    ...(list.departments.length > 1 ? [{ param: "departmentId", label: t("team.department"), options: list.departments.map((row) => ({ value: row.id, label: row.name })) }] : []),
    ...(list.approvers.length > 1 ? [{ param: "approverMemberId", label: t("common.approver"), options: list.approvers.map((row) => ({ value: row.memberId, label: row.name })) }] : []),
  ];
  const waiting = list.counts.SUBMITTED;

  return (
    <ModulePage experience={experience} activeSection="team" description={t("team.description")}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1">
            <Button asChild variant="secondary" size="icon-sm">
              <Link href={link(addLocalDays(list.periodStart, -7))} aria-label={t("common.previousWeek")}>
                <ChevronLeft />
              </Link>
            </Button>
            <Button asChild variant="secondary" size="icon-sm">
              <Link href={link(addLocalDays(list.periodStart, 7))} aria-label={t("common.nextWeek")}>
                <ChevronRight />
              </Link>
            </Button>
          </div>
          <h2 className="text-section font-semibold text-fg">{list.weekLabel}</h2>
          <p className="text-table text-fg-muted">
            {t("team.people", { count: list.rows.length })}
            {waiting ? t("team.waitingDecision", { count: waiting }) : ""}
            {list.counts.NOT_STARTED ? t("team.notStartedCount", { count: list.counts.NOT_STARTED }) : ""}
          </p>
          {can(context, "approvals.view") && waiting ? (
            <Link href="/approvals?provider=timesheets" className="ml-auto text-table font-medium text-accent-strong hover:underline">
              {t("team.openInApprovals")}
            </Link>
          ) : null}
        </div>

        {/* English: "Search people…" */}
        <ListToolbar searchPlaceholder={t("team.searchPlaceholder")} searchParam="q" filters={filters} />

        {list.rows.length === 0 ? (
          // Search or a filter that matches nobody is not an empty team (AUD-05 §6, UX-11); Clear keeps the chosen week.
          hasActiveFilters(params, ["q", "status", "departmentId", "approverMemberId"]) ? (
            <NoResultsState noun={t("team.noun")} clearHref={`/timesheets/team?week=${list.periodStart}`} />
          ) : (
            <EmptyState icon={<Users />} title={t("team.emptyTitle")} description={t("team.emptyDescription")} />
          )
        ) : (
          <>
          {/*
            * Phones get one card per person with every column's value; the
            * table (from md) pans in a labelled region (AUD-04 §5, D-07-15,
            * D-07-18, MW-05).
            */}
          <ul className="space-y-3 md:hidden" aria-label={t("team.teamWeeks")} data-testid="team-cards">
            {list.rows.map((row) => (
              <li key={row.member.memberId} className="nesto-card space-y-2 px-4 py-3" data-testid="team-card">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    {row.href ? (
                      <Link href={row.href} className="inline-flex items-center font-medium text-fg [overflow-wrap:anywhere] hover:text-accent-strong touch:min-h-11">
                        {row.member.name}
                      </Link>
                    ) : (
                      <PersonLink memberId={row.member.memberId} name={row.member.name} />
                    )}
                    <span className="block text-meta text-fg-muted">{[row.member.jobTitle, row.member.department].filter(Boolean).join(" · ") || "—"}</span>
                  </div>
                  <TimesheetStatusBadge status={row.status} />
                </div>
                <dl className="grid grid-cols-3 gap-2 text-table">
                  <div>
                    <dt className="text-meta text-fg-subtle">{t("common.total")}</dt>
                    <dd className="font-medium tabular-nums">{row.totalMinutes ? formatMinutes(row.totalMinutes) : "–"}</dd>
                  </div>
                  <div>
                    <dt className="text-meta text-fg-subtle">{t("common.billable")}</dt>
                    <dd className="tabular-nums text-fg-muted">{row.billableMinutes ? formatMinutes(row.billableMinutes) : "–"}</dd>
                  </div>
                  <div>
                    <dt className="text-meta text-fg-subtle">{t("common.overtime")}</dt>
                    <dd className={cn("tabular-nums", row.overtimeMinutes ? "text-warning-strong" : "text-fg-muted")}>{row.overtimeMinutes ? formatMinutes(row.overtimeMinutes) : "–"}</dd>
                  </div>
                </dl>
                <p className="text-meta text-fg-muted">
                  {row.status === "SUBMITTED" ? t("team.waitingAge", { age: age(t, row.submittedAt) }) : ""}
                  {t("team.approverLabel")} {row.approver ? <PersonLink memberId={row.approver.memberId} name={row.approver.name} /> : t("common.notSet")}
                </p>
              </li>
            ))}
          </ul>
          <ScrollRegion label={t("team.teamWeeks")} className="nesto-card hidden md:block">
            <table className="w-full min-w-[760px] border-collapse text-table" data-testid="team-timesheets">
              <thead>
                <tr className="border-b border-line text-left text-meta text-fg-muted">
                  <th scope="col" className="px-4 py-2.5 font-medium">{t("common.person")}</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">{t("common.status")}</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">{t("common.total")}</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">{t("common.billable")}</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">{t("common.overtime")}</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">{t("team.waiting")}</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">{t("common.approver")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {list.rows.map((row) => (
                  <tr key={row.member.memberId} className="hover:bg-row-hover" data-testid="team-row">
                    <th scope="row" className="px-4 py-2.5 text-left font-normal">
                      {row.href ? (
                        <Link href={row.href} className="font-medium text-fg hover:text-accent-strong">
                          {row.member.name}
                        </Link>
                      ) : (
                        <PersonLink memberId={row.member.memberId} name={row.member.name} />
                      )}
                      <span className="block text-meta text-fg-muted">{[row.member.jobTitle, row.member.department].filter(Boolean).join(" · ") || "—"}</span>
                    </th>
                    <td className="px-3 py-2.5">
                      <TimesheetStatusBadge status={row.status} />
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium tabular-nums">{row.totalMinutes ? formatMinutes(row.totalMinutes) : "–"}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-fg-muted">{row.billableMinutes ? formatMinutes(row.billableMinutes) : "–"}</td>
                    <td className={cn("px-3 py-2.5 text-right tabular-nums", row.overtimeMinutes ? "text-warning-strong" : "text-fg-muted")}>{row.overtimeMinutes ? formatMinutes(row.overtimeMinutes) : "–"}</td>
                    <td className="px-3 py-2.5 text-fg-muted">{row.status === "SUBMITTED" ? age(t, row.submittedAt) : "—"}</td>
                    <td className="px-4 py-2.5 text-fg-muted">{row.approver ? <PersonLink memberId={row.approver.memberId} name={row.approver.name} /> : t("common.notSet")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
          </>
        )}
        {list.truncated ? (
          <p role="status" className="text-meta text-fg-muted" data-testid="team-truncated">
            {t("team.truncated")}
          </p>
        ) : null}
      </div>
    </ModulePage>
  );
}
