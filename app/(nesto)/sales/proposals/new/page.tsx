import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { redirect } from "next/navigation";

import { RecordContextHeader } from "@/components/modules/record-header";
import { ProposalForm } from "@/components/sales/proposal-form";
import { can } from "@/lib/access/can";
import { createProposalAction } from "@/lib/actions/sales";
import { requireModule } from "@/lib/context/current-user";
import { proposalOpportunityOptions } from "@/lib/modules/sales/sales.options";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("sales");
  return { title: t("meta.newProposal") };
}

/** Draft a commercial offer (PRD #17 §113, §114). */
export default async function NewProposalPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule("sales");
  const t = await getTranslations("sales");
  if (!can(context, "sales.proposal.create")) redirect("/access-denied");

  const params = await searchParams;
  const preselected = typeof params.opportunityId === "string" ? params.opportunityId : null;

  const opportunities = await proposalOpportunityOptions(context);

  async function action(formData: FormData) {
    "use server";
    return createProposalAction(formData);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <RecordContextHeader
        breadcrumbs={[
          { label: t("crumbs.sales"), href: "/sales" },
          { label: t("crumbs.proposals"), href: "/sales/proposals" },
          { label: t("crumbs.newProposal") },
        ]}
        title={t("meta.newProposal")}
        subtitle={t("pages.newProposalSubtitle")}
      />

      {opportunities.length === 0 ? (
        <p className="nesto-card p-5 text-table text-fg-muted">
          {t("pages.noOpenOpportunity")}
        </p>
      ) : (
        <ProposalForm
          action={action}
          opportunities={opportunities}
          lockedOpportunity={
            preselected
              ? {
                  id: preselected,
                  name:
                    opportunities.find((option) => option.value === preselected)?.label ?? "",
                }
              : undefined
          }
          cancelHref="/sales/proposals"
          submitLabel={t("pages.createProposal")}
          pendingLabel={t("pages.creating")}
        />
      )}
    </div>
  );
}
