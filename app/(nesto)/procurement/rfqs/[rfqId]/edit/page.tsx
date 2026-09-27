import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { notFound } from "next/navigation";

import { RfqForm } from "@/components/procurement/rfq-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { updateRfqAction } from "@/lib/actions/procurement";
import * as rfqs from "@/lib/modules/procurement/rfqs/rfq.service";

type Params = { params: Promise<{ rfqId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("procurement");
  return { title: t("meta.editRfq") };
}

/**
 * Edit an enquiry (PRD #19 §73).
 *
 * Only while it is a draft. Once issued, the lines are fixed — suppliers priced
 * what they were sent, and comparing answers to different questions is not a
 * comparison.
 */
export default async function EditRfqPage({ params }: Params) {
  const { rfqId } = await params;
  const context = await requireModule("procurement");

  let rfq;
  try {
    rfq = await rfqs.getRfq(context, rfqId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  if (!rfq.capabilities.canEdit) notFound();

  const options = await rfqs.rfqFormOptions(context);
  const t = await getTranslations("procurement");

  async function action(formData: FormData) {
    "use server";
    return updateRfqAction(rfqId, formData);
  }

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: t("crumbs.procurement"), href: "/procurement" },
          { label: t("crumbs.enquiries"), href: "/procurement/rfqs" },
          { label: rfq.rfqNumber, href: `/procurement/rfqs/${rfq.id}` },
          { label: t("crumbs.edit") },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">{t("meta.editRfq")}</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          {rfq.rfqNumber} — {rfq.title}
        </p>
      </div>

      <RfqForm
        action={action}
        versionUpdatedAt={rfq.updatedAt}
        cancelHref={`/procurement/rfqs/${rfq.id}`}
        submitLabel={t("common.saveChanges")}
        pendingLabel={t("common.saving")}
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
          title: rfq.title,
          purchaseRequestId: rfq.requestLink?.id ?? "",
          projectId: rfq.projectLink?.id ?? "",
          currency: rfq.currency,
          responseDueDate: rfq.responseDueDate ?? "",
          supplierIds: rfq.suppliers.map((entry) => entry.supplier.id),
          items: rfq.items.map((item) => ({
            id: item.id,
            description: item.description,
            quantity: item.quantity,
            unit: item.unit,
          })),
        }}
      />
    </div>
  );
}
