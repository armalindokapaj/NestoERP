import { can } from "@/lib/access/can";
import { prisma } from "@/lib/database/prisma";
import { readableTimesheetWhere, seesEntryDetail } from "@/lib/modules/timesheets/timesheet.permissions";
import { getTimesheet } from "@/lib/modules/timesheets/timesheet.service";
import { resolveTimesheetSettings } from "@/lib/modules/timesheets/timesheet.settings";
import { approveTimesheet, rejectTimesheet, returnTimesheet, timesheetReadableBy } from "@/lib/modules/timesheets/timesheet.submission";
import { dateOf, dayLabel, formatMinutes, weekLabel } from "@/lib/modules/timesheets/timesheet.time";
import { WORK_LOG_TYPE_LABELS, type TimesheetWeekDTO } from "@/lib/modules/timesheets/timesheet.types";
import { createCycleProvider, type CycleTable, type RecordFacts } from "../approvals.cycle-provider";
import { excludesAmountFilter, MATCH_LIMIT, term } from "./shared";

/**
 * Timesheet approvals in the Center (PRD #42 §70, §71, §79, §210, §211).
 *
 * A week is decided as one unit by the member's designated approver — or the
 * person standing in for them — through a one-step chain written when it was
 * submitted. The detail reads like the week itself: the member, the week, the
 * totals, where the time went, each day, and what the approver should look at
 * before deciding. Warnings inform; none of them stops a decision.
 */

const DETAIL_ENTRY_LIMIT = 80;

function weekFacts(week: TimesheetWeekDTO, showDescriptions: boolean): RecordFacts {
  const label = weekLabel(week.periodStart);
  const lines = week.logs
    .slice()
    .sort((a, b) => a.workDate.localeCompare(b.workDate) || (a.project?.name ?? "").localeCompare(b.project?.name ?? ""))
    .slice(0, DETAIL_ENTRY_LIMIT)
    .map((log) => {
      const day = dayLabel(log.workDate);
      const what = [log.project?.name ?? WORK_LOG_TYPE_LABELS[log.workType], log.task?.title].filter(Boolean).join(" / ");
      const flags = [log.billable ? "billable" : null, log.overtimeFlag ? "overtime" : null].filter(Boolean).join(", ");
      const text = showDescriptions && log.description ? ` — ${log.description.replace(/\s+/g, " ").slice(0, 160)}` : "";
      return `${day.weekday} ${day.day} · ${what} · ${formatMinutes(log.minutes)}${flags ? ` (${flags})` : ""}${text}`;
    });
  const more = week.logs.length > DETAIL_ENTRY_LIMIT ? `\n…and ${week.logs.length - DETAIL_ENTRY_LIMIT} more entries on the full timesheet.` : "";
  return {
    id: week.id!,
    reference: label,
    title: `${week.member.name} — ${label}`,
    subtitle: `${formatMinutes(week.totals.totalMinutes)} logged`,
    amount: null,
    project: null,
    href: `/timesheets/${week.id}`,
    priority: "NORMAL",
    summary: [
      { label: "Employee", value: week.member.name, person: { memberId: week.member.memberId } },
      { label: "Week", value: label },
      { label: "Total", value: formatMinutes(week.totals.totalMinutes), emphasis: "strong" },
      { label: "Billable", value: formatMinutes(week.totals.billableMinutes) },
      { label: "Non-billable", value: formatMinutes(week.totals.nonBillableMinutes) },
      { label: "Overtime", value: formatMinutes(week.totals.overtimeMinutes), emphasis: week.totals.overtimeMinutes > 0 ? "warning" : "normal" },
      { label: "Expected", value: formatMinutes(week.totals.expectedMinutes) },
      ...week.totals.projects.map((project) => ({ label: project.name, value: formatMinutes(project.minutes) })),
      {
        label: "Daily totals",
        value: week.days
          .filter((day) => day.totalMinutes > 0 || day.leave)
          .map((day) => `${dayLabel(day.date).weekday} ${formatMinutes(day.totalMinutes)}${day.leave ? " (leave)" : ""}`)
          .join(" · ") || "Nothing logged",
      },
    ],
    description: lines.length > 0 ? `${lines.join("\n")}${more}` : null,
    warnings: week.warnings,
    reason: "A week's time is approved before it counts in project reporting.",
  };
}

export const timesheetApprovalProvider = createCycleProvider({
  key: "timesheets",
  moduleKey: "timesheets",
  label: "Timesheets",
  table: () => prisma.timesheetApproval as unknown as CycleTable,
  chain: { canReadAs: (recordId) => timesheetReadableBy(recordId) },
  records: {
    TIMESHEET: {
      recordType: "timesheet",
      noun: "Timesheet",
      // Beyond their own, a team reader sees their people's approval history.
      canView: (context) => can(context, "timesheet.team.view"),
      canApprove: (context) => can(context, "timesheet.approve"),
      canReject: (context) => can(context, "timesheet.reject") || can(context, "timesheet.return"),
      selfPermission: null,
      reason: "A week's time is approved before it counts in project reporting.",
      async match(context, filters) {
        if (excludesAmountFilter(filters)) return [];
        const q = filters.q?.trim();
        const rows = await prisma.timesheet.findMany({
          where: {
            AND: [
              await readableTimesheetWhere(context),
              { status: { not: "DRAFT" } },
              filters.projectId ? { workLogs: { some: { projectId: filters.projectId } } } : {},
              q ? { OR: [{ member: { user: { firstName: term(q) } } }, { member: { user: { lastName: term(q) } } }, { member: { user: { email: term(q) } } }] } : {},
            ],
          },
          select: { id: true },
          take: MATCH_LIMIT,
        });
        return rows.map((row) => row.id);
      },
      async hydrate(context, ids) {
        if (ids.length === 0) return new Map();
        // One week, opened in the drawer: everything the week screen knows (§79).
        if (ids.length === 1) {
          try {
            const week = await getTimesheet(context, ids[0]);
            return new Map([[ids[0], weekFacts(week, seesEntryDetail(context) || week.approver?.memberId === context.membershipId || week.capabilities.approvalHref !== null || week.capabilities.isOwn)]]);
          } catch {
            return new Map();
          }
        }
        // A list: totals only, in three queries however long it is.
        const [rows, settings] = await Promise.all([
          prisma.timesheet.findMany({
            where: { AND: [await readableTimesheetWhere(context), { id: { in: ids } }] },
            select: { id: true, periodStart: true, memberId: true, member: { select: { user: { select: { firstName: true, lastName: true } }, department: { select: { name: true } } } } },
          }),
          resolveTimesheetSettings(context.companyId),
        ]);
        const sums = rows.length
          ? await prisma.workLog.groupBy({ by: ["timesheetId", "billable"], where: { timesheetId: { in: rows.map((row) => row.id) } }, _sum: { minutes: true } })
          : [];
        const totals = new Map<string, { total: number; billable: number }>();
        for (const sum of sums) {
          const entry = totals.get(sum.timesheetId) ?? { total: 0, billable: 0 };
          entry.total += sum._sum.minutes ?? 0;
          if (sum.billable) entry.billable += sum._sum.minutes ?? 0;
          totals.set(sum.timesheetId, entry);
        }
        return new Map(
          rows.map((row): [string, RecordFacts] => {
            const label = weekLabel(dateOf(row.periodStart));
            const name = `${row.member.user.firstName} ${row.member.user.lastName}`;
            const sum = totals.get(row.id) ?? { total: 0, billable: 0 };
            const overtime = Math.max(0, sum.total - settings.standardWeeklyMinutes);
            return [
              row.id,
              {
                id: row.id,
                reference: label,
                title: `${name} — ${label}`,
                subtitle: [row.member.department?.name, `${formatMinutes(sum.total)} logged`].filter(Boolean).join(" · "),
                amount: null,
                project: null,
                href: `/timesheets/${row.id}`,
                priority: "NORMAL",
                summary: [
                  { label: "Employee", value: name, person: { memberId: row.memberId } },
                  { label: "Week", value: label },
                  { label: "Total", value: formatMinutes(sum.total), emphasis: "strong" },
                  { label: "Billable", value: formatMinutes(sum.billable) },
                  { label: "Overtime", value: formatMinutes(overtime), emphasis: overtime > 0 ? "warning" : "normal" },
                ],
              },
            ];
          }),
        );
      },
      approve: (context, id, note, guard) => approveTimesheet(context, id, note, guard),
      reject: (context, id, note, guard) => rejectTimesheet(context, id, note, guard),
      returnForRevision: (context, id, note, guard) => returnTimesheet(context, id, note, guard),
    },
  },
});
