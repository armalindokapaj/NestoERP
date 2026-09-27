import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { notFound } from "next/navigation";

import { InspectionForm } from "@/components/qaqc/qaqc-forms";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { createInspectionAction } from "@/lib/actions/qaqc";
import * as inspections from "@/lib/modules/qaqc/inspections/inspection.service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("qaqc");
  return { title: t("meta.newInspection") };
}

type SearchParams = Record<string, string | string[] | undefined>;

/** Start an inspection (PRD #21 §66, §67, §68). */
export default async function NewInspectionPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const context = await requireModule("qaqc");
  const t = await getTranslations("qaqc");
  if (!can(context, "qaqc.inspection.create")) notFound();

  const params = await searchParams;
  const options = await inspections.inspectionFormOptions(context);

  const requestId = typeof params.requestId === "string" ? params.requestId : "";
  // Started from a request: the type, project, delivery and inspector come
  // across so nobody retypes what was already stated (PRD #21 §67).
  const source = options.requests.find((row) => row.id === requestId);

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: t("common.qaqc"), href: "/qaqc" },
          { label: t("crumbs.inspections"), href: "/qaqc/inspections" },
          { label: t("crumbs.newInspection") },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">{t("meta.newInspection")}</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          {t("inspectionPage.newIntro")}
        </p>
      </div>

      <InspectionForm
        action={createInspectionAction}
        cancelHref="/qaqc/inspections"
        submitLabel={t("inspectionPage.create")}
        pendingLabel={t("common.creating")}
        projects={options.projects.map((project) => ({
          value: project.id,
          label: `${project.code} — ${project.name}`,
        }))}
        members={options.members.map((member) => ({
          value: member.id,
          label: `${member.user.firstName} ${member.user.lastName}`,
        }))}
        templates={options.templates}
        receipts={options.receipts.map((receipt) => ({
          value: receipt.id,
          label: `${receipt.receiptNumber} — ${receipt.supplier.name}`,
        }))}
        requests={options.requests.map((request) => ({
          value: request.id,
          label: `${request.requestNumber} — ${request.title}`,
        }))}
        values={
          source
            ? {
                inspectionType: source.inspectionType,
                requestId: source.id,
                templateId: "",
                projectId: source.projectId ?? "",
                goodsReceiptId: source.goodsReceiptId ?? "",
                assignedInspectorMemberId: source.assignedInspectorMemberId ?? "",
                inspectionDate: "",
                locationText: source.locationText ?? "",
                workReference: "",
                drawingReference: "",
                specificationReference: "",
                summary: "",
              }
            : undefined
        }
      />
    </div>
  );
}
