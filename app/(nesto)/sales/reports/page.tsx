import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import Link from "@/components/navigation/nav-link";
import { redirect } from "next/navigation";
import { ChartColumn } from "lucide-react";

import { DataTable, type TableColumn } from "@/components/data/data-table";
import { ModulePage } from "@/components/modules/module-page";
import { StatusBadge } from "@/components/modules/status-badge";
import { PersonLink } from "@/components/people/person-link";
import { GroupSalesScope } from "@/components/sales/group-scope";
import { EmptyState } from "@/components/ui/empty-state";
import { CompanyTag } from "@/components/workspace/company-tag";
import { inGroupWorkspace } from "@/config/workspace";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import type { UserContext } from "@/lib/context/types";
import { resolveWorkspaceContexts } from "@/lib/context/workspace-access";
import { firstValue } from "@/lib/modules/shared/list-query";
import { groupCompanies, includedCompanies, resolveSalesExperience } from "@/lib/modules/sales/sales.workspace";
import { opportunityStageLabels } from "@/lib/modules/sales/opportunities/opportunity.stage";
import { lostReasonLabels, proposalStatusLabels } from "@/lib/modules/sales/proposals/proposal.status";
import * as reports from "@/lib/modules/sales/reports/reports.service";
import type {
  CurrencyTotal,
  LostReasonRow,
  OwnerPerformanceRow,
  ProposalReportRow,
} from "@/lib/modules/sales/sales.types";
import { totalsLabel, weightedTotalsLabel } from "@/components/sales/sales-format";
import { salesLabel } from "@/lib/i18n/modules/sales/labels";
import { cn } from "@/lib/utils/cn";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("sales");
  return { title: t("meta.salesReports") };
}

/**
 * The built-in sales reports (PRD #17 §161).
 *
 * Named reports, not a report builder. Each one needs the permission behind the
 * data it summarises as well as `sales.report.view`, so the tab strip is the
 * list of reports the reader can actually open (PRD #17 §339).
 *
 * Every monetary figure is grouped by currency and never summed across them:
 * V0.1 has no FX engine (PRD #17 §172).
 *
 * Reports consume the active workspace (Workspace Context §41): a company's
 * own, or in the Group workspace the aggregate of every company the reader may
 * read the report in — the companies included are named above it, and the
 * by-owner report names each owner's company (§45).
 */
const REPORTS = [
  { key: "pipeline", label: "Pipeline by stage", needs: "opportunity" },
  { key: "expected-close", label: "Expected close", needs: "opportunity" },
  { key: "win-loss", label: "Win / loss", needs: "opportunity" },
  { key: "by-owner", label: "By owner", needs: "opportunity" },
  { key: "lost-reasons", label: "Lost reasons", needs: "opportunity" },
  { key: "lead-conversion", label: "Lead conversion", needs: "lead" },
  { key: "proposals", label: "Proposals", needs: "proposal" },
] as const;

type ReportKey = (typeof REPORTS)[number]["key"];

export default async function SalesReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ report?: string; company?: string }>;
}) {
  const context = await requireModule("sales");
  const t = await getTranslations("sales");
  const grouped = inGroupWorkspace(context);
  if (!grouped && !can(context, "sales.report.view")) redirect("/access-denied");

  const experience = await resolveSalesExperience(context);
  const { report: requested, company: requestedCompany } = await searchParams;
  const company = grouped ? firstValue(requestedCompany) : undefined;

  // Which reports are offered is what the reader may open: in the group, what
  // they may open in at least one company that lets them read reports.
  const readers = grouped
    ? await resolveWorkspaceContexts(context, { module: "sales", permission: "sales.report.view" })
    : [context];
  const holds = (permission: "sales.opportunity.view" | "sales.lead.view" | "sales.proposal.view") =>
    readers.some((reader) => can(reader, permission));
  const available = REPORTS.filter((entry) => {
    if (entry.needs === "opportunity") return holds("sales.opportunity.view");
    if (entry.needs === "lead") return holds("sales.lead.view");
    return holds("sales.proposal.view");
  });

  if (available.length === 0) {
    return (
      <ModulePage experience={experience} activeSection="reports">
        {grouped ? (
          <EmptyState
            icon={<ChartColumn />}
            title={t("lists.noAccessTitle")}
            description={t("reports.noAccessDescription")}
          />
        ) : (
          <EmptyState
            icon={<ChartColumn />}
            title={t("reports.noReportsTitle")}
            description={t("reports.noReportsDescription")}
          />
        )}
      </ModulePage>
    );
  }

  const active = (available.find((entry) => entry.key === requested)?.key ??
    available[0].key) as ReportKey;

  const period = reports.defaultPeriod();
  const companies = grouped ? await groupCompanies(context, "sales.report.view") : [];

  return (
    <ModulePage experience={experience} activeSection="reports">
      <div className="space-y-5">
        {grouped ? <GroupSalesScope companies={companies} included={includedCompanies(companies, company)} /> : null}

        <nav aria-label={t("reports.nav")} className="border-b border-line">
          <ul className="-mb-px flex gap-1 overflow-x-auto">
            {available.map((entry) => (
              <li key={entry.key}>
                <Link
                  href={`/sales/reports?report=${entry.key}${company ? `&company=${encodeURIComponent(company)}` : ""}`}
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

        {active === "pipeline" ? <PipelineReport context={context} company={company} /> : null}
        {active === "expected-close" ? <ExpectedCloseReport context={context} company={company} /> : null}
        {active === "win-loss" ? <WinLossReport context={context} period={period} company={company} /> : null}
        {active === "by-owner" ? <OwnerReport context={context} period={period} company={company} /> : null}
        {active === "lost-reasons" ? <LostReasons context={context} period={period} company={company} /> : null}
        {active === "lead-conversion" ? <LeadConversion context={context} period={period} company={company} /> : null}
        {active === "proposals" ? <Proposals context={context} period={period} company={company} /> : null}
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

function Totals({ totals }: { totals: CurrencyTotal[] }) {
  return <span className="tabular-nums">{totalsLabel(totals)}</span>;
}

async function PipelineReport({ context, company }: { context: UserContext; company?: string }) {
  const t = await getTranslations("sales");
  const rows = await reports.pipelineByStageForWorkspace(context, company);

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<ChartColumn />}
        title={t("reports.noOpen")}
        description={t("reports.noOpenPipeline")}
      />
    );
  }

  const columns: TableColumn<(typeof rows)[number]>[] = [
    {
      key: "stage",
      label: t("reports.stage"),
      primary: true,
      render: (row) => <StatusBadge status={row.stage} />,
    },
    {
      key: "count",
      label: t("reports.deals"),
      align: "right",
      render: (row) => (
        <span className="tabular-nums">
          {row.totals.reduce((sum, total) => sum + total.count, 0)}
        </span>
      ),
    },
    { key: "value", label: t("reports.value"), align: "right", render: (row) => <Totals totals={row.totals} /> },
    {
      key: "weighted",
      label: t("reports.weighted"),
      align: "right",
      render: (row) => (
        <span className="tabular-nums text-fg-muted">{weightedTotalsLabel(row.totals)}</span>
      ),
    },
  ];

  return (
    <ReportShell
      title={t("reports.tabs.pipeline")}
      description={t("reports.pipelineDescription", { stage: salesLabel(t, "stage", "PROPOSAL", opportunityStageLabels.PROPOSAL) })}
    >
      <DataTable columns={columns} records={rows} rowKey={(row) => row.stage} />
    </ReportShell>
  );
}

async function ExpectedCloseReport({ context, company }: { context: UserContext; company?: string }) {
  const t = await getTranslations("sales");
  const buckets = await reports.expectedCloseReportForWorkspace(context, company);

  if (buckets.length === 0) {
    return (
      <EmptyState
        icon={<ChartColumn />}
        title={t("reports.noOpen")}
        description={t("reports.noOpenExpected")}
      />
    );
  }

  const columns: TableColumn<(typeof buckets)[number]>[] = [
    { key: "label", label: t("reports.when"), primary: true, render: (row) => row.label },
    {
      key: "count",
      label: t("reports.deals"),
      align: "right",
      render: (row) => (
        <span className="tabular-nums">
          {row.totals.reduce((sum, total) => sum + total.count, 0)}
        </span>
      ),
    },
    { key: "value", label: t("reports.value"), align: "right", render: (row) => <Totals totals={row.totals} /> },
    {
      key: "weighted",
      label: t("reports.weighted"),
      align: "right",
      render: (row) => (
        <span className="tabular-nums text-fg-muted">{weightedTotalsLabel(row.totals)}</span>
      ),
    },
  ];

  return (
    <ReportShell
      title={t("reports.tabs.expected-close")}
      description={t("reports.expectedCloseDescription")}
    >
      <DataTable columns={columns} records={buckets} rowKey={(row) => row.key} />
    </ReportShell>
  );
}

async function WinLossReport({
  context,
  period,
  company,
}: {
  context: UserContext;
  period: reports.ReportPeriod;
  company?: string;
}) {
  const t = await getTranslations("sales");
  const report = await reports.winLossReportForWorkspace(context, period, company);

  return (
    <ReportShell
      title={t("reports.tabs.win-loss")}
      description={t("reports.winLossDescription")}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Card label={t("reports.won")} value={totalsLabel(report.won)} hint={t("reports.dealsCount", { count: report.wonCount })} />
        <Card label={t("reports.lost")} value={totalsLabel(report.lost)} hint={t("reports.dealsCount", { count: report.lostCount })} />
        <Card
          label={t("reports.winRate")}
          value={report.winRate === null ? "—" : `${report.winRate}%`}
          hint={report.winRate === null ? t("reports.nothingClosed") : t("reports.ofDecided")}
        />
      </div>
    </ReportShell>
  );
}

async function OwnerReport({
  context,
  period,
  company,
}: {
  context: UserContext;
  period: reports.ReportPeriod;
  company?: string;
}) {
  const t = await getTranslations("sales");
  const rows = await reports.ownerReportForWorkspace(context, period, company);

  if (rows.length === 0) {
    return (
      <EmptyState icon={<ChartColumn />} title={t("reports.nothingTitle")} description={t("reports.nothingDescription")} />
    );
  }

  const columns: TableColumn<OwnerPerformanceRow>[] = [
    {
      key: "owner",
      label: t("reports.owner"),
      primary: true,
      render: (row) => (
        <span className={row.owner.active ? undefined : "text-fg-subtle"}>
          <PersonLink memberId={row.owner.memberId} name={row.owner.fullName} />
          {row.owner.active ? "" : t("reports.inactive")}
        </span>
      ),
    },
    // Group workspace only: an owner is a membership, one per company (§45).
    ...(rows.some((row) => row.company)
      ? [
          {
            key: "company",
            label: t("reports.company"),
            render: (row: OwnerPerformanceRow) => (row.company ? <CompanyTag name={row.company.name} /> : null),
          },
        ]
      : []),
    { key: "currency", label: t("reports.currency"), render: (row) => row.currency },
    {
      key: "open",
      label: t("reports.openPipeline"),
      align: "right",
      render: (row) => <span className="tabular-nums">{row.openValue}</span>,
    },
    {
      key: "weighted",
      label: t("reports.weighted"),
      align: "right",
      hideBelow: "lg",
      render: (row) => <span className="tabular-nums text-fg-muted">{row.weightedValue}</span>,
    },
    {
      key: "won",
      label: t("reports.won"),
      align: "right",
      render: (row) => <span className="tabular-nums">{row.wonValue}</span>,
    },
    {
      key: "lost",
      label: t("reports.lost"),
      align: "right",
      hideBelow: "lg",
      render: (row) => <span className="tabular-nums">{row.lostValue}</span>,
    },
    {
      key: "rate",
      label: t("reports.winRate"),
      align: "right",
      render: (row) => (
        <span className="tabular-nums">{row.winRate === null ? "—" : `${row.winRate}%`}</span>
      ),
    },
  ];

  return (
    <ReportShell
      title={t("reports.byOwnerTitle")}
      description={t("reports.byOwnerDescription")}
    >
      <DataTable
        columns={columns}
        records={rows}
        rowKey={(row) => `${row.owner.memberId}-${row.currency}`}
      />
    </ReportShell>
  );
}

async function LostReasons({
  context,
  period,
  company,
}: {
  context: UserContext;
  period: reports.ReportPeriod;
  company?: string;
}) {
  const t = await getTranslations("sales");
  const rows = await reports.lostReasonReportForWorkspace(context, period, company);

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<ChartColumn />}
        title={t("reports.nothingLost")}
        description={t("reports.nothingLostDescription")}
      />
    );
  }

  const columns: TableColumn<LostReasonRow>[] = [
    {
      key: "reason",
      label: t("reports.reason"),
      primary: true,
      render: (row) => salesLabel(t, "lostReason", row.reason, lostReasonLabels[row.reason]),
    },
    { key: "currency", label: t("reports.currency"), render: (row) => row.currency },
    {
      key: "count",
      label: t("reports.deals"),
      align: "right",
      render: (row) => <span className="tabular-nums">{row.count}</span>,
    },
    {
      key: "value",
      label: t("reports.value"),
      align: "right",
      render: (row) => <span className="tabular-nums">{row.value}</span>,
    },
  ];

  return (
    <ReportShell
      title={t("reports.tabs.lost-reasons")}
      description={t("reports.lostReasonsDescription")}
    >
      <DataTable columns={columns} records={rows} rowKey={(row) => `${row.reason}-${row.currency}`} />
    </ReportShell>
  );
}

async function LeadConversion({
  context,
  period,
  company,
}: {
  context: UserContext;
  period: reports.ReportPeriod;
  company?: string;
}) {
  const t = await getTranslations("sales");
  const report = await reports.leadConversionReportForWorkspace(context, period, company);

  return (
    <ReportShell
      title={t("reports.tabs.lead-conversion")}
      description={t("reports.leadConversionDescription")}
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Card label={t("reports.created")} value={String(report.totalCreated)} />
        <Card label={t("reports.converted")} value={String(report.converted)} />
        <Card label={t("reports.qualified")} value={String(report.qualified)} hint={t("reports.notYetConverted")} />
        <Card label={t("reports.disqualified")} value={String(report.disqualified)} />
        <Card
          label={t("reports.conversionRate")}
          value={report.conversionRate === null ? "—" : `${report.conversionRate}%`}
          hint={t("reports.convertedOverCreated")}
        />
      </div>
    </ReportShell>
  );
}

async function Proposals({
  context,
  period,
  company,
}: {
  context: UserContext;
  period: reports.ReportPeriod;
  company?: string;
}) {
  const t = await getTranslations("sales");
  const rows = await reports.proposalReportForWorkspace(context, period, company);

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<ChartColumn />}
        title={t("reports.noProposals")}
        description={t("reports.noProposalsDescription")}
      />
    );
  }

  const columns: TableColumn<ProposalReportRow>[] = [
    { key: "currency", label: t("reports.currency"), primary: true, render: (row) => row.currency },
    {
      key: "draft",
      label: salesLabel(t, "proposalStatus", "DRAFT", proposalStatusLabels.DRAFT),
      align: "right",
      render: (row) => <span className="tabular-nums">{row.counts.DRAFT}</span>,
    },
    {
      key: "pending",
      label: salesLabel(t, "proposalStatus", "PENDING_APPROVAL", proposalStatusLabels.PENDING_APPROVAL),
      align: "right",
      hideBelow: "lg",
      render: (row) => <span className="tabular-nums">{row.counts.PENDING_APPROVAL}</span>,
    },
    {
      key: "sent",
      label: salesLabel(t, "proposalStatus", "SENT", proposalStatusLabels.SENT),
      align: "right",
      render: (row) => <span className="tabular-nums">{row.counts.SENT}</span>,
    },
    {
      key: "accepted",
      label: salesLabel(t, "proposalStatus", "ACCEPTED", proposalStatusLabels.ACCEPTED),
      align: "right",
      render: (row) => <span className="tabular-nums">{row.counts.ACCEPTED}</span>,
    },
    {
      key: "declined",
      label: salesLabel(t, "proposalStatus", "DECLINED", proposalStatusLabels.DECLINED),
      align: "right",
      hideBelow: "lg",
      render: (row) => <span className="tabular-nums">{row.counts.DECLINED}</span>,
    },
    {
      key: "acceptedValue",
      label: t("reports.acceptedValue"),
      align: "right",
      render: (row) => <span className="tabular-nums">{row.acceptedValue}</span>,
    },
    {
      key: "rate",
      label: t("reports.acceptance"),
      align: "right",
      render: (row) => (
        <span className="tabular-nums">
          {row.acceptanceRate === null ? "—" : `${row.acceptanceRate}%`}
        </span>
      ),
    },
  ];

  return (
    <ReportShell
      title={t("reports.tabs.proposals")}
      description={t("reports.proposalsDescription")}
    >
      <DataTable columns={columns} records={rows} rowKey={(row) => row.currency} />
    </ReportShell>
  );
}

function Card({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="nesto-card p-4">
      <p className="text-table text-fg-muted">{label}</p>
      <p className="mt-2 text-card font-semibold tabular-nums text-fg">{value}</p>
      {hint ? <p className="mt-1 text-meta text-fg-subtle">{hint}</p> : null}
    </div>
  );
}
