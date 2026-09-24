import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";

import { CollaborationPanel } from "@/components/collaboration/collaboration-panel";
import { ApprovalHistory } from "@/components/finance/approval-history";
import { CommitmentActions } from "@/components/finance/commitment-actions";
import { Money } from "@/components/finance/money";
import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { PersonLink } from "@/components/people/person-link";
import { Badge } from "@/components/ui/badge";
import { expenseCategoryLabels } from "@/lib/modules/finance/expenses/expense.status";
import { formatDate, orDash } from "@/lib/utils/format";
import { commitmentBreadcrumbs, commitmentLabel, loadCommitment } from "./commitment-context";
import { FinanceRecordTabs } from "../../invoices/[invoiceId]/record-tabs";

type Params = { params: Promise<{ commitmentId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { commitmentId } = await params;
  try {
    const { commitment } = await loadCommitment(commitmentId);
    return { title: commitmentLabel(commitment) };
  } catch {
    return { title: "Commitment" };
  }
}

/**
 * Commitment detail (PRD #15 §180).
 *
 * Only an approved, still-open commitment counts toward forecast cost. Closing
 * it is how it stops counting once the work has happened and become an expense
 * (PRD #15 §119, §134).
 */
export default async function CommitmentDetailPage({ params }: Params) {
  const { commitmentId } = await params;
  const { commitment } = await loadCommitment(commitmentId);

  const may = commitment.capabilities;

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={commitmentBreadcrumbs(commitment)}
        title={commitment.description}
        subtitle={commitment.reference ?? undefined}
        status={commitment.status}
        badges={
          <>
            <Badge tone="neutral">{expenseCategoryLabels[commitment.category]}</Badge>
            {commitment.source.module ? (
              <Badge tone="default">Owned by {commitment.source.module}</Badge>
            ) : null}
          </>
        }
        meta={[
          {
            label: "Amount",
            value: <Money amount={commitment.amount} currency={commitment.currency} emphasis />,
          },
          {
            label: "Expected",
            value: commitment.expectedDate ? formatDate(commitment.expectedDate) : "—",
          },
          {
            label: "Counts toward forecast",
            value: commitment.status === "APPROVED" ? "Yes" : "No",
          },
        ]}
        actions={
          <CommitmentActions
            commitmentId={commitment.id}
            label={commitmentLabel(commitment)}
            capabilities={may}
          />
        }
      />

      <FinanceRecordTabs
        basePath={`/finance/commitments/${commitment.id}`}
        active="overview"
        show={{ documents: may.canViewDocuments, activity: may.canViewActivity }}
      />

      {commitment.source.module ? (
        <p className="rounded-md border border-line bg-surface-2 px-4 py-3 text-table text-fg-muted">
          This commitment was created by {commitment.source.module}. Its amount is changed there,
          so Finance and that module never hold two numbers for one obligation.
        </p>
      ) : null}

      {commitment.status === "CLOSED" ? (
        <p className="rounded-md border border-line bg-surface-2 px-4 py-3 text-table text-fg-muted">
          Closed, so it no longer contributes to forecast cost. It stays here as history.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="nesto-card p-5 lg:col-span-2">
          <h2 className="text-card font-semibold text-fg">Details</h2>
          <DetailGrid
            className="mt-4"
            items={[
              {
                label: "Project",
                value: commitment.project ? (
                  <Link href={`/projects/${commitment.project.id}`} className="hover:text-accent">
                    {commitment.project.name}
                  </Link>
                ) : (
                  "Company-wide"
                ),
              },
              { label: "Counterparty", value: orDash(commitment.counterpartyName) },
              { label: "Category", value: expenseCategoryLabels[commitment.category] },
              { label: "Currency", value: commitment.currency },
              {
                label: "Expected",
                value: commitment.expectedDate ? formatDate(commitment.expectedDate) : "—",
              },
              { label: "Raised by", value: commitment.createdBy ? <PersonLink memberId={commitment.createdBy.memberId} name={commitment.createdBy.fullName} /> : "—" },
            ]}
          />

          {commitment.notes ? (
            <div className="mt-4 border-t border-line pt-4">
              <h3 className="text-table font-medium text-fg">Notes</h3>
              <p className="mt-1 whitespace-pre-wrap text-table text-fg-muted">
                {commitment.notes}
              </p>
            </div>
          ) : null}
        </section>

        <section className="nesto-card p-5">
          <h2 className="text-card font-semibold text-fg">Approvals</h2>
          <ApprovalHistory approvals={commitment.approvals} />
        </section>
      </div>
      {/* Discussion on this record: comments, mentions, watchers (PRD #38 §36). */}
      <CollaborationPanel parentType="commitment" parentId={commitmentId} />
    </div>
  );
}
