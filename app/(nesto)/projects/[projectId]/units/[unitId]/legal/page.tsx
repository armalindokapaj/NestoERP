import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { redirect } from "next/navigation";

import { UnitLegalPanel } from "@/components/contracts/unit-contract/unit-legal-panel";
import { RecordDocuments } from "@/components/documents/record-documents";
import { legalCapabilities } from "@/lib/modules/contracts/units/sale-contract";
import { getUnitLegal } from "@/lib/modules/contracts/units/unit-contract.service";
import { loadUnitPage, UnitShell } from "../unit-page";

type Params = { params: Promise<{ projectId: string; unitId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("projects"))("unitPage.contractTitle") };
}

/**
 * The unit's contract, on the unit's own page (E-05F §49, §104): no Legal copy of
 * the unit. The contract's documents are the Contract's canonical files, listed
 * here through Legal's own document door, never copied to the unit (§16, §52).
 */
export default async function UnitLegalPage({ params, searchParams }: Params) {
  const { projectId, unitId } = await params;
  const action = (await searchParams).action;
  const page = await loadUnitPage(projectId, unitId);
  const t = await getTranslations("projects");
  if (!legalCapabilities(page.context).canView) redirect("/access-denied");
  const legal = await getUnitLegal(page.context, page.unit.id);
  const documents = legal.contract ? (
    <section className="nesto-card p-5" data-testid="contract-documents">
      <RecordDocuments
        context={page.context}
        entityType="contract"
        entityId={legal.contract.id}
        canAttach={legal.capabilities.canManageDocuments && legal.contract.live}
        title={t("unitPage.contractDocuments")}
        emptyTitle={t("unitPage.noContractDocuments")}
        emptyDescription={t("unitPage.contractDocumentsBody")}
      />
    </section>
  ) : null;
  return (
    <UnitShell page={page} active="legal">
      <UnitLegalPanel legal={legal} documents={documents} initialAction={typeof action === "string" ? action : null} />
    </UnitShell>
  );
}
