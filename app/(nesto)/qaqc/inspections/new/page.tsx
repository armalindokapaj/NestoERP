import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { InspectionForm } from "@/components/qaqc/qaqc-forms";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { createInspectionAction } from "@/lib/actions/qaqc";
import * as inspections from "@/lib/modules/qaqc/inspections/inspection.service";

export const metadata: Metadata = { title: "New inspection" };

type SearchParams = Record<string, string | string[] | undefined>;

/** Start an inspection (PRD #21 §66, §67, §68). */
export default async function NewInspectionPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const context = await requireModule("qaqc");
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
          { label: "QA/QC", href: "/qaqc" },
          { label: "Inspections", href: "/qaqc/inspections" },
          { label: "New inspection" },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">New inspection</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          Choosing a template copies its checks onto this inspection. Editing the template later
          never changes what was actually asked here.
        </p>
      </div>

      <InspectionForm
        action={createInspectionAction}
        cancelHref="/qaqc/inspections"
        submitLabel="Create inspection"
        pendingLabel="Creating…"
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
