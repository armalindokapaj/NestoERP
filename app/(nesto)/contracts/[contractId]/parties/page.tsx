import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { notFound } from "next/navigation";

import { ContractPartyList } from "@/components/contracts/party-list";
import { RecordContextHeader } from "@/components/modules/record-header";
import * as parties from "@/lib/modules/contracts/parties/party.service";
import { contractBreadcrumbs, contractContext } from "../contract-context";
import { ContractTabs } from "../contract-tabs";

type Params = { params: Promise<{ contractId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("contracts");
  return { title: t("meta.parties") };
}

/**
 * Who the agreement is between (PRD #18 §136–§147).
 *
 * A party is a snapshot of what the agreement said, not a live view of the
 * client record: renaming the customer afterwards must not rewrite who signed
 * (PRD #18 §141, §329).
 */
export default async function ContractPartiesPage({ params }: Params) {
  const { contractId } = await params;
  const { context, contract } = await contractContext(contractId);
  const t = await getTranslations("contracts");

  if (!contract.capabilities.canViewParties) notFound();

  const [rows, clients] = await Promise.all([
    parties.listParties(context, contractId),
    parties.partyClientOptions(context),
  ]);

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={contractBreadcrumbs(contract, t("crumbs.parties"), t)}
        title={contract.title}
        subtitle={contract.contractNumber}
        status={contract.status}
      />

      <ContractTabs
        contractId={contract.id}
        active="parties"
        capabilities={contract.capabilities}
      />

      <ContractPartyList
        contractId={contract.id}
        parties={rows}
        canManage={contract.capabilities.canManageParties}
        canRemove={contract.capabilities.canRemoveParties}
        clients={clients}
      />
    </div>
  );
}
