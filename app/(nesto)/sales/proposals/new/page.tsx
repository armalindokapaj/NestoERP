import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { RecordContextHeader } from "@/components/modules/record-header";
import { ProposalForm } from "@/components/sales/proposal-form";
import { can } from "@/lib/access/can";
import { createProposalAction } from "@/lib/actions/sales";
import { requireModule } from "@/lib/context/current-user";
import { proposalOpportunityOptions } from "@/lib/modules/sales/sales.options";

export const metadata: Metadata = { title: "New proposal" };

/** Draft a commercial offer (PRD #17 §113, §114). */
export default async function NewProposalPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule("sales");
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
          { label: "Sales", href: "/sales" },
          { label: "Proposals", href: "/sales/proposals" },
          { label: "New proposal" },
        ]}
        title="New proposal"
        subtitle="A commercial offer against one opportunity. It is not an invoice."
      />

      {opportunities.length === 0 ? (
        <p className="nesto-card p-5 text-table text-fg-muted">
          There is no open opportunity with a client attached. A proposal has to be addressed to
          somebody, so link a client to the deal first.
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
          submitLabel="Create proposal"
          pendingLabel="Creating…"
        />
      )}
    </div>
  );
}
