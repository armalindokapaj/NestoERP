import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { notFound } from "next/navigation";

import { OrderTable } from "@/components/procurement/order-table";
import { SupplierActions } from "@/components/procurement/supplier-actions";
import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { Badge } from "@/components/ui/badge";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import * as orders from "@/lib/modules/procurement/orders/order.service";
import * as suppliers from "@/lib/modules/procurement/suppliers/supplier.service";
import { supplierTypeLabels } from "@/lib/modules/procurement/procurement.status";
import { formatDateTime, orDash } from "@/lib/utils/format";
import { procurementLabel } from "@/lib/i18n/modules/procurement/labels";

type Params = { params: Promise<{ supplierId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { supplierId } = await params;
  try {
    const context = await requireModule("procurement");
    const supplier = await suppliers.getSupplier(context, supplierId);
    return { title: supplier.name };
  } catch {
    return { title: (await getTranslations("procurement"))("meta.supplier") };
  }
}

/** Supplier detail (PRD #19 §36). */
export default async function SupplierDetailPage({ params }: Params) {
  const { supplierId } = await params;
  const context = await requireModule("procurement");

  let supplier;
  try {
    supplier = await suppliers.getSupplier(context, supplierId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const recentOrders = supplier.capabilities.canViewOrders
    ? await orders.listForSupplier(context, supplierId)
    : [];
  const t = await getTranslations("procurement");
  const typeLabel = procurementLabel(t, "supplierType", supplier.supplierType, supplierTypeLabels[supplier.supplierType]);

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={[
          { label: t("crumbs.procurement"), href: "/procurement" },
          { label: t("crumbs.suppliers"), href: "/procurement/suppliers" },
          { label: supplier.name },
        ]}
        title={supplier.name}
        subtitle={supplier.code ?? supplier.legalName ?? undefined}
        status={supplier.status}
        badges={<Badge tone="neutral">{typeLabel}</Badge>}
        meta={[
          { label: t("suppliers.openOrders"), value: String(supplier.openOrders) },
          {
            label: t("suppliers.paymentTerms"),
            value:
              supplier.paymentTermsDays === null ? t("common.notSet") : t("common.days", { count: supplier.paymentTermsDays }),
          },
          { label: t("common.country"), value: orDash(supplier.country) },
        ]}
        actions={<SupplierActions supplier={supplier} />}
      />

      {supplier.archivedAt ? (
        <p className="rounded-md border border-line bg-surface-2 px-4 py-3 text-table text-fg-muted">
          {t("suppliers.archivedNotice")}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("common.details")}</h2>
            <DetailGrid
              className="mt-4"
              items={[
                { label: t("suppliers.legalName"), value: orDash(supplier.legalName) },
                { label: t("common.type"), value: typeLabel },
                { label: t("suppliers.taxNumber"), value: orDash(supplier.taxId) },
                { label: t("suppliers.registrationNumber"), value: orDash(supplier.registrationNumber) },
                {
                  label: t("suppliers.email"),
                  value: supplier.email ? (
                    <a href={`mailto:${supplier.email}`} className="hover:text-accent">
                      {supplier.email}
                    </a>
                  ) : (
                    "—"
                  ),
                },
                {
                  label: t("suppliers.phone"),
                  value: supplier.phone ? (
                    <a href={`tel:${supplier.phone}`} className="hover:text-accent">
                      {supplier.phone}
                    </a>
                  ) : (
                    "—"
                  ),
                },
                {
                  label: t("suppliers.website"),
                  value: supplier.website ? (
                    // Only http(s) reaches this point; the schema refuses
                    // anything else (PRD #19 §26).
                    <a
                      href={supplier.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-accent"
                    >
                      {supplier.website}
                    </a>
                  ) : (
                    "—"
                  ),
                },
                { label: t("suppliers.defaultCurrency"), value: orDash(supplier.defaultCurrency) },
              ]}
            />

            <div className="mt-6 border-t border-line pt-5">
              <h3 className="text-table font-semibold text-fg">{t("suppliers.address")}</h3>
              <DetailGrid
                className="mt-3"
                items={[
                  { label: t("suppliers.address"), value: orDash(supplier.address) },
                  { label: t("suppliers.city"), value: orDash(supplier.city) },
                  { label: t("common.country"), value: orDash(supplier.country) },
                ]}
              />
            </div>

            {supplier.notes ? (
              <div className="mt-6 border-t border-line pt-5">
                <h3 className="text-table font-semibold text-fg">{t("common.notes")}</h3>
                <p className="mt-2 whitespace-pre-wrap text-table text-fg-muted">
                  {supplier.notes}
                </p>
              </div>
            ) : null}
          </section>

          {recentOrders.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">{t("suppliers.orders")}</h2>
              {(recentOrders.total ?? recentOrders.length) > recentOrders.length ? (
                <p className="text-meta text-fg-subtle" data-testid="supplier-orders-scope">
                  {t("common.mostRecentOrders", { shown: recentOrders.length, total: recentOrders.total ?? recentOrders.length })}
                </p>
              ) : null}
              <OrderTable
                orders={recentOrders}
                showSupplier={false}
                caption={t("suppliers.ordersWith", { name: supplier.name })}
                listId="procurement.supplier-orders"
              />
            </section>
          ) : null}
        </div>

        <div className="space-y-4">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("suppliers.activity")}</h2>
            <dl className="mt-4 space-y-3">
              <Meta label={t("suppliers.orders")} value={String(supplier.counts.orders)} />
              <Meta label={t("suppliers.quotes")} value={String(supplier.counts.quotes)} />
              <Meta label={t("suppliers.deliveries")} value={String(supplier.counts.receipts)} />
            </dl>
          </section>

          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("suppliers.record")}</h2>
            <dl className="mt-4 space-y-3">
              <Meta label={t("suppliers.added")} value={formatDateTime(supplier.createdAt)} />
              <Meta label={t("common.updated")} value={formatDateTime(supplier.updatedAt)} />
              {supplier.archivedAt ? (
                <Meta label={t("suppliers.archived")} value={formatDateTime(supplier.archivedAt)} />
              ) : null}
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="nesto-eyebrow text-fg-subtle">{label}</dt>
      <dd className="mt-0.5 text-table text-fg">{value}</dd>
    </div>
  );
}
