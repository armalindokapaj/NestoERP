import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import Link from "@/components/navigation/nav-link";
import { notFound } from "next/navigation";
import { FileStack } from "lucide-react";

import { commercialLabel } from "@/components/contracts/contract-format";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import * as amendments from "@/lib/modules/contracts/amendments/amendment.service";
import { amendmentStatusLabels } from "@/lib/modules/contracts/amendments/amendment.status";
import { formatDate } from "@/lib/utils/format";
import { contractsLabel } from "@/lib/i18n/modules/contracts/labels";
import { contractContext } from "../../contract-context";

type Params = { params: Promise<{ contractId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("contracts");
  return { title: t("meta.amendments") };
}

/**
 * How the agreement has changed since it was signed (PRD #18 §159–§165).
 *
 * The original contract is never rewritten. An amendment records what changed,
 * who agreed to it and when it took effect, and the contract's own value and
 * expiry move only when an amendment is activated (PRD #18 §333).
 */
export default async function ContractAmendmentsPage({ params }: Params) {
  const { contractId } = await params;
  const { context, contract } = await contractContext(contractId);

  if (!contract.capabilities.canViewAmendments) notFound();

  const [rows, t] = await Promise.all([amendments.listForContract(context, contractId), getTranslations("contracts")]);
  const mayCreate = contract.capabilities.canCreateAmendment;
  const createHref = `/contracts/${contract.id}/amendments/new`;

  return (
    <div className="space-y-5">
      {rows.length === 0 ? (
        <EmptyState
          icon={<FileStack />}
          title={t("amendments.emptyTitle")}
          description={t("amendments.emptyDescription")}
          action={mayCreate ? { label: t("amendments.newAmendment"), href: createHref } : undefined}
        />
      ) : (
        <ul className="nesto-card divide-y divide-line">
          {rows.map((amendment) => {
            const value = commercialLabel(
              amendment.commercial
                ? {
                    currency: contract.commercial?.currency ?? null,
                    contractValue: amendment.commercial.newContractValue,
                  }
                : null,
              t,
            );
            return (
              <li
                key={amendment.id}
                className="flex flex-wrap items-start justify-between gap-3 p-5"
              >
                <div className="min-w-0 space-y-1">
                  <Link
                    href={`/contracts/${contract.id}/amendments/${amendment.id}`}
                    className="text-table font-medium text-accent-strong"
                  >
                    {amendment.amendmentNumber} — {amendment.title}
                  </Link>
                  <p className="text-meta text-fg-subtle">
                    {amendment.effectiveDate
                      ? t("amendments.effective", { date: formatDate(amendment.effectiveDate) })
                      : t("amendments.noEffective")}
                    {value ? t("amendments.newValue", { value }) : ""}
                    {amendment.newExpiryDate
                      ? t("amendments.newExpiry", { date: formatDate(amendment.newExpiryDate) })
                      : ""}
                  </p>
                </div>
                <Badge tone={amendment.status === "ACTIVE" ? "success" : "neutral"}>
                  {contractsLabel(t, "amendmentStatus", amendment.status, amendmentStatusLabels[amendment.status])}
                </Badge>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
