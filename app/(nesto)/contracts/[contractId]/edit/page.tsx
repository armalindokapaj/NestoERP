import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ContractForm, ContractMetadataForm } from "@/components/contracts/contract-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { updateContractAction } from "@/lib/actions/contracts";
import { canSeeCommercial, canSeeConfidential } from "@/lib/modules/contracts/contract.dto";
import * as contracts from "@/lib/modules/contracts/contracts/contract.service";
import { contractEditMode } from "@/lib/modules/contracts/contracts/contract.status";
import { contractBreadcrumbs, contractContext } from "../contract-context";

type Params = { params: Promise<{ contractId: string }> };

export const metadata: Metadata = { title: "Edit contract" };

/**
 * Edit a contract (PRD #18 §104–§107).
 *
 * How much of it opens depends on where it is in its life:
 *
 *   DRAFT / IN_REVIEW   the whole agreement — it is still being written
 *   APPROVED → ACTIVE   owner and internal summary only
 *   anything else       nothing; the record is closed or under decision
 *
 * An approved contract's terms are immutable on purpose. Changing the value of
 * something both sides agreed to, by editing a form, would leave no record that
 * anybody consented — so terms change by amendment, which does (PRD #18 §106).
 *
 * The service enforces the same rule again. This page decides which form to
 * draw, not what is allowed.
 */
export default async function EditContractPage({ params }: Params) {
  const { contractId } = await params;
  const { context, contract } = await contractContext(contractId);

  if (!contract.capabilities.canEdit) notFound();

  const mode = contractEditMode(contract.status);
  if (mode === "NONE") notFound();

  const options = await contracts.contractEditOptions(context);
  const owners = options.owners.map((owner) => ({
    value: owner.id,
    label: `${owner.user.firstName} ${owner.user.lastName}`,
  }));

  async function action(formData: FormData) {
    "use server";
    return updateContractAction(contractId, formData);
  }

  const breadcrumbs = contractBreadcrumbs(contract, "Edit");
  const cancelHref = `/contracts/${contract.id}`;

  // Approved and beyond: the small correction form. It posts no contract
  // number, which is how the action knows to take the metadata path
  // (PRD #18 §107).
  if (mode === "METADATA") {
    return (
      <div className="space-y-5">
        <Breadcrumbs items={breadcrumbs} />
        <div>
          <h1 className="text-page font-semibold text-fg">Edit contract</h1>
          <p className="mt-1.5 text-body text-fg-muted">
            {contract.contractNumber} — {contract.title}
          </p>
        </div>
        <ContractMetadataForm
          action={action}
          owners={owners}
          versionUpdatedAt={contract.updatedAt}
          cancelHref={cancelHref}
          values={{
            ownerMemberId: contract.owner.memberId,
            summary: contract.legal.summary,
          }}
        />
      </div>
    );
  }

  const commercial = canSeeCommercial(context);
  const confidential = canSeeConfidential(context);

  return (
    <div className="space-y-5">
      <Breadcrumbs items={breadcrumbs} />

      <div>
        <h1 className="text-page font-semibold text-fg">Edit contract</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          {contract.contractNumber} — {contract.title}
        </p>
      </div>

      <ContractForm
        action={action}
        cancelHref={cancelHref}
        submitLabel="Save changes"
        pendingLabel="Saving…"
        versionUpdatedAt={contract.updatedAt}
        canEditCommercial={commercial}
        canEditConfidential={confidential}
        owners={owners}
        clients={options.clients.map((client) => ({ value: client.id, label: client.name }))}
        projects={options.projects.map((project) => ({
          value: project.id,
          label: `${project.code} — ${project.name}`,
        }))}
        opportunities={options.opportunities.map((opportunity) => ({
          value: opportunity.id,
          label: opportunity.name,
        }))}
        proposals={options.proposals.map((proposal) => ({
          value: proposal.id,
          label: `${proposal.proposalNumber} — ${proposal.title}`,
        }))}
        values={{
          contractNumber: contract.contractNumber,
          title: contract.title,
          contractType: contract.contractType,
          ownerMemberId: contract.owner.memberId,
          clientId: contract.client?.id ?? null,
          projectId: contract.project?.id ?? null,
          opportunityId: contract.salesSource?.opportunity?.id ?? null,
          proposalId: contract.salesSource?.proposal?.id ?? null,
          counterpartyName: contract.counterpartyName,
          // Absent for a reader without the grant, so the form cannot blank a
          // figure it was never shown (PRD #18 §22).
          currency: contract.commercial?.currency ?? null,
          contractValue: contract.commercial?.contractValue ?? null,
          effectiveDate: contract.dates.effectiveDate,
          expiryDate: contract.dates.expiryDate,
          signedDate: contract.dates.signedDate,
          renewalType: contract.renewal.type,
          renewalNoticeDays:
            contract.renewal.noticeDays === null ? null : String(contract.renewal.noticeDays),
          autoRenewalPeriodMonths:
            contract.renewal.autoRenewalPeriodMonths === null
              ? null
              : String(contract.renewal.autoRenewalPeriodMonths),
          governingLaw: contract.legal.governingLaw,
          jurisdiction: contract.legal.jurisdiction,
          summary: contract.legal.summary,
          commercialNotes: contract.commercialNotes,
          legalNotes: contract.legal.legalNotes,
        }}
      />
    </div>
  );
}
