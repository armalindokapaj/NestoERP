import Link from "next/link";

import type { ProcurementOverviewDTO } from "@/lib/modules/procurement/procurement.types";
import { totalsLabel } from "./procurement-format";

/**
 * The Procurement KPI row (PRD #19 §22).
 *
 * A card appears only when the reader may see what it counts. A zero where a
 * permission is missing would be a claim about the world rather than about
 * their access (PRD #19 §259).
 */
export function ProcurementKpiGrid({ overview }: { overview: ProcurementOverviewDTO }) {
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
      hint: "Ordered, not paid. Grouped by currency.",
      href: "/procurement/reports",
    });
  }

  if (overview.openRfqs > 0 || overview.rfqsAwaitingResponse > 0) {
    cards.push({
      label: "Open enquiries",
      value: String(overview.openRfqs),
      hint: `${overview.rfqsAwaitingResponse} still awaiting a reply`,
      href: "/procurement/rfqs?view=issued",
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
