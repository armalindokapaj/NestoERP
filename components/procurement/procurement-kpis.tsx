import Link from "@/components/navigation/nav-link";

import type {
  ProcurementCompanyFiguresDTO,
  ProcurementOverviewDTO,
} from "@/lib/modules/procurement/procurement.types";
import { totalsLabel } from "./procurement-format";

/**
 * The Procurement KPI row (PRD #19 §22).
 *
 * A card appears only when the reader may see what it counts. A zero where a
 * permission is missing would be a claim about the world rather than about
 * their access (PRD #19 §259).
 */
export function ProcurementKpiGrid({
  overview,
  group = false,
}: {
  overview: ProcurementOverviewDTO;
  /** The Group workspace: a card whose page belongs to one company is not a link there (Workspace Context §25, §29). */
  group?: boolean;
}) {
  const cards: { label: string; value: string; hint?: string; href?: string }[] = [];

  if (overview.visible.requests) {
    cards.push({
      label: "Open requests",
      value: String(overview.openRequests),
      hint: `${overview.requestsAwaitingApproval} awaiting approval`,
      href: "/procurement/requests",
    });
  }

  if (overview.visible.orders) {
    cards.push({
      label: "Awaiting receipt",
      value: String(overview.ordersAwaitingReceipt),
      hint:
        overview.overdueOrders > 0
          ? `${overview.overdueOrders} past their date`
          : "All on schedule",
      href: "/procurement/orders?view=receiving",
    });
    cards.push({
      label: "Orders to approve",
      value: String(overview.ordersAwaitingApproval),
      hint: `${overview.issuedOrders} issued`,
      href: "/procurement/orders?view=pending",
    });
  }

  if (overview.committedValue) {
    cards.push({
      label: "Committed value",
      value: totalsLabel(overview.committedValue),
      hint: group
        ? "Ordered, not paid. Added per currency across companies, never between currencies."
        : "Ordered, not paid. Grouped by currency.",
      href: "/procurement/reports",
    });
  }

  if (overview.openRfqs > 0 || overview.rfqsAwaitingResponse > 0) {
    cards.push({
      label: "Open enquiries",
      value: String(overview.openRfqs),
      hint: `${overview.rfqsAwaitingResponse} still awaiting a reply`,
      href: group ? undefined : "/procurement/rfqs?view=issued",
    });
  }

  if (overview.visible.suppliers) {
    cards.push({
      label: "Active suppliers",
      value: String(overview.activeSuppliers),
      href: "/procurement/suppliers",
    });
  }

  if (cards.length === 0) return null;

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map((card) => {
        const body = (
          <>
            <p className="nesto-eyebrow text-fg-subtle">{card.label}</p>
            <p className="mt-1.5 text-page font-semibold text-fg">{card.value}</p>
            {card.hint ? <p className="mt-1 text-meta text-fg-subtle">{card.hint}</p> : null}
          </>
        );

        return card.href ? (
          <Link
            key={card.label}
            href={card.href}
            className="nesto-card p-5 transition-colors hover:border-line-strong"
          >
            {body}
          </Link>
        ) : (
          <div key={card.label} className="nesto-card p-5">
            {body}
          </div>
        );
      })}
    </div>
  );
}

/**
 * The overview's figures company by company, in the Group workspace only
 * (Workspace Context §72, §73).
 *
 * A group total is only as useful as the breakdown behind it. Each company's
 * committed value is in its own currencies; the rows are never added into a
 * single figure here.
 */
export function ProcurementCompanyBreakdown({ companies }: { companies: ProcurementCompanyFiguresDTO[] }) {
  if (companies.length === 0) return null;

  return (
    <section className="nesto-card p-5" data-testid="procurement-company-breakdown">
      <h2 className="text-card font-semibold text-fg">By company</h2>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-table">
          <caption className="sr-only">Procurement figures by company</caption>
          <thead>
            <tr className="text-left text-meta text-fg-subtle">
              <th scope="col" className="pb-2 pr-3 font-medium">Company</th>
              <th scope="col" className="pb-2 pr-3 text-right font-medium">Open requests</th>
              <th scope="col" className="pb-2 pr-3 text-right font-medium">Awaiting receipt</th>
              <th scope="col" className="pb-2 pr-3 text-right font-medium">Past their date</th>
              <th scope="col" className="pb-2 text-right font-medium">Committed value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {companies.map((row) => (
              <tr key={row.company.id} data-company-id={row.company.id}>
                <th scope="row" className="py-2 pr-3 text-left font-medium text-fg">{row.company.name}</th>
                <td className="py-2 pr-3 text-right tabular-nums text-fg-muted">{row.openRequests}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-fg-muted">{row.ordersAwaitingReceipt}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-fg-muted">{row.overdueOrders}</td>
                <td className="py-2 text-right tabular-nums text-fg">{totalsLabel(row.committedValue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
