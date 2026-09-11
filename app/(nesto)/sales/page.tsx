import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Handshake } from "lucide-react";

import { ModulePage } from "@/components/modules/module-page";
import { SalesKpiGrid } from "@/components/sales/sales-kpis";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { attentionList, getSalesOverview } from "@/lib/modules/sales/overview/overview.service";
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
 */
export default async function SalesOverviewPage() {
  const context = await requireModule("sales");
  const experience = resolveModuleExperience(context, "sales");

  const [overview, attention] = await Promise.all([
    getSalesOverview(context),
    attentionList(context),
  ]);

  const nothingVisible =
    !overview.visible.leads && !overview.visible.opportunities && !overview.visible.proposals;

  return (
    <ModulePage
      experience={experience}
      activeSection="overview"
      actions={
        <div className="flex items-center gap-2">
          {can(context, "sales.lead.create") ? (
            <Button asChild variant="secondary" size="sm">
              <Link href="/sales/leads/new">New lead</Link>
            </Button>
          ) : null}
          {can(context, "sales.opportunity.create") ? (
            <Button asChild size="sm">
              <Link href="/sales/opportunities/new">New opportunity</Link>
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="space-y-5">
        <SalesKpiGrid overview={overview} />

        {nothingVisible ? (
          <EmptyState
            icon={<Handshake />}
            title="Nothing in your Sales view."
            description="Your access covers commercial summaries rather than the pipeline itself."
          />
        ) : null}

        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {overview.visible.opportunities ? (
            <AttentionPanel
              title="Expected close overdue"
              href="/sales/reports?report=expected-close"
              emptyLabel="Nothing has run past its close date."
              rows={attention.overdueClose.map((row) => ({
                id: row.id,
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
              rows={attention.noNextStep.map((row) => ({
                id: row.id,
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
              rows={attention.qualifiedLeads.map((row) => ({
                id: row.id,
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
              rows={attention.expiringProposals.map((row) => ({
                id: row.id,
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
              rows={attention.inactiveOwners.map((row) => ({
                id: row.id,
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
}: {
  title: string;
  href: string;
  rows: AttentionRow[];
  emptyLabel: string;
}) {
  return (
    <section className="nesto-card p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-card font-semibold text-fg">{title}</h2>
        <Link
          href={href}
          className="inline-flex items-center gap-1 text-table font-medium text-accent-strong"
        >
          All
          <ArrowRight aria-hidden="true" className="size-3.5" />
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="mt-4 text-table text-fg-subtle">{emptyLabel}</p>
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0">
              <Link href={row.href} className="min-w-0">
                <span className="block truncate text-table text-fg transition-colors hover:text-accent">
                  {row.primary}
                </span>
                <span className="block truncate text-meta text-fg-subtle">{row.secondary}</span>
              </Link>
              <span className="shrink-0 text-meta tabular-nums text-fg-subtle">{row.meta}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
