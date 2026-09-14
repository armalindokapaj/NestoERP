import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Users } from "lucide-react";

import { ListToolbar, type FilterConfig } from "@/components/data/list-toolbar";
import { ModulePage } from "@/components/modules/module-page";
import { TimesheetStatusBadge } from "@/components/timesheets/timesheet-ui";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { listTeamTimesheets } from "@/lib/modules/timesheets/timesheet.reports";
import { teamQuerySchema } from "@/lib/modules/timesheets/timesheet.schema";
import { addLocalDays, formatMinutes } from "@/lib/modules/timesheets/timesheet.time";
import { TIMESHEET_STATUS_LABELS } from "@/lib/modules/timesheets/timesheet.types";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = { title: "Team timesheets" };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) || undefined;

function age(iso: string | null): string {
  if (!iso) return "—";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return days <= 0 ? "Today" : days === 1 ? "1 day" : `${days} days`;
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
  const list = await listTeamTimesheets(context, query);

  const link = (week: string) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (typeof value === "string" && key !== "week") next.set(key, value);
    next.set("week", week);
    return `/timesheets/team?${next.toString()}`;
  };
  const filters: FilterConfig[] = [
    { param: "status", label: "Status", options: [...(["SUBMITTED", "RETURNED", "REJECTED", "DRAFT", "APPROVED"] as const).map((status) => ({ value: status, label: TIMESHEET_STATUS_LABELS[status] })), { value: "NOT_STARTED", label: "Not started" }] },
    ...(list.departments.length > 1 ? [{ param: "departmentId", label: "Department", options: list.departments.map((row) => ({ value: row.id, label: row.name })) }] : []),
    ...(list.approvers.length > 1 ? [{ param: "approverMemberId", label: "Approver", options: list.approvers.map((row) => ({ value: row.memberId, label: row.name })) }] : []),
  ];
  const waiting = list.counts.SUBMITTED;

  return (
    <ModulePage experience={experience} activeSection="team" description="Your people's weeks: what is waiting, what is missing, and where the time went.">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1">
            <Button asChild variant="secondary" size="icon-sm">
              <Link href={link(addLocalDays(list.periodStart, -7))} aria-label="Previous week">
                <ChevronLeft />
              </Link>
            </Button>
            <Button asChild variant="secondary" size="icon-sm">
              <Link href={link(addLocalDays(list.periodStart, 7))} aria-label="Next week">
                <ChevronRight />
              </Link>
            </Button>
          </div>
          <h2 className="text-section font-semibold text-fg">{list.weekLabel}</h2>
          <p className="text-table text-fg-muted">
            {list.rows.length} {list.rows.length === 1 ? "person" : "people"}
            {waiting ? ` · ${waiting} waiting for a decision` : ""}
            {list.counts.NOT_STARTED ? ` · ${list.counts.NOT_STARTED} not started` : ""}
          </p>
          {can(context, "approvals.view") && waiting ? (
            <Link href="/approvals?provider=timesheets" className="ml-auto text-table font-medium text-accent-strong hover:underline">
              Open in Approvals
            </Link>
          ) : null}
        </div>

        <ListToolbar searchPlaceholder="Search people…" searchParam="q" filters={filters} />

        {list.rows.length === 0 ? (
          <EmptyState icon={<Users />} title="Nobody here for this week." description="People whose timesheets you oversee or approve appear here." />
        ) : (
          <div className="nesto-card overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-table" data-testid="team-timesheets">
              <thead>
                <tr className="border-b border-line text-left text-meta text-fg-muted">
                  <th scope="col" className="px-4 py-2.5 font-medium">Person</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Status</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Total</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Billable</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Overtime</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Waiting</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Approver</th>
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
                        <span className="font-medium text-fg">{row.member.name}</span>
                      )}
                      <span className="block text-meta text-fg-muted">{[row.member.jobTitle, row.member.department].filter(Boolean).join(" · ") || "—"}</span>
                    </th>
                    <td className="px-3 py-2.5">
                      <TimesheetStatusBadge status={row.status} />
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium tabular-nums">{row.totalMinutes ? formatMinutes(row.totalMinutes) : "–"}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-fg-muted">{row.billableMinutes ? formatMinutes(row.billableMinutes) : "–"}</td>
                    <td className={cn("px-3 py-2.5 text-right tabular-nums", row.overtimeMinutes ? "text-warning-strong" : "text-fg-muted")}>{row.overtimeMinutes ? formatMinutes(row.overtimeMinutes) : "–"}</td>
                    <td className="px-3 py-2.5 text-fg-muted">{row.status === "SUBMITTED" ? age(row.submittedAt) : "—"}</td>
                    <td className="px-4 py-2.5 text-fg-muted">{row.approver?.name ?? "Not set"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {list.truncated ? <p className="text-meta text-fg-muted">Showing the first 500 people. Filter by department to narrow the list.</p> : null}
      </div>
    </ModulePage>
  );
}
