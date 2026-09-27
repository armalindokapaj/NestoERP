import type { Metadata } from "next";
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

type Params = { params: Promise<{ supplierId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { supplierId } = await params;
  try {
    const context = await requireModule("procurement");
    const supplier = await suppliers.getSupplier(context, supplierId);
    return { title: supplier.name };
  } catch {
    return { title: "Supplier" };
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

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={[
          { label: "Procurement", href: "/procurement" },
          { label: "Suppliers", href: "/procurement/suppliers" },
          { label: supplier.name },
        ]}
        title={supplier.name}
        subtitle={supplier.code ?? supplier.legalName ?? undefined}
        status={supplier.status}
        badges={<Badge tone="neutral">{supplierTypeLabels[supplier.supplierType]}</Badge>}
        meta={[
          { label: "Open orders", value: String(supplier.openOrders) },
          {
            label: "Payment terms",
            value:
              supplier.paymentTermsDays === null ? "Not set" : `${supplier.paymentTermsDays} days`,
          },
          { label: "Country", value: orDash(supplier.country) },
        ]}
        actions={<SupplierActions supplier={supplier} />}
      />

      {supplier.archivedAt ? (
        <p className="rounded-md border border-line bg-surface-2 px-4 py-3 text-table text-fg-muted">
          This supplier is archived and cannot be named on new buying. Restore it first.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">Details</h2>
            <DetailGrid
              className="mt-4"
              items={[
                { label: "Legal name", value: orDash(supplier.legalName) },
                { label: "Type", value: supplierTypeLabels[supplier.supplierType] },
                { label: "Tax number", value: orDash(supplier.taxId) },
                { label: "Registration number", value: orDash(supplier.registrationNumber) },
                {
                  label: "Email",
                  value: supplier.email ? (
                    <a href={`mailto:${supplier.email}`} className="hover:text-accent">
                      {supplier.email}
                    </a>
                  ) : (
                    "—"
                  ),
                },
                {
                  label: "Phone",
                  value: supplier.phone ? (
                    <a href={`tel:${supplier.phone}`} className="hover:text-accent">
                      {supplier.phone}
                    </a>
                  ) : (
                    "—"
                  ),
                },
                {
                  label: "Website",
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
                { label: "Default currency", value: orDash(supplier.defaultCurrency) },
              ]}
            />

            <div className="mt-6 border-t border-line pt-5">
              <h3 className="text-table font-semibold text-fg">Address</h3>
              <DetailGrid
                className="mt-3"
                items={[
                  { label: "Address", value: orDash(supplier.address) },
                  { label: "City", value: orDash(supplier.city) },
                  { label: "Country", value: orDash(supplier.country) },
                ]}
              />
            </div>

            {supplier.notes ? (
              <div className="mt-6 border-t border-line pt-5">
                <h3 className="text-table font-semibold text-fg">Notes</h3>
                <p className="mt-2 whitespace-pre-wrap text-table text-fg-muted">
                  {supplier.notes}
                </p>
              </div>
            ) : null}
          </section>

          {recentOrders.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Orders</h2>
              {(recentOrders.total ?? recentOrders.length) > recentOrders.length ? (
                <p className="text-meta text-fg-subtle" data-testid="supplier-orders-scope">
                  The {recentOrders.length} most recent of {recentOrders.total} orders.
                </p>
              ) : null}
              <OrderTable
                orders={recentOrders}
                showSupplier={false}
                caption={`Orders with ${supplier.name}`}
                listId="procurement.supplier-orders"
              />
            </section>
          ) : null}
        </div>

        <div className="space-y-4">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">Activity so far</h2>
            <dl className="mt-4 space-y-3">
              <Meta label="Orders" value={String(supplier.counts.orders)} />
              <Meta label="Quotes" value={String(supplier.counts.quotes)} />
              <Meta label="Deliveries" value={String(supplier.counts.receipts)} />
            </dl>
          </section>

          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">Record</h2>
            <dl className="mt-4 space-y-3">
              <Meta label="Added" value={formatDateTime(supplier.createdAt)} />
              <Meta label="Updated" value={formatDateTime(supplier.updatedAt)} />
              {supplier.archivedAt ? (
                <Meta label="Archived" value={formatDateTime(supplier.archivedAt)} />
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
