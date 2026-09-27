import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { notFound } from "next/navigation";

import { SupplierForm } from "@/components/procurement/supplier-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { createSupplierAction } from "@/lib/actions/procurement";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("procurement");
  return { title: t("meta.newSupplier") };
}

/** Add a supplier (PRD #19 §26, §30). */
export default async function NewSupplierPage() {
  const context = await requireModule("procurement");
  if (!can(context, "procurement.supplier.create")) notFound();
  const t = await getTranslations("procurement");

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: t("crumbs.procurement"), href: "/procurement" },
          { label: t("crumbs.suppliers"), href: "/procurement/suppliers" },
          { label: t("crumbs.newSupplier") },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">{t("meta.newSupplier")}</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          {t("suppliers.newDescription")}
        </p>
      </div>

      <SupplierForm
        action={createSupplierAction}
        cancelHref="/procurement/suppliers"
        submitLabel={t("suppliers.add")}
        pendingLabel={t("suppliers.adding")}
      />
    </div>
  );
}
