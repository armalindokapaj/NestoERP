import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { OrderForm } from "@/components/procurement/order-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { updateOrderAction } from "@/lib/actions/procurement";
import * as orders from "@/lib/modules/procurement/orders/order.service";

type Params = { params: Promise<{ purchaseOrderId: string }> };

export const metadata: Metadata = { title: "Edit purchase order" };

/**
 * Edit an order (PRD #19 §109).
 *
 * Only while it is a draft or has been sent back. Once approved, the lines are
 * the commitment somebody signed off — changing them would mean the approval
 * was for a different order.
 */
export default async function EditOrderPage({ params }: Params) {
  const { purchaseOrderId } = await params;
  const context = await requireModule("procurement");

  let order;
  try {
    order = await orders.getOrder(context, purchaseOrderId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  if (!order.capabilities.canEdit) notFound();

  const options = await orders.orderFormOptions(context);

  async function action(formData: FormData) {
    "use server";
    return updateOrderAction(purchaseOrderId, formData);
  }

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "Procurement", href: "/procurement" },
          { label: "Orders", href: "/procurement/orders" },
          { label: order.poNumber, href: `/procurement/orders/${order.id}` },
          { label: "Edit" },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">Edit purchase order</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          {order.poNumber} — {order.supplier.name}
        </p>
      </div>

      <OrderForm
        action={action}
        versionUpdatedAt={order.updatedAt}
        cancelHref={`/procurement/orders/${order.id}`}
        submitLabel="Save changes"
        pendingLabel="Saving…"
        suppliers={options.suppliers.map((supplier) => ({
          value: supplier.id,
          label: supplier.code ? `${supplier.code} — ${supplier.name}` : supplier.name,
        }))}
        projects={options.projects.map((project) => ({
          value: project.id,
          label: `${project.code} — ${project.name}`,
        }))}
        requests={options.requests.map((request) => ({
          value: request.id,
          label: `${request.requestNumber} — ${request.title}`,
        }))}
        contracts={options.contracts.map((contract) => ({
          value: contract.id,
          label: `${contract.contractNumber} — ${contract.title}`,
        }))}
        values={{
          supplierId: order.supplier.id,
          purchaseRequestId: order.requestLink?.id ?? "",
          projectId: order.project?.id ?? "",
          contractId: order.contractLink?.id ?? "",
          orderDate: order.orderDate,
          requiredDate: order.requiredDate ?? "",
          currency: order.currency,
          notes: order.notes ?? "",
          items: order.items.map((item) => ({
            id: item.id,
            description: item.description,
            quantity: item.quantity,
            unit: item.unit,
            unitPrice: item.unitPrice,
            taxRate: item.taxRate,
          })),
        }}
      />
    </div>
  );
}
