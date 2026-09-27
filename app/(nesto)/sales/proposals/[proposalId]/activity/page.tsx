import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { redirect } from "next/navigation";

import { RecordContextHeader } from "@/components/modules/record-header";
import { SalesActivityFeed } from "@/components/sales/sales-activity";
import { SkeletonTable } from "@/components/ui/loading-state";
import { proposalContext } from "../proposal-context";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("sales");
  return { title: t("meta.proposalActivity") };
}

type Params = { params: Promise<{ proposalId: string }> };

/** One proposal's full history (PRD #17 §147, §418). */
export default async function ProposalActivityPage({ params }: Params) {
  const { proposalId } = await params;
  const { context, proposal } = await proposalContext(proposalId);
  const t = await getTranslations("sales");

  if (!proposal.capabilities.canViewActivity) redirect(`/sales/proposals/${proposalId}`);

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={[
          { label: t("crumbs.sales"), href: "/sales" },
          { label: t("crumbs.proposals"), href: "/sales/proposals" },
          { label: proposal.proposalNumber, href: `/sales/proposals/${proposalId}` },
          { label: t("crumbs.activity") },
        ]}
        title={t("detail.activityTitle", { name: proposal.proposalNumber })}
        status={proposal.status}
      />

      <Suspense fallback={<SkeletonTable rows={5} />}>
        <SalesActivityFeed context={context} entityType="Proposal" entityId={proposalId} />
      </Suspense>
    </div>
  );
}
