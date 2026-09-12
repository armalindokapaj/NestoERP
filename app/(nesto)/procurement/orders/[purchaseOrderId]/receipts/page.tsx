import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Truck } from "lucide-react";

import { ReceiptForm } from "@/components/procurement/receipt-form";
import { ReceiptList } from "@/components/procurement/receipt-list";
import { RecordContextHeader } from "@/components/modules/record-header";
import { EmptyState } from "@/components/ui/empty-state";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import * as orders from "@/lib/modules/procurement/orders/order.service";
import * as receipts from "@/lib/modules/procurement/receipts/receipt.service";

type Params = { params: Promise<{ purchaseOrderId: string }> };

export const metadata: Metadata = { title: "Deliveries" };

/**
 * Deliveries against one order (PRD #19 §275, §276).
 *
 * The form and the history sit on one page, because the question "has this
 * arrived already?" is the one people ask immediately before recording that it
 * has.
 */
export default async function ReceiptsPage({ params }: Params) {
  const { purchaseOrderId } = await params;
  const context = await requireModule("procurement");

  let order;
  try {
    order = await orders.getOrder(context, purchaseOrderId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  if (!order.capabilities.canViewReceipts && !order.capabilities.canReceive) notFound();

  const recorded = await receipts.listForOrder(context, purchaseOrderId);

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={[
          { label: "Procurement", href: "/procurement" },
          { label: "Orders", href: "/procurement/orders" },
          { label: order.poNumber, href: `/procurement/orders/${order.id}` },
          { label: "Deliveries" },
        ]}
        title={`${order.poNumber} — ${order.supplier.name}`}
        status={order.status}
      />

      {order.capabilities.canReceive ? <ReceiptForm order={order} /> : null}

      <section className="space-y-3">
        <h2 className="text-card font-semibold text-fg">Recorded deliveries</h2>
        {recorded.length === 0 ? (
          <EmptyState
            icon={<Truck />}
            title="Nothing has arrived yet."
            description="Deliveries booked in against this order appear here, newest first."
          />
        ) : (
          <ReceiptList orderId={order.id} receipts={recorded} />
        )}
      </section>
    </div>
  );
}
