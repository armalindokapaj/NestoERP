import Link from "@/components/navigation/nav-link";

import type { InventoryOverviewDTO } from "@/lib/modules/inventory/inventory.types";
import { getTranslations } from "@/lib/i18n/server";

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
export async function InventoryKpiGrid({ overview }: { overview: InventoryOverviewDTO }) {
  const t = await getTranslations("inventory");
  const cards: { label: string; value: string; hint?: string; href?: string }[] = [];

  if (overview.visible.items) {
    cards.push({
      label: t("kpis.activeItems"),
      value: String(overview.activeItems),
      hint: overview.visible.stock ? t("kpis.currentlyHeld", { count: overview.itemsHeld }) : undefined,
      href: "/inventory/items",
    });
  }

  if (overview.visible.stock) {
    cards.push({
      label: t("kpis.lowStock"),
      value: String(overview.lowStockItems),
      hint:
        overview.outOfStockItems > 0
          ? t("kpis.outOfStock", { count: overview.outOfStockItems })
          : t("kpis.nothingOut"),
      href: "/inventory/low-stock",
    });
  }

  if (overview.visible.documents) {
    cards.push({
      label: t("kpis.draftsToPost"),
      value: String(overview.draftDocuments),
      hint: t("kpis.draftsHint"),
      href: "/inventory/receipts?status=DRAFT",
    });
  }

  if (overview.visible.movements) {
    cards.push({
      label: t("kpis.movementsThisMonth"),
      value: String(overview.movementsThisMonth),
      href: "/inventory/movements",
    });
  }

  if (overview.visible.reservations) {
    cards.push({
      label: t("kpis.activeReservations"),
      value: String(overview.activeReservations),
      hint: t("kpis.reservationsHint"),
      href: "/inventory/reservations",
    });
  }

  if (overview.warehouses > 0) {
    cards.push({
      label: t("kpis.warehouses"),
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
