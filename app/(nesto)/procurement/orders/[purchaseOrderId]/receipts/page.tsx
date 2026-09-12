import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Truck } from "lucide-react";

import { ReceiptForm } from "@/components/procurement/receipt-form";
import {
  ReceiptList,
  type InventoryHandoff,
} from "@/components/procurement/receipt-list";
import { QualityGate } from "@/components/qaqc/quality-gate";
import { RecordContextHeader } from "@/components/modules/record-header";
import { EmptyState } from "@/components/ui/empty-state";
import { can, isModuleEnabled } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import * as inventoryReceipts from "@/lib/modules/inventory/documents/receipt.service";
import * as inventoryItems from "@/lib/modules/inventory/items/item.service";
import * as warehouses from "@/lib/modules/inventory/warehouses/warehouse.service";
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

  /*
   * The Inventory handoff, when the reader holds *both* sides (PRD #20 §303).
   *
   * Standing next to a delivery does not give a Procurement clerk warehouse
   * rights, so a reader without Inventory access sees the delivery history and
   * no booking control at all — not a disabled one.
   */
  const handoff: InventoryHandoff | null =
    isModuleEnabled(context, "inventory") &&
    can(context, "inventory.view") &&
    can(context, "inventory.receipt.create")
      ? await (async () => {
          const [items, warehouseOptions, locationOptions, posted] = await Promise.all([
            inventoryItems.selectableItems(context),
            warehouses.selectableWarehouses(context),
            warehouses.selectableLocations(context),
            inventoryReceipts.inventoryPostingsFor(
              context,
              recorded.map((row) => row.id),
            ),
          ]);

          return {
            items,
            warehouses: warehouseOptions,
            locations: locationOptions,
            posted: Object.fromEntries(posted),
          };
        })()
      : null;

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
          <ReceiptList
            orderId={order.id}
            receipts={recorded}
            handoff={handoff}
            /*
             * The quality position on each delivery, beside the delivery it is
             * about (PRD #21 §12, §13). It says whether the material may be
             * booked in — not what the inspector found.
             */
            qualityGate={Object.fromEntries(
              recorded.map((receipt) => [
                receipt.id,
                <QualityGate key={receipt.id} context={context} goodsReceiptId={receipt.id} />,
              ]),
            )}
          />
        )}
      </section>
    </div>
  );
}
