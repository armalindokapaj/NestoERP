import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SupplierForm } from "@/components/procurement/supplier-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { updateSupplierAction } from "@/lib/actions/procurement";
import * as suppliers from "@/lib/modules/procurement/suppliers/supplier.service";

type Params = { params: Promise<{ supplierId: string }> };

export const metadata: Metadata = { title: "Edit supplier" };

/** Edit a supplier. An archived one is read-only until restored (PRD #19 §37). */
export default async function EditSupplierPage({ params }: Params) {
  const { supplierId } = await params;
  const context = await requireModule("procurement");

  let supplier;
  try {
    supplier = await suppliers.getSupplier(context, supplierId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  if (!supplier.capabilities.canEdit) notFound();

  async function action(formData: FormData) {
    "use server";
    return updateSupplierAction(supplierId, formData);
  }

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "Procurement", href: "/procurement" },
          { label: "Suppliers", href: "/procurement/suppliers" },
          { label: supplier.name, href: `/procurement/suppliers/${supplier.id}` },
          { label: "Edit" },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">Edit supplier</h1>
        <p className="mt-1.5 text-body text-fg-muted">{supplier.name}</p>
      </div>

      <SupplierForm
        action={action}
        versionUpdatedAt={supplier.updatedAt}
        cancelHref={`/procurement/suppliers/${supplier.id}`}
        submitLabel="Save changes"
        pendingLabel="Saving…"
        values={{
          code: supplier.code ?? "",
          name: supplier.name,
          legalName: supplier.legalName ?? "",
          supplierType: supplier.supplierType,
          status: supplier.status,
          email: supplier.email ?? "",
          phone: supplier.phone ?? "",
          website: supplier.website ?? "",
          taxId: supplier.taxId ?? "",
          registrationNumber: supplier.registrationNumber ?? "",
          address: supplier.address ?? "",
          city: supplier.city ?? "",
          country: supplier.country ?? "",
          paymentTermsDays:
            supplier.paymentTermsDays === null ? "" : String(supplier.paymentTermsDays),
          defaultCurrency: supplier.defaultCurrency ?? "",
          notes: supplier.notes ?? "",
        }}
      />
    </div>
  );
}
