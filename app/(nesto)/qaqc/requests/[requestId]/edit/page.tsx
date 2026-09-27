import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { notFound } from "next/navigation";

import { RequestForm } from "@/components/qaqc/qaqc-forms";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { updateRequestAction } from "@/lib/actions/qaqc";
import * as requests from "@/lib/modules/qaqc/requests/request.service";
import { formatDate } from "@/lib/utils/format";

type Params = { params: Promise<{ requestId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("qaqc");
  return { title: t("meta.editRequest") };
}

/** Edit a request that has not yet been picked up (PRD #21 §44). */
export default async function EditRequestPage({ params }: Params) {
  const { requestId } = await params;
  const context = await requireModule("qaqc");
  const t = await getTranslations("qaqc");

  let request;
  try {
    request = await requests.getRequest(context, requestId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  if (!request.capabilities.canEdit) notFound();

  const options = await requests.requestFormOptions(context);

  async function action(formData: FormData) {
    "use server";
    return updateRequestAction(requestId, formData);
  }

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: t("common.qaqc"), href: "/qaqc" },
          { label: t("crumbs.requests"), href: "/qaqc/requests" },
          { label: request.requestNumber, href: `/qaqc/requests/${request.id}` },
          { label: t("crumbs.edit") },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">{t("meta.editRequest")}</h1>
        <p className="mt-1.5 text-body text-fg-muted">{request.title}</p>
      </div>

      <RequestForm
        action={action}
        versionUpdatedAt={request.updatedAt}
        cancelHref={`/qaqc/requests/${request.id}`}
        submitLabel={t("common.saveChanges")}
        pendingLabel={t("common.saving")}
        canAssign={can(context, "qaqc.request.assign")}
        projects={options.projects.map((project) => ({
          value: project.id,
          label: `${project.code} — ${project.name}`,
        }))}
        members={options.members.map((member) => ({
          value: member.id,
          label: `${member.user.firstName} ${member.user.lastName}`,
        }))}
        receipts={options.receipts.map((receipt) => ({
          value: receipt.id,
          label: `${receipt.receiptNumber} — ${receipt.supplier.name} · ${formatDate(receipt.receiptDate.toISOString())}`,
        }))}
        values={{
          title: request.title,
          inspectionType: request.inspectionType,
          projectId: request.project?.id ?? "",
          goodsReceiptId: request.source?.id ?? "",
          requestedDate: request.requestedDate.slice(0, 10),
          requiredByDate: request.requiredByDate?.slice(0, 10) ?? "",
          priority: request.priority,
          assignedInspectorMemberId: request.assignedInspector?.memberId ?? "",
          description: request.description ?? "",
          locationText: request.locationText ?? "",
        }}
      />
    </div>
  );
}
