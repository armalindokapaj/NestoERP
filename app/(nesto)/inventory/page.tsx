import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Package } from "lucide-react";

import { InventoryKpiGrid } from "@/components/inventory/inventory-kpis";
import { ModulePage } from "@/components/modules/module-page";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import {
  inventoryAttention,
  inventoryOverview,
} from "@/lib/modules/inventory/overview/overview.service";
import { stockLevelLabels } from "@/lib/modules/inventory/inventory.status";
import { formatDate } from "@/lib/utils/format";
import { formatQuantity } from "@/components/inventory/inventory-format";

export const metadata: Metadata = { title: "Inventory" };

/**
 * The Inventory overview (PRD #20 §21–§24).
 *
 * The module's own workspace, not the personal dashboard at /dashboard. Every
 * panel is gated by its own permission, so a storeman who posts receipts but
 * cannot see reservations gets a working page rather than one with holes in it.
 */
export default async function InventoryOverviewPage() {
  const context = await requireModule("inventory");
  const experience = resolveModuleExperience(context, "inventory");

  const [overview, attention] = await Promise.all([
    inventoryOverview(context),
    inventoryAttention(context),
  ]);

  const nothingVisible =
    !overview.visible.items &&
    !overview.visible.stock &&
    !overview.visible.documents &&
    !overview.visible.reservations;

  return (
    <ModulePage
      experience={experience}
      activeSection="overview"
      actions={
        can(context, "inventory.issue.create") ? (
          <Button asChild size="sm">
            <Link href="/inventory/issues/new">New issue</Link>
          </Button>
        ) : null
      }
    >
      <div className="space-y-5">
        <InventoryKpiGrid overview={overview} />

        {nothingVisible ? (
          <EmptyState
            icon={<Package />}
            title="Nothing in your Inventory view."
            description="Your access covers the module but not the stock records inside it."
          />
        ) : null}

        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {overview.visible.stock ? (
            <AttentionPanel
              title="Running low"
              href="/inventory/low-stock"
              emptyLabel="Nothing is below its threshold."
              rows={attention.lowStock.map((row) => ({
                id: row.id,
                href: `/inventory/items/${row.id}`,
                title: `${row.sku} — ${row.name}`,
                meta: `${formatQuantity(row.stock?.onHand)} ${row.baseUnit} · ${stockLevelLabels[row.level]}`,
              }))}
            />
          ) : null}

          {can(context, "inventory.receipt.view") ? (
            <AttentionPanel
              title="Receipts to post"
              href="/inventory/receipts?status=DRAFT"
              emptyLabel="No deliveries are waiting to be committed."
              rows={attention.draftReceipts.map((row) => ({
                id: row.id,
                href: `/inventory/receipts/${row.id}`,
                title: `${row.receiptNumber} — ${row.warehouse.name}`,
                meta: `${row.lineCount} ${row.lineCount === 1 ? "line" : "lines"} · ${formatDate(row.receiptDate)}`,
              }))}
            />
          ) : null}

          {can(context, "inventory.issue.view") ? (
            <AttentionPanel
              title="Issues to post"
              href="/inventory/issues?status=DRAFT"
              emptyLabel="No issues are sitting in draft."
              rows={attention.draftIssues.map((row) => ({
                id: row.id,
                href: `/inventory/issues/${row.id}`,
                title: `${row.issueNumber} — ${row.project?.code ?? "General"}`,
                meta: `${row.lineCount} ${row.lineCount === 1 ? "line" : "lines"} · ${formatDate(row.issueDate)}`,
              }))}
            />
          ) : null}

          {overview.visible.reservations ? (
            <AttentionPanel
              title="Reservations expiring"
              href="/inventory/reservations"
              emptyLabel="Nothing is close to expiry."
              rows={attention.expiringReservations.map((row) => ({
                id: row.id,
                href: `/inventory/items/${row.item.id}`,
                title: `${row.reservationNumber} — ${row.item.name}`,
                meta: `${formatQuantity(row.remainingQuantity)} ${row.item.baseUnit}${row.expiresAt ? ` · expires ${formatDate(row.expiresAt)}` : ""}`,
              }))}
            />
          ) : null}
        </div>
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
