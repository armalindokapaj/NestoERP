import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { NcrForm } from "@/components/qaqc/qaqc-forms";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { createNcrAction } from "@/lib/actions/qaqc";
import * as ncrs from "@/lib/modules/qaqc/ncrs/ncr.service";

export const metadata: Metadata = { title: "New NCR" };

type SearchParams = Record<string, string | string[] | undefined>;

/** Raise a non-conformance (PRD #21 §128). */
export default async function NewNcrPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const context = await requireModule("qaqc");
  if (!can(context, "qaqc.ncr.create")) notFound();

  const params = await searchParams;
  const options = await ncrs.ncrFormOptions(context);

  const read = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : "");

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "QA/QC", href: "/qaqc" },
          { label: "NCRs", href: "/qaqc/ncrs" },
          { label: "New NCR" },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">New non-conformance report</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          A formal statement that a requirement was not met. It starts as a draft and cannot be
          closed until the root cause is recorded and a corrective action has been verified.
        </p>
      </div>

      <NcrForm
        action={createNcrAction}
        cancelHref="/qaqc/ncrs"
        submitLabel="Raise NCR"
        pendingLabel="Raising…"
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
          title: "",
          description: "",
          projectId: read("projectId"),
          inspectionId: read("inspectionId"),
          goodsReceiptId: read("goodsReceiptId"),
          sourceDefectId: read("defectId"),
          category: "WORKMANSHIP",
          severity: "MEDIUM",
          assignedToMemberId: "",
          ownerMemberId: "",
          immediateAction: "",
          rootCause: "",
          correctiveActionSummary: "",
          dueDate: "",
        }}
      />
    </div>
  );
}
