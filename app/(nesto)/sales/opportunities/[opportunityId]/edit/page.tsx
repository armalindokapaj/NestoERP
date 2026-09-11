import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { RecordContextHeader } from "@/components/modules/record-header";
import { OpportunityForm } from "@/components/sales/opportunity-form";
import { can } from "@/lib/access/can";
import { updateOpportunityAction } from "@/lib/actions/sales";
import { salesClientOptions, salesOwnerOptions } from "@/lib/modules/sales/sales.options";
import { opportunityContext } from "../opportunity-context";

export const metadata: Metadata = { title: "Edit opportunity" };

type Params = { params: Promise<{ opportunityId: string }> };

/** Editing a deal (PRD #17 §79). A closed one is read-only (§233). */
export default async function EditOpportunityPage({ params }: Params) {
  const { opportunityId } = await params;
  const { context, opportunity } = await opportunityContext(opportunityId);

  if (!opportunity.capabilities.canEdit) redirect(`/sales/opportunities/${opportunityId}`);

  const [owners, clients] = await Promise.all([
    salesOwnerOptions(context),
    can(context, "client.view") ? salesClientOptions(context) : Promise.resolve([]),
  ]);

  async function action(formData: FormData) {
    "use server";
    return updateOpportunityAction(opportunityId, formData);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <RecordContextHeader
        breadcrumbs={[
          { label: "Sales", href: "/sales" },
          { label: "Opportunities", href: "/sales/opportunities" },
          { label: opportunity.name, href: `/sales/opportunities/${opportunityId}` },
          { label: "Edit" },
        ]}
        title={`Edit ${opportunity.name}`}
        status={opportunity.stage}
      />

      <OpportunityForm
        action={action}
        owners={owners}
        clients={clients}
        values={{
          name: opportunity.name,
          ownerMemberId: opportunity.owner.memberId,
          stage: opportunity.stage,
          estimatedValue: opportunity.estimatedValue,
          currency: opportunity.currency,
          clientId: opportunity.client?.id ?? null,
          contactId: opportunity.contact?.id ?? null,
          expectedCloseDate: opportunity.expectedCloseDate,
          probabilityOverride: opportunity.probabilityIsOverride ? opportunity.probability : null,
          description: opportunity.description,
          nextStep: opportunity.nextStep,
        }}
        versionUpdatedAt={opportunity.updatedAt}
        cancelHref={`/sales/opportunities/${opportunityId}`}
        submitLabel="Save changes"
        pendingLabel="Saving…"
      />
    </div>
  );
}
