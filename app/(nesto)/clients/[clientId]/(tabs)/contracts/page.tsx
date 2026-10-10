import { getTranslations } from "@/lib/i18n/server";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Scale } from "lucide-react";

import { ContractTable } from "@/components/contracts/contract-table";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import * as contracts from "@/lib/modules/contracts/contracts/contract.service";
import { loadClient } from "../../client-context";

type Params = { params: Promise<{ clientId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("clients"))("meta.contracts") };
}

/**
 * The agreements held with one client (PRD #18 §10, §439).
 *
 * Client access alone does not open this tab. It needs a legal permission as
 * well, and what it then lists is narrowed again by the reader's own contract
 * scope — so a project manager sees the agreements on jobs they run and not the
 * framework agreement above them (PRD #18 §251, §440).
 *
 * The list is the canonical Contract record, read through the same service the
 * module's own pages use. There is no client-specific contract table.
 */
export default async function ClientContractsPage({ params }: Params) {
  const { clientId } = await params;
  const { context, client } = await loadClient(clientId);

  if (!client.capabilities.canViewContracts) notFound();
  const t = await getTranslations("clients");

  const rows = await contracts.listForClient(context, clientId);

  // "New contract" preselects this client, which the create form then validates
  // against the caller's own client access rather than trusting the link
  // (PRD #18 §369).
  const createHref = `/contracts/new?clientId=${client.id}`;
  const mayCreate = can(context, "legal.contract.create");

  return (
    <div className="space-y-5">
      {rows.length === 0 ? (
        <EmptyState
          icon={<Scale />}
          title={t("contractsPage.emptyTitle")}
          description={t("contractsPage.emptyDescription")}
          action={mayCreate ? { label: t("contractsPage.newContract"), href: createHref } : undefined}
        />
      ) : (
        <ContractTable
          contracts={rows}
          showClient={false}
          caption={t("contractsPage.caption", { name: client.name })}
        />
      )}
    </div>
  );
}
