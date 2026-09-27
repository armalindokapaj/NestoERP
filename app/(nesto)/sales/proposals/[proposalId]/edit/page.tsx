import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { redirect } from "next/navigation";

import { RecordContextHeader } from "@/components/modules/record-header";
import { ProposalForm } from "@/components/sales/proposal-form";
import { updateProposalAction } from "@/lib/actions/sales";
import { proposalContext } from "../proposal-context";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("sales");
  return { title: t("meta.editProposal") };
}

type Params = { params: Promise<{ proposalId: string }> };

/**
 * Editing a proposal (PRD #17 §115, §184).
 *
 * Only in DRAFT or REJECTED. Once it is out, the price is what the client was
 * quoted, and the way to change terms is a new proposal.
 */
export default async function EditProposalPage({ params }: Params) {
  const { proposalId } = await params;
  const { proposal } = await proposalContext(proposalId);
  const t = await getTranslations("sales");

  if (!proposal.capabilities.canEdit) redirect(`/sales/proposals/${proposalId}`);

  async function action(formData: FormData) {
    "use server";
    return updateProposalAction(proposalId, formData);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <RecordContextHeader
        breadcrumbs={[
          { label: t("crumbs.sales"), href: "/sales" },
          { label: t("crumbs.proposals"), href: "/sales/proposals" },
          { label: proposal.proposalNumber, href: `/sales/proposals/${proposalId}` },
          { label: t("crumbs.edit") },
        ]}
        title={t("pages.editTitle", { name: proposal.proposalNumber })}
        status={proposal.status}
      />

      <ProposalForm
        action={action}
        lockedOpportunity={{ id: proposal.opportunity.id, name: proposal.opportunity.name }}
        values={{
          proposalNumber: proposal.proposalNumber,
          title: proposal.title,
          currency: proposal.currency,
          issueDate: proposal.createdAt.slice(0, 10),
          validUntil: proposal.validUntil,
          notes: proposal.notes,
          lineItems: proposal.lineItems.map((line) => ({
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            taxRate: line.taxRate,
          })),
        }}
        versionUpdatedAt={proposal.updatedAt}
        cancelHref={`/sales/proposals/${proposalId}`}
        submitLabel={t("pages.saveChanges")}
        pendingLabel={t("pages.saving")}
      />
    </div>
  );
}
