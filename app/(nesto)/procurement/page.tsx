import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ShoppingCart } from "lucide-react";

import { ProcurementKpiGrid } from "@/components/procurement/procurement-kpis";
import { ModulePage } from "@/components/modules/module-page";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import {
  procurementAttention,
  procurementOverview,
} from "@/lib/modules/procurement/overview/overview.service";
import { formatDate } from "@/lib/utils/format";
import { formatAmount, receivedLabel } from "@/components/procurement/procurement-format";

export const metadata: Metadata = { title: "Procurement" };

/**
 * The Procurement overview (PRD #19 §22–§25).
 *
 * The module's own dashboard, not the personal one at /dashboard. Every panel
 * is gated by its own permission, so a reader who can raise requests but not
 * see orders gets a buying workspace rather than a page with holes in it.
 */
export default async function ProcurementOverviewPage() {
  const context = await requireModule("procurement");
  const experience = resolveModuleExperience(context, "procurement");

  const [overview, attention] = await Promise.all([
    procurementOverview(context),
    can(context, "procurement.request.view") || can(context, "procurement.order.view")
      ? procurementAttention(context)
      : Promise.resolve(null),
  ]);

  return (
    <ModulePage
      experience={experience}
      activeSection="overview"
      actions={
        can(context, "procurement.request.create") ? (
          <Button asChild size="sm">
            <Link href="/procurement/requests/new">New request</Link>
          </Button>
        ) : null
      }
    >
      <div className="space-y-5">
        <ProcurementKpiGrid overview={overview} />

        {!overview.visible.requests && !overview.visible.orders ? (
          <EmptyState
            icon={<ShoppingCart />}
            title="Nothing in your Procurement view."
            description="Your access covers the module but not the buying records inside it."
          />
        ) : null}

        {attention ? (
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            <AttentionPanel
              title="Awaiting approval"
              href="/procurement/requests?view=pending"
              emptyLabel="No requests are waiting on a decision."
              rows={attention.awaitingApproval.map((row) => ({
                id: row.id,
                href: `/procurement/requests/${row.id}`,
                title: `${row.requestNumber} — ${row.title}`,
                meta: row.currency
                  ? formatAmount(row.estimatedTotal, row.currency)
                  : "No estimate",
              }))}
            />

            <AttentionPanel
              title="Overdue deliveries"
              href="/procurement/orders?view=receiving"
              emptyLabel="Nothing is past its delivery date."
              rows={attention.overdueOrders.map((row) => ({
                id: row.id,
                href: `/procurement/orders/${row.id}`,
                title: `${row.poNumber} — ${row.supplier.name}`,
                meta: row.requiredDate ? `Due ${formatDate(row.requiredDate)}` : "No date",
              }))}
            />

            <AttentionPanel
              title="Awaiting receipt"
              href="/procurement/orders?view=receiving"
              emptyLabel="Nothing is out with a supplier."
              rows={attention.awaitingReceipt.map((row) => ({
                id: row.id,
                href: `/procurement/orders/${row.id}`,
                title: `${row.poNumber} — ${row.supplier.name}`,
                meta: receivedLabel(row.receivedFraction),
              }))}
            />

            <AttentionPanel
              title="Enquiries closing"
              href="/procurement/rfqs?view=issued"
              emptyLabel="No enquiries are open."
              rows={attention.rfqsClosingSoon.map((row) => ({
                id: row.id,
                href: `/procurement/rfqs/${row.id}`,
                title: `${row.rfqNumber} — ${row.title}`,
                meta: `${row.respondedCount} of ${row.invitedCount} replied`,
              }))}
            />
          </div>
        ) : null}
      </div>
    </ModulePage>
  );
}

function AttentionPanel({
  title,
  href,
  rows,
  emptyLabel,
}: {
  title: string;
  href: string;
  rows: { id: string; href: string; title: string; meta: string }[];
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
          View all
          <ArrowRight aria-hidden="true" className="size-3.5" />
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="mt-4 text-table text-fg-subtle">{emptyLabel}</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {rows.map((row) => (
            <li key={row.id} className="min-w-0">
              <Link
                href={row.href}
                className="block truncate text-table font-medium text-fg transition-colors hover:text-accent"
              >
                {row.title}
              </Link>
              <p className="text-meta text-fg-subtle">{row.meta}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
