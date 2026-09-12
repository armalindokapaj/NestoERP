import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ContractForm } from "@/components/contracts/contract-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { createContractAction } from "@/lib/actions/contracts";
import { canSeeCommercial, canSeeConfidential } from "@/lib/modules/contracts/contract.dto";
import * as contracts from "@/lib/modules/contracts/contracts/contract.service";

export const metadata: Metadata = { title: "New contract" };

/**
 * Draft a contract (PRD #18 §94–§99).
 *
 * Every contract starts as a DRAFT. The form has no status field at all: status
 * moves through named lifecycle actions and nowhere else, so there is nothing
 * here for a browser to lie about (PRD #18 §192, §269).
 *
 * Query parameters prefill the form and decide nothing. They arrive from the
 * Sales handoff and from the Client and Project tabs, and the service validates
 * each one against the caller's own access to that record before it saves —
 * a link naming a client they cannot reach is refused, not honoured
 * (PRD #18 §269, §366, §369).
 */
export default async function NewContractPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule("contracts");
  if (!can(context, "legal.contract.create")) notFound();

  const [options, params] = await Promise.all([
    contracts.contractFormOptions(context),
    searchParams,
  ]);

  const one = (key: string): string | null => {
    const value = params[key];
    return typeof value === "string" && value.trim() !== "" ? value : null;
  };

  // The commercial and confidential sections render only for a reader who holds
  // the grant behind them — a form that shows an empty "Legal notes" box to
  // somebody who cannot read legal notes would blank the field on save
  // (PRD #18 §22, §23).
  const commercial = canSeeCommercial(context);
  const confidential = canSeeConfidential(context);

  // The owner defaults to whoever is drafting, when they are a selectable
  // owner themselves (PRD #18 §52).
  const defaultOwner =
    options.owners.find((owner) => owner.id === context.membershipId)?.id ??
    options.owners[0]?.id ??
    "";

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "Legal", href: "/contracts" },
          { label: "Contracts", href: "/contracts/all" },
          { label: "New contract" },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">New contract</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          An agreement your company is party to. It is saved as a draft — the terms stay
          editable until it is approved.
        </p>
      </div>

      <ContractForm
        action={createContractAction}
        cancelHref="/contracts/all"
        submitLabel="Create contract"
        pendingLabel="Creating…"
        canEditCommercial={commercial}
        canEditConfidential={confidential}
        owners={options.owners.map((owner) => ({
          value: owner.id,
          label: `${owner.user.firstName} ${owner.user.lastName}`,
        }))}
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
          contractNumber: "",
          title: one("title") ?? "",
          contractType: "CLIENT_AGREEMENT",
          ownerMemberId: defaultOwner,
          clientId: one("clientId"),
          projectId: one("projectId"),
          opportunityId: one("opportunityId"),
          proposalId: one("proposalId"),
          counterpartyName: null,
          currency: commercial ? one("currency") : null,
          contractValue: commercial ? one("contractValue") : null,
          effectiveDate: null,
          expiryDate: null,
          signedDate: null,
          renewalType: "NONE",
          renewalNoticeDays: null,
          autoRenewalPeriodMonths: null,
          governingLaw: null,
          jurisdiction: null,
          summary: null,
          commercialNotes: null,
          legalNotes: null,
        }}
      />
    </div>
  );
}
