import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChartColumn } from "lucide-react";

import { DataTable, type TableColumn } from "@/components/data/data-table";
import { Money } from "@/components/finance/money";
import { formatDays } from "@/components/hr/hr-format";
import { ModulePage } from "@/components/modules/module-page";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import type { UserContext } from "@/lib/context/types";
import { employmentTypeLabels, leaveTypeLabels } from "@/lib/modules/hr/hr.status";
import { isDay } from "@/lib/modules/hr/employment/employment.dates";
import { getOrganizationReport } from "@/lib/modules/hr/employment/employment.report";
import type { HeadcountRowDTO } from "@/lib/modules/hr/employment/employment.types";
import * as reports from "@/lib/modules/hr/reports/reports.service";
import { formatDate, orDash } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = { title: "HR reports" };

/**
 * The built-in HR reports (PRD #16 §139, §140).
 *
 * Named reports, not a report builder. Each one needs the permission behind the
 * data it summarises as well as `hr.report.view`, so the tab strip is the list
 * of reports the reader can actually open — and the compensation report needs
 * the compensation permission on top (PRD #16 §141, §292).
 */
const REPORTS = [
  { key: "headcount", label: "Headcount" },
  { key: "leave", label: "Leave summary" },
  { key: "attendance", label: "Attendance summary" },
  { key: "ending-soon", label: "Employment ending" },
  { key: "compensation", label: "Compensation" },
  { key: "organization", label: "Organization" },
] as const;

type ReportKey = (typeof REPORTS)[number]["key"];

export default async function HrReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ report?: string; asOf?: string; from?: string; to?: string }>;
}) {
  const context = await requireModule("hr");

  if (!can(context, "hr.report.view")) redirect("/access-denied");

  const experience = resolveModuleExperience(context, "hr");
  const { report: requested, asOf, from, to } = await searchParams;

  const allowed = reports.availableReports(context);
  const available = REPORTS.filter((entry) =>
    entry.key === "ending-soon" ? allowed.endingSoon : allowed[entry.key],
  );

  if (available.length === 0) {
    return (
      <ModulePage experience={experience} activeSection="reports">
        <EmptyState
          icon={<ChartColumn />}
          title="No reports in your view."
          description="Reports follow the same permissions as the lists they summarise."
        />
      </ModulePage>
    );
  }

  const active = (available.find((entry) => entry.key === requested)?.key ??
    available[0].key) as ReportKey;

  return (
    <ModulePage experience={experience} activeSection="reports">
      <div className="space-y-5">
        <nav aria-label="Reports" className="border-b border-line">
          <ul className="-mb-px flex gap-1 overflow-x-auto">
            {available.map((entry) => (
              <li key={entry.key}>
                <Link
                  href={`/hr/reports?report=${entry.key}`}
                  aria-current={entry.key === active ? "page" : undefined}
                  className={cn(
                    "inline-flex h-10 items-center whitespace-nowrap border-b-2 px-3 text-table font-medium transition-colors",
                    entry.key === active
                      ? "border-accent text-fg"
                      : "border-transparent text-fg-muted hover:border-line-strong hover:text-fg",
                  )}
                >
                  {entry.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {active === "headcount" ? <HeadcountReport context={context} /> : null}
        {active === "leave" ? <LeaveReport context={context} /> : null}
        {active === "attendance" ? <AttendanceReport context={context} /> : null}
        {active === "ending-soon" ? <EndingSoonReport context={context} /> : null}
        {active === "compensation" ? <CompensationReport context={context} /> : null}
        {active === "organization" ? <OrganizationReport context={context} query={{ asOf, from, to }} /> : null}
      </div>
    </ModulePage>
  );
}

function ReportShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-card font-semibold text-fg">{title}</h2>
        <p className="mt-1 text-meta text-fg-subtle">{description}</p>
      </div>
      {children}
    </section>
  );
}

async function HeadcountReport({ context }: { context: UserContext }) {
  const rows = await reports.headcountReport(context);

  const columns: TableColumn<reports.HeadcountRow>[] = [
    {
      key: "department",
      label: "Department",
      primary: true,
      render: (row) => <span>{row.department}</span>,
    },
    {
      key: "active",
      label: "Active",
      align: "right",
      render: (row) => <span className="tabular-nums">{row.active}</span>,
    },
    {
      key: "onLeave",
      label: "On leave",
      align: "right",
      render: (row) => <span className="tabular-nums text-fg-muted">{row.onLeave}</span>,
    },
    {
      key: "planned",
      label: "Planned",
      align: "right",
      hideBelow: "md",
      render: (row) => <span className="tabular-nums text-fg-muted">{row.planned}</span>,
    },
    {
      key: "ended",
      label: "Ended",
      align: "right",
      hideBelow: "md",
      render: (row) => <span className="tabular-nums text-fg-muted">{row.ended}</span>,
    },
  ];

  return (
    <ReportShell
      title="Headcount"
      description="Active headcount counts employment that is running — active plus on leave. Suspended and ended are shown separately (PRD #16 §142)."
    >
      {rows.length === 0 ? (
        <EmptyState icon={<ChartColumn />} title="No employment records in your view." />
      ) : (
        <DataTable
          caption="Headcount by department"
          columns={columns}
          records={rows}
          rowKey={(row) => row.departmentId ?? row.department}
        />
      )}
    </ReportShell>
  );
}

async function LeaveReport({ context }: { context: UserContext }) {
  const rows = await reports.leaveSummary(context);

  const columns: TableColumn<(typeof rows)[number]>[] = [
    {
      key: "leaveType",
      label: "Leave type",
      primary: true,
      render: (row) => <span>{leaveTypeLabels[row.leaveType]}</span>,
    },
    {
      key: "requests",
      label: "Requests",
      align: "right",
      render: (row) => <span className="tabular-nums">{row.requests}</span>,
    },
    {
      key: "days",
      label: "Days",
      align: "right",
      render: (row) => <span className="tabular-nums">{formatDays(row.days)}</span>,
    },
  ];

  return (
    <ReportShell
      title="Leave summary"
      description="Approved leave this leave year, within your scope. Reasons are never part of a report."
    >
      {rows.length === 0 ? (
        <EmptyState icon={<ChartColumn />} title="No leave recorded this year." />
      ) : (
        <DataTable
          caption="Leave summary"
          columns={columns}
          records={rows}
          rowKey={(row) => row.leaveType}
        />
      )}
    </ReportShell>
  );
}

async function AttendanceReport({ context }: { context: UserContext }) {
  const rows = await reports.attendanceSummary(context);

  const columns: TableColumn<(typeof rows)[number]>[] = [
    {
      key: "employee",
      label: "Employee",
      primary: true,
      render: (row) => <span className="min-w-0 truncate">{row.fullName}</span>,
    },
    {
      key: "present",
      label: "Present",
      align: "right",
      render: (row) => <span className="tabular-nums">{row.present}</span>,
    },
    {
      key: "remote",
      label: "Remote",
      align: "right",
      hideBelow: "md",
      render: (row) => <span className="tabular-nums text-fg-muted">{row.remote}</span>,
    },
    {
      key: "onLeave",
      label: "On leave",
      align: "right",
      hideBelow: "md",
      render: (row) => <span className="tabular-nums text-fg-muted">{row.onLeave}</span>,
    },
    {
      key: "absent",
      label: "Absent",
      align: "right",
      render: (row) => <span className="tabular-nums text-fg-muted">{row.absent}</span>,
    },
    {
      key: "exceptions",
      label: "Exceptions",
      align: "right",
      render: (row) => <span className="tabular-nums">{row.exceptions}</span>,
    },
  ];

  return (
    <ReportShell
      title="Attendance summary"
      description="The last 30 days. An exception is an absence, or a day somebody checked in and never checked out."
    >
      {rows.length === 0 ? (
        <EmptyState icon={<ChartColumn />} title="No attendance recorded in this period." />
      ) : (
        <DataTable
          caption="Attendance summary"
          columns={columns}
          records={rows}
          rowKey={(row) => row.employeeId}
          rowHref={(row) => `/hr/employees/${row.employeeId}/attendance`}
        />
      )}
    </ReportShell>
  );
}

async function EndingSoonReport({ context }: { context: UserContext }) {
  const rows = await reports.upcomingEndDates(context);

  const columns: TableColumn<(typeof rows)[number]>[] = [
    {
      key: "employee",
      label: "Employee",
      primary: true,
      render: (row) => <span className="min-w-0 truncate">{row.fullName}</span>,
    },
    {
      key: "department",
      label: "Department",
      hideBelow: "md",
      render: (row) => <span className="text-fg-muted">{orDash(row.department)}</span>,
    },
    {
      key: "employmentType",
      label: "Type",
      hideBelow: "lg",
      render: (row) => (
        <span className="text-fg-muted">{employmentTypeLabels[row.employmentType]}</span>
      ),
    },
    {
      key: "endDate",
      label: "Last day",
      render: (row) => <span>{formatDate(row.endDate)}</span>,
    },
  ];

  return (
    <ReportShell
      title="Employment ending"
      description="End dates in the next 90 days, for employment that has not already ended (PRD #16 §145)."
    >
      {rows.length === 0 ? (
        <EmptyState icon={<ChartColumn />} title="No employment ending in the next 90 days." />
      ) : (
        <DataTable
          caption="Employment ending"
          columns={columns}
          records={rows}
          rowKey={(row) => row.employeeId}
          rowHref={(row) => `/hr/employees/${row.employeeId}`}
        />
      )}
    </ReportShell>
  );
}

async function CompensationReport({ context }: { context: UserContext }) {
  const rows = await reports.compensationReport(context);

  const columns: TableColumn<(typeof rows)[number]>[] = [
    {
      key: "employee",
      label: "Employee",
      primary: true,
      render: (row) => <span className="min-w-0 truncate">{row.fullName}</span>,
    },
    {
      key: "department",
      label: "Department",
      hideBelow: "md",
      render: (row) => <span className="text-fg-muted">{orDash(row.department)}</span>,
    },
    {
      key: "payType",
      label: "Pay type",
      hideBelow: "lg",
      render: (row) => <span className="text-fg-muted">{row.payType}</span>,
    },
    {
      key: "baseAmount",
      label: "Amount",
      align: "right",
      render: (row) => <Money amount={row.baseAmount} currency={row.currency} emphasis />,
    },
    {
      key: "effectiveFrom",
      label: "Since",
      hideBelow: "md",
      render: (row) => <span className="text-fg-muted">{formatDate(row.effectiveFrom)}</span>,
    },
  ];

  return (
    <ReportShell
      title="Compensation"
      description="Current pay for employees in your view. This report needs the compensation permission on top of report access (PRD #16 §141)."
    >
      {rows.length === 0 ? (
        <EmptyState icon={<ChartColumn />} title="No compensation recorded." />
      ) : (
        <DataTable
          caption="Compensation"
          columns={columns}
          records={rows}
          rowKey={(row) => row.employeeId}
          rowHref={(row) => `/hr/employees/${row.employeeId}/compensation`}
        />
      )}
    </ReportShell>
  );
}

/**
 * The organization as of a day, and what moved in a period (E-03 §141-§144):
 * every figure from the history's effective dates, never from when a row was
 * written.
 */
async function OrganizationReport({ context, query }: { context: UserContext; query: { asOf?: string; from?: string; to?: string } }) {
  const valid = (value?: string) => (value && isDay(value) ? value : undefined);
  const report = await getOrganizationReport(context, { asOf: valid(query.asOf), from: valid(query.from), to: valid(query.to) });
  const breakdown = (title: string, rows: HeadcountRowDTO[], testId: string) => (
    <section className="nesto-card p-5" aria-label={title} data-testid={testId}>
      <h3 className="text-table font-semibold text-fg">{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-2 text-meta text-fg-subtle">Nobody.</p>
      ) : (
        <ul className="mt-2 space-y-1 text-table">
          {rows.map((row) => (
            <li key={row.key} className="flex justify-between gap-3">
              <span className="text-fg-muted">{row.label}</span>
              <span className="tabular-nums font-medium text-fg">{row.count}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
  const moves = report.movements;
  return (
    <ReportShell title="Organization" description={`Headcount on ${formatDate(report.asOf)} — employed that day, active or on leave, where they sat that day — and what changed from ${formatDate(report.period.from)} to ${formatDate(report.period.to)}.`}>
      <form method="get" className="flex flex-wrap items-end gap-3" aria-label="Report dates">
        <input type="hidden" name="report" value="organization" />
        <label className="space-y-1 text-meta text-fg-muted">
          <span className="block">As of</span>
          <input type="date" name="asOf" defaultValue={report.asOf} className="h-9 rounded-md border border-line bg-surface px-2 text-table text-fg" />
        </label>
        <label className="space-y-1 text-meta text-fg-muted">
          <span className="block">Changes from</span>
          <input type="date" name="from" defaultValue={report.period.from} className="h-9 rounded-md border border-line bg-surface px-2 text-table text-fg" />
        </label>
        <label className="space-y-1 text-meta text-fg-muted">
          <span className="block">to</span>
          <input type="date" name="to" defaultValue={report.period.to} className="h-9 rounded-md border border-line bg-surface px-2 text-table text-fg" />
        </label>
        <button type="submit" className="h-9 rounded-md border border-line-strong px-3 text-table font-medium text-fg hover:bg-hover">
          Show
        </button>
      </form>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="nesto-card p-4" data-testid="org-headcount">
          <p className="text-meta text-fg-subtle">Headcount</p>
          <p className="text-2xl font-semibold tabular-nums text-fg">{report.headcount}</p>
        </div>
        <div className="nesto-card p-4">
          <p className="text-meta text-fg-subtle">Joiners · leavers</p>
          <p className="text-2xl font-semibold tabular-nums text-fg">
            {moves.joiners} · {moves.leavers}
          </p>
        </div>
        <div className="nesto-card p-4">
          <p className="text-meta text-fg-subtle">Promotions · transfers</p>
          <p className="text-2xl font-semibold tabular-nums text-fg">
            {moves.promotions} · {moves.departmentTransfers + moves.companyTransfers}
          </p>
        </div>
        <div className="nesto-card p-4">
          <p className="text-meta text-fg-subtle">Average tenure</p>
          <p className="text-2xl font-semibold tabular-nums text-fg">{report.tenure.averageYears === null ? "—" : `${report.tenure.averageYears} yrs`}</p>
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {breakdown("By company", report.byCompany, "org-by-company")}
        {breakdown("By department", report.byDepartment, "org-by-department")}
        {breakdown("By job title", report.byTitle, "org-by-title")}
        {breakdown("By status", report.byStatus, "org-by-status")}
      </div>
      <section className="nesto-card p-5" aria-label="Movements">
        <h3 className="text-table font-semibold text-fg">Movements in the period</h3>
        <dl className="mt-2 grid gap-2 text-table sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Joiners", moves.joiners],
            ["Leavers", moves.leavers],
            ["Promotions", moves.promotions],
            ["Department transfers", moves.departmentTransfers],
            ["Company transfers", moves.companyTransfers],
            ["Manager changes", moves.managerChanges],
            ["Status changes", moves.statusChanges],
            ["Median tenure", report.tenure.medianYears === null ? "—" : `${report.tenure.medianYears} yrs`],
          ].map(([label, value]) => (
            <div key={label as string} className="flex justify-between gap-3">
              <dt className="text-fg-muted">{label}</dt>
              <dd className="tabular-nums font-medium text-fg">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </ReportShell>
  );
}
