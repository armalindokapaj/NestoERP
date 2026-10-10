import { RecordFavorite } from "@/components/productivity/record-favorite";
import { ContractActions } from "@/components/contracts/contract-actions";
import { commercialLabel, expiryLabel } from "@/components/contracts/contract-format";
import { RecordHeader } from "@/components/modules/record-header";
import { PersonLink } from "@/components/people/person-link";
import { Badge } from "@/components/ui/badge";
import { contractTypeLabels } from "@/lib/modules/contracts/contracts/contract.schema";
import { orDash } from "@/lib/utils/format";
import { contractBreadcrumbs, contractContext } from "../contract-context";
import { ContractTabs } from "../contract-tabs";
import { pendingCycle } from "@/lib/modules/contracts/approvals/approval.service";
import { contractsLabel } from "@/lib/i18n/modules/contracts/labels";
import { getTranslations } from "@/lib/i18n/server";

type Params = { params: Promise<{ contractId: string }> };

/** The record's frame: header and tabs stay mounted while the tab content swaps beneath them. */
export default async function ContractTabsLayout({ children, params }: Params & { children: React.ReactNode }) {
  const { contractId } = await params;
  const { context, contract } = await contractContext(contractId);
  const t = await getTranslations("contracts");
  const may = contract.capabilities;
  // The cycle the decision controls act on; they name it back (AUD-10 §4, CW-05).
  const cycle = may.canApprove || may.canReject ? await pendingCycle(context, "CONTRACT", contract.id) : null;
  const value = commercialLabel(contract.commercial, t);

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={contractBreadcrumbs(contract, undefined, t)}
        title={contract.title}
        subtitle={contract.contractNumber}
        status={contract.status}
        badges={
          <>
            <Badge tone="neutral">{contractsLabel(t, "contractType", contract.contractType, contractTypeLabels[contract.contractType])}</Badge>
            {/* Attention badges are derived at read time, never stored (PRD #18 §102, §193). */}
            {contract.attention.expiringSoon ? <Badge tone="warning">{t("detail.expiringSoon")}</Badge> : null}
            {contract.attention.renewalNoticeDue ? (
              <Badge tone="warning">{t("detail.renewalNoticeDue")}</Badge>
            ) : null}
            {contract.attention.unsigned ? <Badge tone="info">{t("detail.unsigned")}</Badge> : null}
            {contract.attention.readyToActivate ? (
              <Badge tone="info">{t("detail.readyToActivate")}</Badge>
            ) : null}
            {contract.attention.overdueObligations > 0 ? (
              <Badge tone="danger">
                {t("detail.overdueObligations", { count: contract.attention.overdueObligations })}
              </Badge>
            ) : null}
          </>
        }
        meta={[
          {
            label: t("detail.owner"),
            value: (
              <span className="flex items-center gap-2">
                <PersonLink memberId={contract.owner.memberId} name={contract.owner.fullName} />
                {/* An inactive owner is a real operational problem, not cosmetic (PRD #18 §323). */}
                {contract.attention.ownerInactive ? <Badge tone="warning">{t("detail.inactive")}</Badge> : null}
              </span>
            ),
          },
          {
            label: t("detail.counterparty"),
            value: orDash(contract.counterpartyName),
          },
          ...(value ? [{ label: t("detail.value"), value }] : []),
          { label: t("detail.expiry"), value: expiryLabel(contract.attention.daysToExpiry, t) },
        ]}
        actions={
          <>
            <RecordFavorite context={context} entityType="contract" entityId={contract.id} />
            <ContractActions contract={contract} cycle={cycle} />
          </>
        }
      />

      <ContractTabs contractId={contract.id} capabilities={may} />

      {children}
    </div>
  );
}
