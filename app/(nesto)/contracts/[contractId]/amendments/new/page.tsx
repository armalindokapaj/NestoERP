import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AmendmentForm } from "@/components/contracts/amendment-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { saveAmendmentAction } from "@/lib/actions/contracts";
import { canSeeCommercial } from "@/lib/modules/contracts/contract.dto";
import { contractBreadcrumbs, contractContext } from "../../contract-context";

type Params = { params: Promise<{ contractId: string }> };

export const metadata: Metadata = { title: "New amendment" };

/**
 * Draft an amendment (PRD #18 §165, §166).
 *
 * It starts as a draft and changes nothing on its own: the contract's value and
 * expiry move only when the amendment is approved, signed and activated, and
 * only once (PRD #18 §167, §174, §511).
 */
export default async function NewAmendmentPage({ params }: Params) {
  const { contractId } = await params;
  const { context, contract } = await contractContext(contractId);

  if (!contract.capabilities.canCreateAmendment) notFound();

  async function action(formData: FormData) {
    "use server";
    return saveAmendmentAction(contractId, null, formData);
  }

  return (
    <div className="space-y-5">
      <Breadcrumbs items={contractBreadcrumbs(contract, "New amendment")} />

      <div>
        <h1 className="text-page font-semibold text-fg">New amendment</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          {contract.contractNumber} — {contract.title}
        </p>
      </div>

      <AmendmentForm
        action={action}
        cancelHref={`/contracts/${contract.id}/amendments`}
        submitLabel="Create amendment"
        pendingLabel="Creating…"
        canEditCommercial={canSeeCommercial(context)}
        requireReductionAcknowledgement={false}
        contract={{
          contractNumber: contract.contractNumber,
          currency: contract.commercial?.currency ?? null,
          contractValue: contract.commercial?.contractValue ?? null,
          expiryDate: contract.dates.expiryDate,
        }}
      />
    </div>
  );
}
