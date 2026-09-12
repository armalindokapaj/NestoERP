import Link from "next/link";

import type { InventoryOverviewDTO } from "@/lib/modules/inventory/inventory.types";

/**
 * The Inventory KPI row (PRD #20 §21).
 *
 * A card appears only when the reader may see what it counts. A zero where a
 * permission is missing would be a claim about the world rather than about
 * their access.
 *
 * There is deliberately no stock value. V0.1 has no costing method, so a
 * currency figure here would be a number nobody could defend (PRD #20 §186).
 */
export function InventoryKpiGrid({ overview }: { overview: InventoryOverviewDTO }) {
  const cards: { label: string; value: string; hint?: string; href?: string }[] = [];

  if (overview.visible.items) {
    cards.push({
      label: "Active items",
      value: String(overview.activeItems),
      hint: overview.visible.stock ? `${overview.itemsHeld} currently held` : undefined,
      href: "/inventory/items",
    });
  }

  if (overview.visible.stock) {
    cards.push({
      label: "Low stock",
      value: String(overview.lowStockItems),
      hint:
        overview.outOfStockItems > 0
          ? `${overview.outOfStockItems} out of stock`
          : "Nothing has run out",
      href: "/inventory/low-stock",
    });
  }

  if (overview.visible.documents) {
    cards.push({
      label: "Drafts to post",
      value: String(overview.draftDocuments),
      hint: "Receipts and issues not yet committed",
      href: "/inventory/receipts?status=DRAFT",
    });
  }

  if (overview.visible.movements) {
    cards.push({
      label: "Movements this month",
      value: String(overview.movementsThisMonth),
      href: "/inventory/movements",
    });
  }

  if (overview.visible.reservations) {
    cards.push({
      label: "Active reservations",
      value: String(overview.activeReservations),
      hint: "Held back from available stock",
      href: "/inventory/reservations",
    });
  }

  if (overview.warehouses > 0) {
    cards.push({
      label: "Warehouses",
      value: String(overview.warehouses),
      href: "/inventory/warehouses",
    });
  }

  if (cards.length === 0) return null;

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map((card) => {
        const body = (
          <>
            <p className="nesto-eyebrow text-fg-subtle">{card.label}</p>
            <p className="mt-1.5 text-page font-semibold tabular-nums text-fg">{card.value}</p>
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
