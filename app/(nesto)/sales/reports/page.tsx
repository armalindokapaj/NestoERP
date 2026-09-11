import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChartColumn } from "lucide-react";

import { DataTable, type TableColumn } from "@/components/data/data-table";
import { ModulePage } from "@/components/modules/module-page";
import { StatusBadge } from "@/components/modules/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import type { UserContext } from "@/lib/context/types";
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
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = { title: "Sales reports" };

/**
 * The built-in sales reports (PRD #17 §161).
 *
 * Named reports, not a report builder. Each one needs the permission behind the
 * data it summarises as well as `sales.report.view`, so the tab strip is the
 * list of reports the reader can actually open (PRD #17 §339).
 *
 * Every monetary figure is grouped by currency and never summed across them:
 * V0.1 has no FX engine (PRD #17 §172).
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
  searchParams: Promise<{ report?: string }>;
}) {
  const context = await requireModule("sales");
  if (!can(context, "sales.report.view")) redirect("/access-denied");

  const experience = resolveModuleExperience(context, "sales");
  const { report: requested } = await searchParams;

  const available = REPORTS.filter((entry) => {
    if (entry.needs === "opportunity") return can(context, "sales.opportunity.view");
    if (entry.needs === "lead") return can(context, "sales.lead.view");
    return can(context, "sales.proposal.view");
  });

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

  const period = reports.defaultPeriod();

  return (
    <ModulePage experience={experience} activeSection="reports">
      <div className="space-y-5">
        <nav aria-label="Reports" className="border-b border-line">
          <ul className="-mb-px flex gap-1 overflow-x-auto">
            {available.map((entry) => (
              <li key={entry.key}>
                <Link
                  href={`/sales/reports?report=${entry.key}`}
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

        {active === "pipeline" ? <PipelineReport context={context} /> : null}
        {active === "expected-close" ? <ExpectedCloseReport context={context} /> : null}
        {active === "win-loss" ? <WinLossReport context={context} period={period} /> : null}
        {active === "by-owner" ? <OwnerReport context={context} period={period} /> : null}
        {active === "lost-reasons" ? <LostReasons context={context} period={period} /> : null}
        {active === "lead-conversion" ? <LeadConversion context={context} period={period} /> : null}
        {active === "proposals" ? <Proposals context={context} period={period} /> : null}
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

async function PipelineReport({ context }: { context: UserContext }) {
  const rows = await reports.pipelineByStage(context);

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<ChartColumn />}
        title="No open opportunities."
        description="The pipeline report reads the deals still in play."
      />
    );
  }

  const columns: TableColumn<(typeof rows)[number]>[] = [
    {
      key: "stage",
      label: "Stage",
      primary: true,
      render: (row) => <StatusBadge status={row.stage} />,
    },
    {
      key: "count",
      label: "Deals",
      align: "right",
      render: (row) => (
        <span className="tabular-nums">
          {row.totals.reduce((sum, total) => sum + total.count, 0)}
        </span>
      ),
    },
    { key: "value", label: "Value", align: "right", render: (row) => <Totals totals={row.totals} /> },
    {
      key: "weighted",
      label: "Weighted",
      align: "right",
      render: (row) => (
        <span className="tabular-nums text-fg-muted">{weightedTotalsLabel(row.totals)}</span>
      ),
    },
  ];

  return (
    <ReportShell
      title="Pipeline by stage"
      description={`Open opportunities grouped by stage. ${opportunityStageLabels.PROPOSAL} carries its stage probability unless a deal overrides it.`}
    >
      <DataTable columns={columns} records={rows} rowKey={(row) => row.stage} />
    </ReportShell>
  );
}

async function ExpectedCloseReport({ context }: { context: UserContext }) {
  const buckets = await reports.expectedCloseReport(context);

  if (buckets.length === 0) {
    return (
      <EmptyState
        icon={<ChartColumn />}
        title="No open opportunities."
        description="Deals with an expected close date appear here."
      />
    );
  }

  const columns: TableColumn<(typeof buckets)[number]>[] = [
    { key: "label", label: "When", primary: true, render: (row) => row.label },
    {
      key: "count",
      label: "Deals",
      align: "right",
      render: (row) => (
        <span className="tabular-nums">
          {row.totals.reduce((sum, total) => sum + total.count, 0)}
        </span>
      ),
    },
    { key: "value", label: "Value", align: "right", render: (row) => <Totals totals={row.totals} /> },
    {
      key: "weighted",
      label: "Weighted",
      align: "right",
      render: (row) => (
        <span className="tabular-nums text-fg-muted">{weightedTotalsLabel(row.totals)}</span>
      ),
    },
  ];

  return (
    <ReportShell
      title="Expected close"
      description="Open deals grouped by when they are due to close. Overdue means the date has passed and the deal is still open."
    >
      <DataTable columns={columns} records={buckets} rowKey={(row) => row.key} />
    </ReportShell>
  );
}

async function WinLossReport({
  context,
  period,
}: {
  context: UserContext;
  period: reports.ReportPeriod;
}) {
  const report = await reports.winLossReport(context, period);

  return (
    <ReportShell
      title="Win / loss"
      description="Deals decided this year, by their actual close date. Open deals are excluded — an unfinished deal is not a loss."
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Card label="Won" value={totalsLabel(report.won)} hint={`${report.wonCount} deals`} />
        <Card label="Lost" value={totalsLabel(report.lost)} hint={`${report.lostCount} deals`} />
        <Card
          label="Win rate"
          value={report.winRate === null ? "—" : `${report.winRate}%`}
          hint={report.winRate === null ? "Nothing closed yet" : "Of decided deals"}
        />
      </div>
    </ReportShell>
  );
}

async function OwnerReport({
  context,
  period,
}: {
  context: UserContext;
  period: reports.ReportPeriod;
}) {
  const rows = await reports.ownerReport(context, period);

  if (rows.length === 0) {
    return (
      <EmptyState icon={<ChartColumn />} title="Nothing to report." description="No deals in view." />
    );
  }

  const columns: TableColumn<OwnerPerformanceRow>[] = [
    {
      key: "owner",
      label: "Owner",
      primary: true,
      render: (row) => (
        <span className={row.owner.active ? undefined : "text-fg-subtle"}>
          {row.owner.fullName}
          {row.owner.active ? "" : " (inactive)"}
        </span>
      ),
    },
    { key: "currency", label: "Currency", render: (row) => row.currency },
    {
      key: "open",
      label: "Open pipeline",
      align: "right",
      render: (row) => <span className="tabular-nums">{row.openValue}</span>,
    },
    {
      key: "weighted",
      label: "Weighted",
      align: "right",
      hideBelow: "lg",
      render: (row) => <span className="tabular-nums text-fg-muted">{row.weightedValue}</span>,
    },
    {
      key: "won",
      label: "Won",
      align: "right",
      render: (row) => <span className="tabular-nums">{row.wonValue}</span>,
    },
    {
      key: "lost",
      label: "Lost",
      align: "right",
      hideBelow: "lg",
      render: (row) => <span className="tabular-nums">{row.lostValue}</span>,
    },
    {
      key: "rate",
      label: "Win rate",
      align: "right",
      render: (row) => (
        <span className="tabular-nums">{row.winRate === null ? "—" : `${row.winRate}%`}</span>
      ),
    },
  ];

  return (
    <ReportShell
      title="Sales by owner"
      description="Pipeline and outcomes per person, split by currency so nothing is added across them."
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
}: {
  context: UserContext;
  period: reports.ReportPeriod;
}) {
  const rows = await reports.lostReasonReport(context, period);

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<ChartColumn />}
        title="Nothing lost this year."
        description="Reasons appear here as deals are closed out."
      />
    );
  }

  const columns: TableColumn<LostReasonRow>[] = [
    {
      key: "reason",
      label: "Reason",
      primary: true,
      render: (row) => lostReasonLabels[row.reason],
    },
    { key: "currency", label: "Currency", render: (row) => row.currency },
    {
      key: "count",
      label: "Deals",
      align: "right",
      render: (row) => <span className="tabular-nums">{row.count}</span>,
    },
    {
      key: "value",
      label: "Value",
      align: "right",
      render: (row) => <span className="tabular-nums">{row.value}</span>,
    },
  ];

  return (
    <ReportShell
      title="Lost reasons"
      description="Why deals did not close this year, by their actual close date."
    >
      <DataTable columns={columns} records={rows} rowKey={(row) => `${row.reason}-${row.currency}`} />
    </ReportShell>
  );
}

async function LeadConversion({
  context,
  period,
}: {
  context: UserContext;
  period: reports.ReportPeriod;
}) {
  const report = await reports.leadConversionReport(context, period);

  return (
    <ReportShell
      title="Lead conversion"
      description="Leads created this year, and how many became opportunities. The rate is converted ÷ created — a deliberately simple denominator, stated so nobody has to guess it."
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Card label="Created" value={String(report.totalCreated)} />
        <Card label="Converted" value={String(report.converted)} />
        <Card label="Qualified" value={String(report.qualified)} hint="Not yet converted" />
        <Card label="Disqualified" value={String(report.disqualified)} />
        <Card
          label="Conversion rate"
          value={report.conversionRate === null ? "—" : `${report.conversionRate}%`}
          hint="Converted ÷ created"
        />
      </div>
    </ReportShell>
  );
}

async function Proposals({
  context,
  period,
}: {
  context: UserContext;
  period: reports.ReportPeriod;
}) {
  const rows = await reports.proposalReport(context, period);

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<ChartColumn />}
        title="No proposals this year."
        description="Proposals raised in the period appear here."
      />
    );
  }

  const columns: TableColumn<ProposalReportRow>[] = [
    { key: "currency", label: "Currency", primary: true, render: (row) => row.currency },
    {
      key: "draft",
      label: proposalStatusLabels.DRAFT,
      align: "right",
      render: (row) => <span className="tabular-nums">{row.counts.DRAFT}</span>,
    },
    {
      key: "pending",
      label: proposalStatusLabels.PENDING_APPROVAL,
      align: "right",
      hideBelow: "lg",
      render: (row) => <span className="tabular-nums">{row.counts.PENDING_APPROVAL}</span>,
    },
    {
      key: "sent",
      label: proposalStatusLabels.SENT,
      align: "right",
      render: (row) => <span className="tabular-nums">{row.counts.SENT}</span>,
    },
    {
      key: "accepted",
      label: proposalStatusLabels.ACCEPTED,
      align: "right",
      render: (row) => <span className="tabular-nums">{row.counts.ACCEPTED}</span>,
    },
    {
      key: "declined",
      label: proposalStatusLabels.DECLINED,
      align: "right",
      hideBelow: "lg",
      render: (row) => <span className="tabular-nums">{row.counts.DECLINED}</span>,
    },
    {
      key: "acceptedValue",
      label: "Accepted value",
      align: "right",
      render: (row) => <span className="tabular-nums">{row.acceptedValue}</span>,
    },
    {
      key: "rate",
      label: "Acceptance",
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
      title="Proposals"
      description="Proposals raised this year, by currency. Acceptance is accepted ÷ (accepted + declined) — only proposals the client actually decided."
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
