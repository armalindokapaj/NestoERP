import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Scale } from "lucide-react";

import { ContractKpiGrid } from "@/components/contracts/contract-kpis";
import { ModulePage } from "@/components/modules/module-page";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import {
  contractAttention,
  contractOverview,
} from "@/lib/modules/contracts/overview/overview.service";
import { commercialLabel, expiryLabel } from "@/components/contracts/contract-format";
import { formatDate } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Legal" };

/**
 * The Legal overview (PRD #18 §32–§34, §339).
 *
 * The module's own dashboard, not the personal one at /dashboard. Every panel
 * is gated by its own permission, so a reader granted contract visibility
 * without commercial values sees a legal workspace rather than a page with
 * holes in it (PRD #18 §495).
 */
export default async function ContractsOverviewPage() {
  const context = await requireModule("contracts");
  const experience = resolveModuleExperience(context, "contracts");

  const [overview, attention] = await Promise.all([
    contractOverview(context),
    can(context, "legal.contract.view")
      ? contractAttention(context)
      : Promise.resolve(null),
  ]);

  return (
    <ModulePage
      experience={experience}
      activeSection="overview"
      actions={
        can(context, "legal.contract.create") ? (
          <Button asChild size="sm">
            <Link href="/contracts/new">New contract</Link>
          </Button>
        ) : null
      }
    >
      <div className="space-y-5">
        <ContractKpiGrid overview={overview} />

        {!overview.visible.contracts ? (
          <EmptyState
            icon={<Scale />}
            title="Nothing in your Legal view."
            description="Your access covers the module but not the contract register itself."
          />
        ) : null}

        {attention ? (
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            <AttentionPanel
              title="Expiring soon"
              href="/contracts/expiring"
              emptyLabel="Nothing ends in the next ninety days."
              rows={attention.expiring.map((row) => ({
                id: row.id,
                href: `/contracts/${row.id}`,
                primary: row.contractNumber,
                secondary: row.title,
                meta: expiryLabel(row.attention.daysToExpiry),
              }))}
            />

            <AttentionPanel
              title="Renewal notice due"
              href="/contracts/expiring"
              emptyLabel="No renewal notice is outstanding."
              rows={attention.renewalNoticeDue.map((row) => ({
                id: row.id,
                href: `/contracts/${row.id}`,
                primary: row.contractNumber,
                secondary: row.client?.name ?? row.counterpartyName ?? "No counterparty",
                meta: row.expiryDate ? formatDate(row.expiryDate) : "—",
              }))}
            />

            <AttentionPanel
              title="Ready to activate"
              href="/contracts/all?status=SIGNED"
              emptyLabel="Nothing signed is waiting for its effective date."
              rows={attention.readyToActivate.map((row) => ({
                id: row.id,
                href: `/contracts/${row.id}`,
                primary: row.contractNumber,
                secondary: row.title,
                meta: row.effectiveDate ? formatDate(row.effectiveDate) : "—",
              }))}
            />

            <AttentionPanel
              title="Sent, awaiting signature"
              href="/contracts/all?status=SENT"
              emptyLabel="Nothing is out for signature."
              rows={attention.awaitingSignature.map((row) => ({
                id: row.id,
                href: `/contracts/${row.id}`,
                primary: row.contractNumber,
                secondary: row.client?.name ?? row.counterpartyName ?? "No counterparty",
                meta: commercialLabel(row.commercial) ?? "—",
              }))}
            />

            {overview.visible.obligations ? (
              <AttentionPanel
                title="Overdue obligations"
                href="/contracts/reports"
                emptyLabel="Every open obligation is still in date."
                rows={attention.overdueObligations.map((row) => ({
                  id: row.id,
                  href: `/contracts/${row.contractId}/obligations`,
                  primary: row.title,
                  secondary: row.responsible?.fullName ?? "Unassigned",
                  meta: `${row.daysOverdue} day${row.daysOverdue === 1 ? "" : "s"} overdue`,
                }))}
              />
            ) : null}

            {attention.inactiveOwners.length > 0 ? (
              <AttentionPanel
                title="Owner has left"
                href="/contracts/active"
                emptyLabel="Every live contract has an active owner."
                rows={attention.inactiveOwners.map((row) => ({
                  id: row.id,
                  href: `/contracts/${row.id}`,
                  primary: row.contractNumber,
                  secondary: `${row.owner.fullName} is no longer active`,
                  meta: "Reassign",
                }))}
              />
            ) : null}
          </div>
        ) : null}
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
