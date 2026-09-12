import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AmendmentActions } from "@/components/contracts/amendment-actions";
import { ContractApprovalHistory } from "@/components/contracts/approval-history";
import { ContractRecordDocuments } from "@/components/contracts/record-documents";
import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { SkeletonTable } from "@/components/ui/loading-state";
import { AccessError } from "@/lib/access/guards";
import { formatAmount } from "@/lib/modules/finance/finance.currency";
import * as amendments from "@/lib/modules/contracts/amendments/amendment.service";
import { formatDate } from "@/lib/utils/format";
import { contractBreadcrumbs, contractContext } from "../../contract-context";

type Params = { params: Promise<{ contractId: string; amendmentId: string }> };

export const metadata: Metadata = { title: "Amendment" };

/**
 * One amendment (PRD #18 §160–§163, §169–§175).
 *
 * The before and after are shown side by side, because "new value €820,000" on
 * its own does not say whether that is a rise or a cut. The figures come from
 * the service already redacted: a reader without commercial permission gets
 * `commercial: null` and sees no money at all (PRD #18 §260).
 */
export default async function AmendmentDetailPage({ params }: Params) {
  const { contractId, amendmentId } = await params;
  const { context, contract } = await contractContext(contractId);

  if (!contract.capabilities.canViewAmendments) notFound();

  let amendment;
  try {
    amendment = await amendments.getAmendment(context, amendmentId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  // An amendment reached through the wrong contract's URL is not found, rather
  // than quietly rendering under a contract it does not belong to.
  if (amendment.contractId !== contract.id) notFound();

  const currency = contract.commercial?.currency ?? null;
  const money = (value: string | null) =>
    value === null || currency === null ? "—" : formatAmount(value, currency);

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={contractBreadcrumbs(contract, amendment.amendmentNumber)}
        title={amendment.title}
        subtitle={`${contract.contractNumber} · ${amendment.amendmentNumber}`}
        status={amendment.status}
        actions={<AmendmentActions contractId={contract.id} amendment={amendment} />}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">Summary</h2>
            <p className="mt-2 whitespace-pre-wrap text-table text-fg">{amendment.summary}</p>
          </section>

          {/* What changes, before and after (PRD #18 §167, §168, §332). */}
          {amendment.commercial || amendment.newExpiryDate ? (
            <section className="nesto-card p-5">
              <h2 className="text-card font-semibold text-fg">What this changes</h2>
              <DetailGrid
                className="mt-4"
                columns={3}
                items={[
                  ...(amendment.commercial
                    ? [
                        {
                          label: "Value before",
                          value: money(amendment.commercial.previousContractValue),
                        },
                        {
                          label: "Value after",
                          value: money(amendment.commercial.newContractValue),
                        },
                        {
                          label: "Change",
                          value: money(amendment.commercial.valueDelta),
                        },
                      ]
                    : []),
                  ...(amendment.newExpiryDate
                    ? [
                        {
                          label: "Expiry before",
                          value: amendment.previousExpiryDate
                            ? formatDate(amendment.previousExpiryDate)
                            : "—",
                        },
                        {
                          label: "Expiry after",
                          value: formatDate(amendment.newExpiryDate),
                        },
                      ]
                    : []),
                ]}
              />
              {amendment.status !== "ACTIVE" ? (
                <p className="mt-4 border-t border-line pt-4 text-meta text-fg-subtle">
                  Nothing has changed on the contract yet. The value and expiry move when this
                  amendment is activated.
                </p>
              ) : null}
            </section>
          ) : null}

          <section className="space-y-3">
            <h2 className="text-card font-semibold text-fg">Approval history</h2>
            <ContractApprovalHistory
              approvals={amendment.approvals}
              emptyLabel="This amendment has not been submitted for approval."
            />
          </section>

          {contract.capabilities.canViewDocuments ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Documents</h2>
              <Suspense fallback={<SkeletonTable rows={2} />}>
                <ContractRecordDocuments
                  context={context}
                  entityType="amendment"
                  entityId={amendment.id}
                  emptyDescription="The signed amendment and any supporting papers appear here."
                />
              </Suspense>
            </section>
          ) : null}
        </div>

        <div className="space-y-4">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">Dates</h2>
            <dl className="mt-4 space-y-3">
              <Meta
                label="Effective"
                value={amendment.effectiveDate ? formatDate(amendment.effectiveDate) : "—"}
              />
              <Meta
                label="Signed"
                value={amendment.signedDate ? formatDate(amendment.signedDate) : "—"}
              />
              <Meta
                label="Activated"
                value={amendment.activatedAt ? formatDate(amendment.activatedAt) : "—"}
              />
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="nesto-eyebrow text-fg-subtle">{label}</dt>
      <dd className="mt-0.5 text-table text-fg">{value}</dd>
    </div>
  );
}
