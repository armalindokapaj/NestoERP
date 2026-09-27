import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { redirect } from "next/navigation";

import { RecordContextHeader } from "@/components/modules/record-header";
import { ApprovalPolicyForm } from "@/components/procurement/approval-policy-form";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { getApprovalPolicy } from "@/lib/modules/procurement/approvals/approval.policy";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("procurement");
  return { title: t("meta.approvalLimits") };
}

/** /procurement/approvals/limits — Procurement's chain thresholds (PRD #41 §27, §159). */
export default async function ApprovalLimitsPage() {
  const context = await requireModule("procurement");
  if (!can(context, "procurement.approval.view")) redirect("/access-denied");
  const policy = await getApprovalPolicy(context);
  const t = await getTranslations("procurement");

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <RecordContextHeader
        breadcrumbs={[{ label: t("crumbs.procurement"), href: "/procurement" }, { label: t("crumbs.approvals"), href: "/procurement/approvals" }, { label: t("crumbs.limits") }]}
        title={t("limits.title")}
        subtitle={t("limits.subtitle")}
      />
      <ApprovalPolicyForm policy={policy} canManage={can(context, "procurement.manage")} />
    </div>
  );
}
