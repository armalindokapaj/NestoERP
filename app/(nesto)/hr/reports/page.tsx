import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
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
import { employeeDocumentReport, hasCredentialReports, qualificationReport, type DocumentCategoryRow, type QualificationCoverageRow, type QualificationTitleRow } from "@/lib/modules/hr/credentials/credential.reports";
import { hrLabel } from "@/components/hr/hr-labels";
import { getTranslations } from "@/lib/i18n/server";
import { isDay } from "@/lib/modules/hr/employment/employment.dates";
import { getOrganizationReport } from "@/lib/modules/hr/employment/employment.report";
import type { HeadcountRowDTO } from "@/lib/modules/hr/employment/employment.types";
import * as reports from "@/lib/modules/hr/reports/reports.service";
import { formatDate, orDash } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("hr");
  return { title: t("meta.hrReports") };
}

/**
 * The built-in HR reports (PRD #16 §139, §140).
 *
 * Named reports, not a report builder. Each one needs the permission behind the
 * data it summarises as well as `hr.report.view`, so the tab strip is the list
 * of reports the reader can actually open — and the compensation report needs
 * the compensation permission on top (PRD #16 §141, §292).
 */
const REPORTS = [
  { key: "headcount" },
  { key: "leave" },
  { key: "attendance" },
  { key: "ending-soon" },
  { key: "compensation" },
  { key: "organization" },
  // What the people HR looks after hold, and what is on their files (E-02 §157).
  { key: "qualifications" },
  { key: "employee-documents" },
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
  const t = await getTranslations("hr");

  const allowed = reports.availableReports(context);
  const available = REPORTS.filter((entry) =>
    entry.key === "ending-soon"
      ? allowed.endingSoon
      : entry.key === "qualifications" || entry.key === "employee-documents"
        ? hasCredentialReports(context)
        : allowed[entry.key],
  );

  if (available.length === 0) {
    return (
      <ModulePage experience={experience} activeSection="reports">
        <EmptyState
          icon={<ChartColumn />}
          title={t("reports.emptyTitle")}
          description={t("reports.emptyDescription")}
        />
      </ModulePage>
    );
  }

  const active = (available.find((entry) => entry.key === requested)?.key ??
    available[0].key) as ReportKey;

  return (
    <ModulePage experience={experience} activeSection="reports">
      <div className="space-y-5">
        <nav aria-label={t("reports.nav")} className="border-b border-line">
          <ul className="-mb-px flex gap-1 overflow-x-auto">
            {available.map((entry) => (
              <li key={entry.key}>
                <Link
                  href={`/hr/reports?report=${entry.key}`}
                  aria-current={entry.key === active ? "page" : undefined}
                  className={cn(
                    "inline-flex h-10 items-center whitespace-nowrap border-b-2 px-3 text-table font-medium transition-colors touch:h-11",
                    entry.key === active
                      ? "border-accent text-fg"
                      : "border-transparent text-fg-muted hover:border-line-strong hover:text-fg",
                  )}
                >
                  {t(`reports.tabs.${entry.key}`)}
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
        {active === "qualifications" ? <QualificationsReport context={context} /> : null}
        {active === "employee-documents" ? <EmployeeDocumentsReport context={context} /> : null}
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
  const t = await getTranslations("hr");

  const columns: TableColumn<reports.HeadcountRow>[] = [
    {
      key: "department",
      label: t("columns.department"),
      primary: true,
      render: (row) => <span>{row.department}</span>,
    },
    {
      key: "active",
      label: hrLabel(t, "employmentStatus", "ACTIVE"),
      align: "right",
      render: (row) => <span className="tabular-nums">{row.active}</span>,
    },
    {
      key: "onLeave",
      label: hrLabel(t, "employmentStatus", "ON_LEAVE"),
      align: "right",
      render: (row) => <span className="tabular-nums text-fg-muted">{row.onLeave}</span>,
    },
    {
      key: "planned",
      label: hrLabel(t, "employmentStatus", "PLANNED"),
      align: "right",
      hideBelow: "md",
      render: (row) => <span className="tabular-nums text-fg-muted">{row.planned}</span>,
    },
    {
      key: "ended",
      label: hrLabel(t, "employmentStatus", "ENDED"),
      align: "right",
      hideBelow: "md",
      render: (row) => <span className="tabular-nums text-fg-muted">{row.ended}</span>,
    },
  ];

  return (
    <ReportShell
      title={t("overview.headcount")}
      description={t("reports.headcountDescription")}
    >
      {rows.length === 0 ? (
        <EmptyState icon={<ChartColumn />} title={t("reports.headcountEmpty")} />
      ) : (
        <DataTable
          caption={t("reports.headcountCaption")}
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
  const t = await getTranslations("hr");

  const columns: TableColumn<(typeof rows)[number]>[] = [
    {
      key: "leaveType",
      label: t("reports.leaveType"),
      primary: true,
      render: (row) => <span>{hrLabel(t, "leaveType", row.leaveType)}</span>,
    },
    {
      key: "requests",
      label: t("reports.requests"),
      align: "right",
      render: (row) => <span className="tabular-nums">{row.requests}</span>,
    },
    {
      key: "days",
      label: t("attendance.days"),
      align: "right",
      render: (row) => <span className="tabular-nums">{formatDays(row.days)}</span>,
    },
  ];

  return (
    <ReportShell
      title={t("reports.tabs.leave")}
      description={t("reports.leaveDescription")}
    >
      {rows.length === 0 ? (
        <EmptyState icon={<ChartColumn />} title={t("reports.leaveEmpty")} />
      ) : (
        <DataTable
          caption={t("reports.tabs.leave")}
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
  const t = await getTranslations("hr");

  const columns: TableColumn<(typeof rows)[number]>[] = [
    {
      key: "employee",
      label: t("columns.employee"),
      primary: true,
      render: (row) => <span className="min-w-0 truncate">{row.fullName}</span>,
    },
    {
      key: "present",
      label: hrLabel(t, "attendanceStatus", "PRESENT"),
      align: "right",
      render: (row) => <span className="tabular-nums">{row.present}</span>,
    },
    {
      key: "remote",
      label: hrLabel(t, "attendanceStatus", "REMOTE"),
      align: "right",
      hideBelow: "md",
      render: (row) => <span className="tabular-nums text-fg-muted">{row.remote}</span>,
    },
    {
      key: "onLeave",
      label: hrLabel(t, "employmentStatus", "ON_LEAVE"),
      align: "right",
      hideBelow: "md",
      render: (row) => <span className="tabular-nums text-fg-muted">{row.onLeave}</span>,
    },
    {
      key: "absent",
      label: hrLabel(t, "attendanceStatus", "ABSENT"),
      align: "right",
      render: (row) => <span className="tabular-nums text-fg-muted">{row.absent}</span>,
    },
    {
      key: "exceptions",
      label: t("attendance.exceptions"),
      align: "right",
      render: (row) => <span className="tabular-nums">{row.exceptions}</span>,
    },
  ];

  return (
    <ReportShell
      title={t("reports.tabs.attendance")}
      description={t("reports.attendanceDescription")}
    >
      {rows.length === 0 ? (
        <EmptyState icon={<ChartColumn />} title={t("reports.attendanceEmpty")} />
      ) : (
        <DataTable
          caption={t("reports.tabs.attendance")}
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
  const t = await getTranslations("hr");

  const columns: TableColumn<(typeof rows)[number]>[] = [
    {
      key: "employee",
      label: t("columns.employee"),
      primary: true,
      render: (row) => <span className="min-w-0 truncate">{row.fullName}</span>,
    },
    {
      key: "department",
      label: t("columns.department"),
      hideBelow: "md",
      render: (row) => <span className="text-fg-muted">{orDash(row.department)}</span>,
    },
    {
      key: "employmentType",
      label: t("columns.type"),
      hideBelow: "lg",
      render: (row) => (
        <span className="text-fg-muted">{hrLabel(t, "employmentType", row.employmentType)}</span>
      ),
    },
    {
      key: "endDate",
      label: t("progress.lastDay"),
      render: (row) => <span>{formatDate(row.endDate)}</span>,
    },
  ];

  return (
    <ReportShell
      title={t("overview.employmentEnding")}
      description={t("reports.endingDescription")}
    >
      {rows.length === 0 ? (
        <EmptyState icon={<ChartColumn />} title={t("reports.endingEmpty")} />
      ) : (
        <DataTable
          caption={t("overview.employmentEnding")}
          columns={columns}
          records={rows}
          rowKey={(row) => row.employeeId}
          rowHref={(row) => `/hr/employees/${row.employeeId}`}
        />
      )}
    </ReportShell>
  );
}

const count = (value: number, tone?: string) => <span className={cn("tabular-nums", value === 0 ? "text-fg-subtle" : tone)}>{value}</span>;

async function QualificationsReport({ context }: { context: UserContext }) {
  const report = await qualificationReport(context);
  const t = await getTranslations("hr");

  const coverage: TableColumn<QualificationCoverageRow>[] = [
    { key: "type", label: t("reports.qualification"), primary: true, render: (row) => <span>{row.label}</span> },
    { key: "holders", label: t("reports.peopleHolding"), align: "right", render: (row) => count(row.holders) },
    { key: "coverage", label: t("reports.coverage"), align: "right", render: (row) => <span className="tabular-nums text-fg-muted">{Math.round(row.coverage * 100)}%</span> },
    { key: "unverified", label: t("documents.worklist.verify"), align: "right", render: (row) => count(row.unverified, "text-info-strong") },
    { key: "expiring", label: t("documents.worklist.expiring"), align: "right", hideBelow: "md", render: (row) => count(row.expiring, "text-warning-strong") },
    { key: "expired", label: t("documents.worklist.expired"), align: "right", hideBelow: "md", render: (row) => count(row.expired, "text-danger-strong") },
  ];
  const titles: TableColumn<QualificationTitleRow>[] = [
    { key: "title", label: t("reports.qualification"), primary: true, render: (row) => <span>{row.title}</span> },
    { key: "type", label: t("reports.kind"), render: (row) => <span className="text-fg-muted">{row.typeLabel}</span> },
    { key: "holders", label: t("reports.people"), align: "right", render: (row) => count(row.holders) },
  ];

  return (
    <ReportShell
      title={t("reports.tabs.qualifications")}
      description={t("reports.qualificationsDescription", { count: report.people })}
    >
      {report.coverage.length === 0 ? (
        <EmptyState icon={<ChartColumn />} title={t("reports.qualificationsEmpty")} />
      ) : (
        <div className="space-y-5">
          <DataTable caption={t("reports.coverageCaption")} columns={coverage} records={report.coverage} rowKey={(row) => row.type} />
          {report.titles.length > 0 ? <DataTable caption={t("reports.mostHeld")} columns={titles} records={report.titles} rowKey={(row) => `${row.type}:${row.title}`} /> : null}
        </div>
      )}
    </ReportShell>
  );
}

async function EmployeeDocumentsReport({ context }: { context: UserContext }) {
  const rows = await employeeDocumentReport(context);
  const t = await getTranslations("hr");
  const columns: TableColumn<DocumentCategoryRow>[] = [
    { key: "category", label: t("columns.category"), primary: true, render: (row) => <span>{row.label}</span> },
    { key: "group", label: t("reports.group"), hideBelow: "md", render: (row) => <span className="text-fg-muted">{row.groupLabel}</span> },
    { key: "current", label: t("reports.onFile"), align: "right", render: (row) => count(row.current) },
    { key: "unverified", label: t("documents.worklist.verify"), align: "right", render: (row) => count(row.unverified, "text-info-strong") },
    { key: "expiring", label: t("documents.worklist.expiring"), align: "right", hideBelow: "md", render: (row) => count(row.expiring, "text-warning-strong") },
    { key: "expired", label: t("documents.worklist.expired"), align: "right", hideBelow: "md", render: (row) => count(row.expired, "text-danger-strong") },
  ];
  return (
    <ReportShell
      title={t("meta.employeeDocuments")}
      description={t("reports.documentsDescription")}
    >
      {rows.length === 0 ? (
        <EmptyState icon={<ChartColumn />} title={t("reports.documentsEmpty")} />
      ) : (
        <DataTable caption={t("reports.documentsCaption")} columns={columns} records={rows} rowKey={(row) => row.category} />
      )}
    </ReportShell>
  );
}

async function CompensationReport({ context }: { context: UserContext }) {
  const rows = await reports.compensationReport(context);
  const t = await getTranslations("hr");

  const columns: TableColumn<(typeof rows)[number]>[] = [
    {
      key: "employee",
      label: t("columns.employee"),
      primary: true,
      render: (row) => <span className="min-w-0 truncate">{row.fullName}</span>,
    },
    {
      key: "department",
      label: t("columns.department"),
      hideBelow: "md",
      render: (row) => <span className="text-fg-muted">{orDash(row.department)}</span>,
    },
    {
      key: "payType",
      label: t("compensation.payType"),
      hideBelow: "lg",
      render: (row) => <span className="text-fg-muted">{hrLabel(t, "payType", row.payType)}</span>,
    },
    {
      key: "baseAmount",
      label: t("compensation.amount"),
      align: "right",
      render: (row) => <Money amount={row.baseAmount} currency={row.currency} emphasis />,
    },
    {
      key: "effectiveFrom",
      label: t("reports.since"),
      hideBelow: "md",
      render: (row) => <span className="text-fg-muted">{formatDate(row.effectiveFrom)}</span>,
    },
  ];

  return (
    <ReportShell
      title={t("tabs.compensation")}
      description={t("reports.compensationDescription")}
    >
      {rows.length === 0 ? (
        <EmptyState icon={<ChartColumn />} title={t("reports.compensationEmpty")} />
      ) : (
        <DataTable
          caption={t("tabs.compensation")}
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
  const t = await getTranslations("hr");
  const years = (value: number | null) => (value === null ? "—" : t("reports.years", { years: value }));
  const breakdown = (title: string, rows: HeadcountRowDTO[], testId: string) => (
    <section className="nesto-card p-5" aria-label={title} data-testid={testId}>
      <h3 className="text-table font-semibold text-fg">{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-2 text-meta text-fg-subtle">{t("reports.nobody")}</p>
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
    <ReportShell title={t("reports.tabs.organization")} description={t("reports.organizationDescription", { asOf: formatDate(report.asOf), from: formatDate(report.period.from), to: formatDate(report.period.to) })}>
      {/* 44px controls under touch; the 16px phone font comes from globals.css (AUD-04 §3, D-07-13, MW-09). */}
      <form method="get" className="flex flex-wrap items-end gap-3" aria-label={t("reports.dates")}>
        <input type="hidden" name="report" value="organization" />
        <label className="space-y-1 text-meta text-fg-muted">
          <span className="block">{t("reports.asOf")}</span>
          <input type="date" name="asOf" defaultValue={report.asOf} className="h-9 rounded-md border border-line bg-surface px-2 text-table text-fg touch:h-11" />
        </label>
        <label className="space-y-1 text-meta text-fg-muted">
          <span className="block">{t("reports.changesFrom")}</span>
          <input type="date" name="from" defaultValue={report.period.from} className="h-9 rounded-md border border-line bg-surface px-2 text-table text-fg touch:h-11" />
        </label>
        <label className="space-y-1 text-meta text-fg-muted">
          <span className="block">{t("reports.to")}</span>
          <input type="date" name="to" defaultValue={report.period.to} className="h-9 rounded-md border border-line bg-surface px-2 text-table text-fg touch:h-11" />
        </label>
        <button type="submit" className="h-9 rounded-md border border-line-strong px-3 text-table font-medium text-fg hover:bg-hover touch:h-11 touch:min-w-11">
          {t("reports.show")}
        </button>
      </form>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="nesto-card p-4" data-testid="org-headcount">
          <p className="text-meta text-fg-subtle">{t("overview.headcount")}</p>
          <p className="text-2xl font-semibold tabular-nums text-fg">{report.headcount}</p>
        </div>
        <div className="nesto-card p-4">
          <p className="text-meta text-fg-subtle">{t("reports.joinersLeavers")}</p>
          <p className="text-2xl font-semibold tabular-nums text-fg">
            {moves.joiners} · {moves.leavers}
          </p>
        </div>
        <div className="nesto-card p-4">
          <p className="text-meta text-fg-subtle">{t("reports.promotionsTransfers")}</p>
          <p className="text-2xl font-semibold tabular-nums text-fg">
            {moves.promotions} · {moves.departmentTransfers + moves.companyTransfers}
          </p>
        </div>
        <div className="nesto-card p-4">
          <p className="text-meta text-fg-subtle">{t("reports.averageTenure")}</p>
          <p className="text-2xl font-semibold tabular-nums text-fg">{years(report.tenure.averageYears)}</p>
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {breakdown(t("reports.byCompany"), report.byCompany, "org-by-company")}
        {breakdown(t("reports.byDepartment"), report.byDepartment, "org-by-department")}
        {breakdown(t("reports.byTitle"), report.byTitle, "org-by-title")}
        {breakdown(t("reports.byStatus"), report.byStatus, "org-by-status")}
      </div>
      <section className="nesto-card p-5" aria-label={t("reports.movements")}>
        <h3 className="text-table font-semibold text-fg">{t("reports.movementsInPeriod")}</h3>
        <dl className="mt-2 grid gap-2 text-table sm:grid-cols-2 lg:grid-cols-4">
          {[
            [t("reports.joiners"), moves.joiners],
            [t("reports.leavers"), moves.leavers],
            [t("reports.promotions"), moves.promotions],
            [t("reports.departmentTransfers"), moves.departmentTransfers],
            [t("reports.companyTransfers"), moves.companyTransfers],
            [t("reports.managerChanges"), moves.managerChanges],
            [t("reports.statusChanges"), moves.statusChanges],
            [t("reports.medianTenure"), years(report.tenure.medianYears)],
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
