import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { notFound } from "next/navigation";
import { FileStack } from "lucide-react";

import { commercialLabel } from "@/components/contracts/contract-format";
import { RecordContextHeader } from "@/components/modules/record-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import * as amendments from "@/lib/modules/contracts/amendments/amendment.service";
import { amendmentStatusLabels } from "@/lib/modules/contracts/amendments/amendment.status";
import { formatDate } from "@/lib/utils/format";
import { contractBreadcrumbs, contractContext } from "../contract-context";
import { ContractTabs } from "../contract-tabs";

type Params = { params: Promise<{ contractId: string }> };

export const metadata: Metadata = { title: "Contract amendments" };

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

  const rows = await amendments.listForContract(context, contractId);
  const mayCreate = contract.capabilities.canCreateAmendment;
  const createHref = `/contracts/${contract.id}/amendments/new`;

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={contractBreadcrumbs(contract, "Amendments")}
        title={contract.title}
        subtitle={contract.contractNumber}
        status={contract.status}
        actions={
          mayCreate ? (
            <Button asChild size="sm">
              <Link href={createHref}>New amendment</Link>
            </Button>
          ) : null
        }
      />

      <ContractTabs
        contractId={contract.id}
        active="amendments"
        capabilities={contract.capabilities}
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={<FileStack />}
          title="No amendments."
          description="Changes agreed after signature are recorded here, each with its own approval."
          action={mayCreate ? { label: "New amendment", href: createHref } : undefined}
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
                      ? `Effective ${formatDate(amendment.effectiveDate)}`
                      : "No effective date yet"}
                    {value ? ` · new value ${value}` : ""}
                    {amendment.newExpiryDate
                      ? ` · new expiry ${formatDate(amendment.newExpiryDate)}`
                      : ""}
                  </p>
                </div>
                <Badge tone={amendment.status === "ACTIVE" ? "success" : "neutral"}>
                  {amendmentStatusLabels[amendment.status]}
                </Badge>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
