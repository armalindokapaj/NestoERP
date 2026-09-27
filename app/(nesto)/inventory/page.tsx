import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import Link from "@/components/navigation/nav-link";
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
import { inventoryLabel } from "@/components/inventory/inventory-labels";
import { formatDate } from "@/lib/utils/format";
import { formatQuantity } from "@/components/inventory/inventory-format";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("inventory");
  return { title: t("meta.inventory") };
}

/**
 * The Inventory overview (PRD #20 §21–§24).
 *
 * The module's own workspace, not the personal dashboard at /dashboard. Every
 * panel is gated by its own permission, so a storeman who posts receipts but
 * cannot see reservations gets a working page rather than one with holes in it.
 */
export default async function InventoryOverviewPage() {
  const context = await requireModule("inventory");
  const t = await getTranslations("inventory");
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
            <Link href="/inventory/issues/new">{t("meta.newIssue")}</Link>
          </Button>
        ) : null
      }
    >
      <div className="space-y-5">
        <InventoryKpiGrid overview={overview} />

        {nothingVisible ? (
          <EmptyState
            icon={<Package />}
            title={t("overview.nothingVisibleTitle")}
            description={t("overview.nothingVisibleDescription")}
          />
        ) : null}

        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {overview.visible.stock ? (
            <AttentionPanel
              title={t("overview.runningLow")}
              href="/inventory/low-stock"
              emptyLabel={t("overview.runningLowEmpty")}
              rows={attention.lowStock.map((row) => ({
                id: row.id,
                href: `/inventory/items/${row.id}`,
                title: `${row.sku} — ${row.name}`,
                meta: `${formatQuantity(row.stock?.onHand)} ${row.baseUnit} · ${inventoryLabel(t, "stockLevel", row.level, stockLevelLabels[row.level])}`,
              }))}
            />
          ) : null}

          {can(context, "inventory.receipt.view") ? (
            <AttentionPanel
              title={t("overview.receiptsToPost")}
              href="/inventory/receipts?status=DRAFT"
              emptyLabel={t("overview.receiptsToPostEmpty")}
              rows={attention.draftReceipts.map((row) => ({
                id: row.id,
                href: `/inventory/receipts/${row.id}`,
                title: `${row.receiptNumber} — ${row.warehouse.name}`,
                meta: `${t("columns.lineCount", { count: row.lineCount })} · ${formatDate(row.receiptDate)}`,
              }))}
            />
          ) : null}

          {can(context, "inventory.issue.view") ? (
            <AttentionPanel
              title={t("overview.issuesToPost")}
              href="/inventory/issues?status=DRAFT"
              emptyLabel={t("overview.issuesToPostEmpty")}
              rows={attention.draftIssues.map((row) => ({
                id: row.id,
                href: `/inventory/issues/${row.id}`,
                title: `${row.issueNumber} — ${row.project?.code ?? t("columns.general")}`,
                meta: `${t("columns.lineCount", { count: row.lineCount })} · ${formatDate(row.issueDate)}`,
              }))}
            />
          ) : null}

          {overview.visible.reservations ? (
            <AttentionPanel
              title={t("overview.reservationsExpiring")}
              href="/inventory/reservations"
              emptyLabel={t("overview.reservationsExpiringEmpty")}
              rows={attention.expiringReservations.map((row) => ({
                id: row.id,
                href: `/inventory/items/${row.item.id}`,
                title: `${row.reservationNumber} — ${row.item.name}`,
                meta: `${formatQuantity(row.remainingQuantity)} ${row.item.baseUnit}${row.expiresAt ? ` · ${t("overview.expires", { date: formatDate(row.expiresAt) })}` : ""}`,
              }))}
            />
          ) : null}
        </div>
      </div>
    </ModulePage>
  );
}

async function AttentionPanel({
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
  const t = await getTranslations("inventory");
  return (
    <section className="nesto-card p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-card font-semibold text-fg">{title}</h2>
        <Link
          href={href}
          className="inline-flex items-center gap-1 text-table font-medium text-accent-strong"
        >
          {t("overview.viewAll")}
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
                className="block text-table font-medium text-fg transition-colors hover:text-accent max-sm:line-clamp-2 max-sm:[overflow-wrap:anywhere] sm:truncate"
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
