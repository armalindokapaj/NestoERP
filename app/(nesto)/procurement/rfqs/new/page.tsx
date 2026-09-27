import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { notFound } from "next/navigation";

import { RfqForm } from "@/components/procurement/rfq-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { createRfqAction } from "@/lib/actions/procurement";
import * as rfqs from "@/lib/modules/procurement/rfqs/rfq.service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("procurement");
  return { title: t("meta.newRfq") };
}

/** Draft an enquiry, optionally seeded from a request's lines (PRD #19 §71). */
export default async function NewRfqPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule("procurement");
  if (!can(context, "procurement.rfq.create")) notFound();

  const [options, params] = await Promise.all([rfqs.rfqFormOptions(context), searchParams]);

  const requestId = typeof params.requestId === "string" ? params.requestId : "";
  const source = options.requests.find((request) => request.id === requestId);
  const t = await getTranslations("procurement");

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: t("crumbs.procurement"), href: "/procurement" },
          { label: t("crumbs.enquiries"), href: "/procurement/rfqs" },
          { label: t("crumbs.newEnquiry") },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">{t("meta.newRfq")}</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          {source
            ? t("rfqs.seeded", { number: source.requestNumber })
            : t("rfqs.newDescription")}
        </p>
      </div>

      <RfqForm
        action={createRfqAction}
        cancelHref="/procurement/rfqs"
        submitLabel={t("rfqs.create")}
        pendingLabel={t("common.creating")}
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
        values={{
          title: source ? source.title : "",
          purchaseRequestId: requestId,
          projectId: "",
          currency: "EUR",
          responseDueDate: "",
          supplierIds: [],
          items:
            source && source.items.length > 0
              ? source.items.map((item) => ({
                  description: item.description,
                  quantity: item.quantity.toString(),
                  unit: item.unit,
                }))
              : [{ description: "", quantity: "1", unit: "each" }],
        }}
      />
    </div>
  );
}
