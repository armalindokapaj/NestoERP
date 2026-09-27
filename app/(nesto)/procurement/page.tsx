import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { ArrowRight, ShoppingCart } from "lucide-react";

import { CompanyRecordLink } from "@/components/workspace/company-record-link";
import { CompanyTag } from "@/components/workspace/company-tag";
import { ProcurementCompanyBreakdown, ProcurementKpiGrid } from "@/components/procurement/procurement-kpis";
import { ModulePage } from "@/components/modules/module-page";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { inGroupWorkspace } from "@/config/workspace";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import {
  procurementAttentionForWorkspace,
  procurementOverviewForWorkspace,
} from "@/lib/modules/procurement/overview/overview.service";
import {
  canReadProcurement,
  resolveProcurementExperience,
} from "@/lib/modules/procurement/procurement.workspace";
import type { CompanyRef } from "@/lib/modules/procurement/procurement.types";
import { formatDate } from "@/lib/utils/format";
import { formatAmount, receivedLabel } from "@/components/procurement/procurement-format";

export const metadata: Metadata = { title: "Procurement" };

/**
 * The Procurement overview (PRD #19 §22–§25).
 *
 * The module's own dashboard, not the personal one at /dashboard. Every panel
 * is gated by its own permission, so a reader who can raise requests but not
 * see orders gets a buying workspace rather than a page with holes in it.
 *
 * In the Group workspace it is the same page over every company the reader may
 * read (Workspace Context §38): figures add per currency and never across two,
 * the company breakdown sits under them, and a row opens in its own company.
 * Nothing is created from here — that needs a company.
 */
export default async function ProcurementOverviewPage() {
  const context = await requireModule("procurement");
  const group = inGroupWorkspace(context);
  const experience = await resolveProcurementExperience(context);

  const showsAttention =
    (await canReadProcurement(context, "procurement.request.view")) ||
    (await canReadProcurement(context, "procurement.order.view"));

  const [overview, attention] = await Promise.all([
    procurementOverviewForWorkspace(context),
    showsAttention ? procurementAttentionForWorkspace(context) : Promise.resolve(null),
  ]);

  return (
    <ModulePage
      experience={experience}
      activeSection="overview"
      actions={
        !group && can(context, "procurement.request.create") ? (
          <Button asChild size="sm">
            <Link href="/procurement/requests/new">New request</Link>
          </Button>
        ) : null
      }
    >
      <div className="space-y-5">
        <ProcurementKpiGrid overview={overview} group={group} />

        {overview.companies ? <ProcurementCompanyBreakdown companies={overview.companies} /> : null}

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
                company: row.company,
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
                company: row.company,
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
                company: row.company,
                href: `/procurement/orders/${row.id}`,
                title: `${row.poNumber} — ${row.supplier.name}`,
                meta: receivedLabel(row.receivedFraction),
              }))}
            />

            <AttentionPanel
              title="Enquiries closing"
              // The enquiry register is company work; it has no group list to send the reader to.
              href={group ? null : "/procurement/rfqs?view=issued"}
              emptyLabel="No enquiries are open."
              rows={attention.rfqsClosingSoon.map((row) => ({
                id: row.id,
                company: row.company,
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
  href: string | null;
  rows: { id: string; company?: CompanyRef; href: string; title: string; meta: string }[];
  emptyLabel: string;
}) {
  return (
    <section className="nesto-card p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-card font-semibold text-fg">{title}</h2>
        {href ? (
          <Link
            href={href}
            className="inline-flex items-center gap-1 text-table font-medium text-accent-strong"
          >
            View all
            <ArrowRight aria-hidden="true" className="size-3.5" />
          </Link>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <p className="mt-4 text-table text-fg-subtle">{emptyLabel}</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {rows.map((row) => (
            <li key={row.id} className="min-w-0">
              {row.company ? (
                // A record is one company's: from the Group workspace it opens inside that company (§31).
                <CompanyRecordLink
                  companyId={row.company.id}
                  companyName={row.company.name}
                  href={row.href}
                  className="block text-table font-medium text-fg transition-colors hover:text-accent max-sm:line-clamp-2 max-sm:[overflow-wrap:anywhere] sm:truncate"
                >
                  {row.title}
                </CompanyRecordLink>
              ) : (
                <Link
                  href={row.href}
                  className="block text-table font-medium text-fg transition-colors hover:text-accent max-sm:line-clamp-2 max-sm:[overflow-wrap:anywhere] sm:truncate"
                >
                  {row.title}
                </Link>
              )}
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-fg-subtle">
                <span>{row.meta}</span>
                {row.company ? <CompanyTag name={row.company.name} /> : null}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
