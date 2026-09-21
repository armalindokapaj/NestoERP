import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Handshake } from "lucide-react";

import { ModulePage } from "@/components/modules/module-page";
import { GroupSalesScope } from "@/components/sales/group-scope";
import { SalesKpiGrid } from "@/components/sales/sales-kpis";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { CompanyRecordLink } from "@/components/workspace/company-record-link";
import { CompanyTag } from "@/components/workspace/company-tag";
import { isGroupRoute, inGroupWorkspace } from "@/config/workspace";
import { can } from "@/lib/access/can";
import { firstValue } from "@/lib/modules/shared/list-query";
import { requireModule } from "@/lib/context/current-user";
import { attentionListForWorkspace, getSalesOverviewForWorkspace } from "@/lib/modules/sales/overview/overview.service";
import { groupCompanies, includedCompanies, resolveSalesExperience } from "@/lib/modules/sales/sales.workspace";
import { formatAmount } from "@/components/sales/sales-format";
import { formatDate } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Sales" };

/**
 * The Sales overview (PRD #17 §21–§24).
 *
 * The module's own dashboard, not the personal one at /dashboard. Every panel
 * is gated by its own permission, so somebody granted commercial value alone
 * sees won figures rather than a sales dashboard with holes in it
 * (PRD #17 §24).
 *
 * In the Group workspace it is the same overview over every company the reader
 * may read Sales in (Workspace Context §37): money per currency, every row
 * naming its company, and nothing to create — a new record is one company's.
 */
export default async function SalesOverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule("sales");
  const grouped = inGroupWorkspace(context);
  const experience = await resolveSalesExperience(context);
  const companyParam = grouped ? firstValue((await searchParams).company) : undefined;

  const [overview, attention, companies] = await Promise.all([
    getSalesOverviewForWorkspace(context, companyParam),
    attentionListForWorkspace(context, companyParam),
    grouped ? groupCompanies(context, "sales.view") : Promise.resolve([]),
  ]);

  const nothingVisible =
    !overview.visible.leads && !overview.visible.opportunities && !overview.visible.proposals;

  return (
    <ModulePage
      experience={experience}
      activeSection="overview"
      actions={
        <div className="flex items-center gap-2">
          {!grouped && can(context, "sales.lead.create") ? (
            <Button asChild variant="secondary" size="sm">
              <Link href="/sales/leads/new">New lead</Link>
            </Button>
          ) : null}
          {!grouped && can(context, "sales.opportunity.create") ? (
            <Button asChild size="sm">
              <Link href="/sales/opportunities/new">New opportunity</Link>
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="space-y-5">
        {grouped ? <GroupSalesScope companies={companies} included={includedCompanies(companies, companyParam)} /> : null}

        <SalesKpiGrid overview={overview} grouped={grouped} />

        {nothingVisible ? (
          grouped ? (
            <EmptyState
              icon={<Handshake />}
              title="No accessible data for this module."
              description="None of the companies you can open holds Sales records you may read."
            />
          ) : (
            <EmptyState
              icon={<Handshake />}
              title="Nothing in your Sales view."
              description="Your access covers commercial summaries rather than the pipeline itself."
            />
          )
        ) : null}

        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {overview.visible.opportunities ? (
            <AttentionPanel
              title="Expected close overdue"
              href="/sales/reports?report=expected-close"
              emptyLabel="Nothing has run past its close date."
              grouped={grouped}
              rows={attention.overdueClose.map((row) => ({
                id: row.id,
                company: row.company,
                href: `/sales/opportunities/${row.id}`,
                primary: row.name,
                secondary: row.client?.name ?? "No client yet",
                meta: row.expectedCloseDate ? formatDate(row.expectedCloseDate) : "—",
              }))}
            />
          ) : null}

          {overview.visible.opportunities ? (
            <AttentionPanel
              title="No next step"
              href="/sales/opportunities"
              emptyLabel="Every open deal has a next step."
              grouped={grouped}
              rows={attention.noNextStep.map((row) => ({
                id: row.id,
                company: row.company,
                href: `/sales/opportunities/${row.id}`,
                primary: row.name,
                secondary: row.owner.fullName,
                meta: formatAmount(row.estimatedValue, row.currency),
              }))}
            />
          ) : null}

          {overview.visible.leads ? (
            <AttentionPanel
              title="Qualified, not converted"
              href="/sales/leads?status=QUALIFIED"
              emptyLabel="No qualified leads are waiting."
              grouped={grouped}
              rows={attention.qualifiedLeads.map((row) => ({
                id: row.id,
                company: row.company,
                href: `/sales/leads/${row.id}`,
                primary: row.name,
                secondary: row.companyName ?? "Individual",
                meta:
                  row.estimatedValue && row.currency
                    ? formatAmount(row.estimatedValue, row.currency)
                    : "—",
              }))}
            />
          ) : null}

          {overview.visible.proposals ? (
            <AttentionPanel
              title="Proposals expiring"
              href="/sales/proposals?status=SENT"
              emptyLabel="No sent proposal expires in the next week."
              grouped={grouped}
              rows={attention.expiringProposals.map((row) => ({
                id: row.id,
                company: row.company,
                href: `/sales/proposals/${row.id}`,
                primary: row.proposalNumber,
                secondary: row.client.name,
                meta: row.validUntil ? formatDate(row.validUntil) : "—",
              }))}
            />
          ) : null}

          {overview.visible.opportunities && attention.inactiveOwners.length > 0 ? (
            <AttentionPanel
              title="Owner has left"
              href="/sales/opportunities"
              emptyLabel="Every open deal has an active owner."
              grouped={grouped}
              rows={attention.inactiveOwners.map((row) => ({
                id: row.id,
                company: row.company,
                href: `/sales/opportunities/${row.id}`,
                primary: row.name,
                secondary: `${row.owner.fullName} is no longer active`,
                meta: formatAmount(row.estimatedValue, row.currency),
              }))}
            />
          ) : null}
        </div>
      </div>
    </ModulePage>
  );
}

type AttentionRow = {
  id: string;
  /** Group workspace only: the row's company, which its link enters first (Workspace Context §31, §45). */
  company?: { id: string; name: string };
  href: string;
  primary: string;
  secondary: string;
  meta: string;
};

function AttentionPanel({
  title,
  href,
  rows,
  emptyLabel,
  grouped = false,
}: {
  title: string;
  href: string;
  rows: AttentionRow[];
  emptyLabel: string;
  grouped?: boolean;
}) {
  // "All" leads to the full list; one the group does not answer would only ask
  // which company, so it is not offered there (Workspace Context §29).
  const showAll = !grouped || isGroupRoute("sales", href.split("?")[0]);

  return (
    <section className="nesto-card p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-card font-semibold text-fg">{title}</h2>
        {showAll ? (
          <Link
            href={href}
            className="inline-flex items-center gap-1 text-table font-medium text-accent-strong"
          >
            All
            <ArrowRight aria-hidden="true" className="size-3.5" />
          </Link>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <p className="mt-4 text-table text-fg-subtle">{emptyLabel}</p>
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0">
              {grouped && row.company ? (
                <div className="min-w-0">
                  <CompanyTag name={row.company.name} className="mb-1" />
                  <CompanyRecordLink companyId={row.company.id} companyName={row.company.name} href={row.href} className="block min-w-0">
                    <span className="block truncate text-table text-fg transition-colors hover:text-accent">
                      {row.primary}
                    </span>
                    <span className="block truncate text-meta text-fg-subtle">{row.secondary}</span>
                  </CompanyRecordLink>
                </div>
              ) : (
                <Link href={row.href} className="min-w-0">
                  <span className="block truncate text-table text-fg transition-colors hover:text-accent">
                    {row.primary}
                  </span>
                  <span className="block truncate text-meta text-fg-subtle">{row.secondary}</span>
                </Link>
              )}
              <span className="shrink-0 text-meta tabular-nums text-fg-subtle">{row.meta}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
