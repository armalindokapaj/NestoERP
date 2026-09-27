import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { notFound } from "next/navigation";

import { AmendmentForm } from "@/components/contracts/amendment-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { AccessError } from "@/lib/access/guards";
import { saveAmendmentAction } from "@/lib/actions/contracts";
import { canSeeCommercial } from "@/lib/modules/contracts/contract.dto";
import * as amendments from "@/lib/modules/contracts/amendments/amendment.service";
import { contractBreadcrumbs, contractContext } from "../../../contract-context";

type Params = { params: Promise<{ contractId: string; amendmentId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("contracts");
  return { title: t("meta.editAmendment") };
}

/**
 * Revise a draft amendment (PRD #18 §166, §178).
 *
 * Only while it is still a draft. An active amendment is immutable — it has
 * already moved the contract's terms, and editing it afterwards would rewrite
 * what both sides agreed to (PRD #18 §177).
 */
export default async function EditAmendmentPage({ params }: Params) {
  const { contractId, amendmentId } = await params;
  const { context, contract } = await contractContext(contractId);
  const t = await getTranslations("contracts");

  if (!contract.capabilities.canViewAmendments) notFound();

  let amendment;
  try {
    amendment = await amendments.getAmendment(context, amendmentId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  if (amendment.contractId !== contract.id) notFound();
  if (!amendment.capabilities.canEdit) notFound();

  async function action(formData: FormData) {
    "use server";
    return saveAmendmentAction(contractId, amendmentId, formData);
  }

  return (
    <div className="space-y-5">
      <Breadcrumbs items={contractBreadcrumbs(contract, t("crumbs.amendmentEdit", { number: amendment.amendmentNumber }), t)} />

      <div>
        <h1 className="text-page font-semibold text-fg">{t("meta.editAmendment")}</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          {contract.contractNumber} — {amendment.amendmentNumber}
        </p>
      </div>

      <AmendmentForm
        action={action}
        cancelHref={`/contracts/${contract.id}/amendments/${amendment.id}`}
        submitLabel={t("common.saveChanges")}
        pendingLabel={t("common.saving")}
        versionUpdatedAt={amendment.updatedAt}
        canEditCommercial={canSeeCommercial(context)}
        requireReductionAcknowledgement={false}
        contract={{
          contractNumber: contract.contractNumber,
          currency: contract.commercial?.currency ?? null,
          contractValue: contract.commercial?.contractValue ?? null,
          expiryDate: contract.dates.expiryDate,
        }}
        values={{
          amendmentNumber: amendment.amendmentNumber,
          title: amendment.title,
          summary: amendment.summary,
          effectiveDate: amendment.effectiveDate,
          newContractValue: amendment.commercial?.newContractValue ?? null,
          newExpiryDate: amendment.newExpiryDate,
        }}
      />
    </div>
  );
}
