import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { NcrForm } from "@/components/qaqc/qaqc-forms";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { updateNcrAction } from "@/lib/actions/qaqc";
import * as ncrs from "@/lib/modules/qaqc/ncrs/ncr.service";

type Params = { params: Promise<{ ncrId: string }> };

export const metadata: Metadata = { title: "Edit NCR" };

/** Edit an NCR that is not yet closed (PRD #21 §133). */
export default async function EditNcrPage({ params }: Params) {
  const { ncrId } = await params;
  const context = await requireModule("qaqc");

  let ncr;
  try {
    ncr = await ncrs.getNcr(context, ncrId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  if (!ncr.capabilities.canEdit) notFound();

  const options = await ncrs.ncrFormOptions(context);

  async function action(formData: FormData) {
    "use server";
    return updateNcrAction(ncrId, formData);
  }

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "QA/QC", href: "/qaqc" },
          { label: "NCRs", href: "/qaqc/ncrs" },
          { label: ncr.ncrNumber, href: `/qaqc/ncrs/${ncr.id}` },
          { label: "Edit" },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">Edit NCR</h1>
        <p className="mt-1.5 text-body text-fg-muted">{ncr.ncrNumber}</p>
      </div>

      <NcrForm
        action={action}
        versionUpdatedAt={ncr.updatedAt}
        cancelHref={`/qaqc/ncrs/${ncr.id}`}
        submitLabel="Save changes"
        pendingLabel="Saving…"
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
          label: `${receipt.receiptNumber} — ${receipt.supplier.name}`,
        }))}
        values={{
          title: ncr.title,
          description: ncr.description,
          projectId: ncr.project?.id ?? "",
          inspectionId: ncr.inspection?.id ?? "",
          goodsReceiptId: ncr.source?.id ?? "",
          sourceDefectId: ncr.sourceDefect?.id ?? "",
          category: ncr.category,
          severity: ncr.severity,
          assignedToMemberId: ncr.assignedTo?.memberId ?? "",
          ownerMemberId: ncr.owner?.memberId ?? "",
          immediateAction: ncr.immediateAction ?? "",
          rootCause: ncr.rootCause ?? "",
          correctiveActionSummary: ncr.correctiveActionSummary ?? "",
          dueDate: ncr.dueDate?.slice(0, 10) ?? "",
        }}
      />
    </div>
  );
}
