import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { RecordContextHeader } from "@/components/modules/record-header";
import { ApprovalPolicyForm } from "@/components/procurement/approval-policy-form";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { getApprovalPolicy } from "@/lib/modules/procurement/approvals/approval.policy";

export const metadata: Metadata = { title: "Purchase order approval limits" };

/** /procurement/approvals/limits — Procurement's chain thresholds (PRD #41 §27, §159). */
export default async function ApprovalLimitsPage() {
  const context = await requireModule("procurement");
  if (!can(context, "procurement.approval.view")) redirect("/access-denied");
  const policy = await getApprovalPolicy(context);

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <RecordContextHeader
        breadcrumbs={[{ label: "Procurement", href: "/procurement" }, { label: "Approvals", href: "/procurement/approvals" }, { label: "Limits" }]}
        title="Purchase order approval limits"
        subtitle="Every order is approved by Procurement. Larger ones then go to Finance, and the largest to an executive, in that order."
      />
      <ApprovalPolicyForm policy={policy} canManage={can(context, "procurement.manage")} />
    </div>
  );
}
