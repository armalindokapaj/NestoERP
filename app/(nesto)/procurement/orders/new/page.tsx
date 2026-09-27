import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { OrderForm } from "@/components/procurement/order-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { createOrderAction } from "@/lib/actions/procurement";
import * as orders from "@/lib/modules/procurement/orders/order.service";
import { companyToday } from "@/lib/modules/finance/finance.settings";

export const metadata: Metadata = { title: "New purchase order" };

/** Raise a purchase order (PRD #19 §108). */
export default async function NewOrderPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule("procurement");
  if (!can(context, "procurement.order.create")) notFound();

  const [options, params, today] = await Promise.all([
    orders.orderFormOptions(context),
    searchParams,
    // The company's calendar day, not the UTC one (AUD-09 §4, FV-07).
    companyToday(context.companyId),
  ]);

  const one = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : "");

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "Procurement", href: "/procurement" },
          { label: "Orders", href: "/procurement/orders" },
          { label: "New order" },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">New purchase order</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          Saved as a draft. Approving it is what commits the company to the spend.
        </p>
      </div>

      <OrderForm
        action={createOrderAction}
        cancelHref="/procurement/orders"
        submitLabel="Create order"
        pendingLabel="Creating…"
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
          supplierId: one("supplierId"),
          purchaseRequestId: one("requestId"),
          projectId: one("projectId"),
          contractId: "",
          orderDate: today,
          requiredDate: "",
          currency: "EUR",
          notes: "",
          items: [{ description: "", quantity: "1", unit: "each", unitPrice: "", taxRate: "0" }],
        }}
      />
    </div>
  );
}
