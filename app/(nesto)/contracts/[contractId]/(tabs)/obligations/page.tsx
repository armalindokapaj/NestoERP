import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { notFound } from "next/navigation";

import { ContractObligationList } from "@/components/contracts/obligation-list";
import * as obligations from "@/lib/modules/contracts/obligations/obligation.service";
import { contractContext } from "../../contract-context";

type Params = { params: Promise<{ contractId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("contracts");
  return { title: t("meta.obligations") };
}

/**
 * What the agreement requires (PRD #18 §148–§158).
 *
 * An obligation is the requirement; a Task is work somebody does to satisfy it
 * and lives in Tasks with every other piece of work. Overdue is derived from
 * the due date at read time and never stored (PRD #18 §154, §152).
 */
export default async function ContractObligationsPage({ params }: Params) {
  const { contractId } = await params;
  const { context, contract } = await contractContext(contractId);
  const t = await getTranslations("contracts");

  if (!contract.capabilities.canViewObligations) notFound();

  const [rows, members] = await Promise.all([
    obligations.listForContract(context, contractId),
    obligations.responsibleOptions(context),
  ]);

  return (
    <div className="space-y-5">
      <ContractObligationList
        contractId={contract.id}
        obligations={rows}
        canCreate={contract.capabilities.canCreateObligation}
        members={members}
      />
    </div>
  );
}
