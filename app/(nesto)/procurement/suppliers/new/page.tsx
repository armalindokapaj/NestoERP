import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SupplierForm } from "@/components/procurement/supplier-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { createSupplierAction } from "@/lib/actions/procurement";

export const metadata: Metadata = { title: "New supplier" };

/** Add a supplier (PRD #19 §26, §30). */
export default async function NewSupplierPage() {
  const context = await requireModule("procurement");
  if (!can(context, "procurement.supplier.create")) notFound();

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "Procurement", href: "/procurement" },
          { label: "Suppliers", href: "/procurement/suppliers" },
          { label: "New supplier" },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">New supplier</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          An organisation or person the company buys from.
        </p>
      </div>

      <SupplierForm
        action={createSupplierAction}
        cancelHref="/procurement/suppliers"
        submitLabel="Add supplier"
        pendingLabel="Adding…"
      />
    </div>
  );
}
