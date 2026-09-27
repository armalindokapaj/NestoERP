import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";

import { CollaborationPanel } from "@/components/collaboration/collaboration-panel";
import { ApprovalHistory } from "@/components/finance/approval-history";
import { CommitmentActions } from "@/components/finance/commitment-actions";
import { Money } from "@/components/finance/money";
import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { PersonLink } from "@/components/people/person-link";
import { Badge } from "@/components/ui/badge";
import { getTranslations } from "@/lib/i18n/server";
import { pendingCycle } from "@/lib/modules/finance/approvals/approval.service";
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
    return { title: (await getTranslations("finance"))("kind.commitment") };
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
  const { context, commitment } = await loadCommitment(commitmentId);

  const may = commitment.capabilities;
  const t = await getTranslations("finance");
  // The cycle the decision controls act on; they name it back (AUD-10 §4, CW-05).
  const cycle = may.canApprove || may.canReject ? await pendingCycle(context, "COMMITMENT", commitment.id) : null;

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={await commitmentBreadcrumbs(commitment)}
        title={commitment.description}
        subtitle={commitment.reference ?? undefined}
        status={commitment.status}
        badges={
          <>
            <Badge tone="neutral">{t(`category.${commitment.category}`)}</Badge>
            {commitment.source.module ? (
              <Badge tone="default">{t("commitments.ownedBy", { module: commitment.source.module })}</Badge>
            ) : null}
          </>
        }
        meta={[
          {
            label: t("form.amount"),
            value: <Money amount={commitment.amount} currency={commitment.currency} emphasis />,
          },
          {
            label: t("columns.expected"),
            value: commitment.expectedDate ? formatDate(commitment.expectedDate) : "—",
          },
          {
            label: t("commitments.countsToward"),
            value: commitment.status === "APPROVED" ? t("commitments.yes") : t("commitments.no"),
          },
        ]}
        actions={
          <CommitmentActions
            commitmentId={commitment.id}
            label={commitmentLabel(commitment)}
            capabilities={may}
            cycle={cycle}
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
          {t("commitments.sourcedNote", { module: commitment.source.module })}
        </p>
      ) : null}

      {commitment.status === "CLOSED" ? (
        <p className="rounded-md border border-line bg-surface-2 px-4 py-3 text-table text-fg-muted">
          {t("commitments.closedNote")}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="nesto-card p-5 lg:col-span-2">
          <h2 className="text-card font-semibold text-fg">{t("detail.details")}</h2>
          <DetailGrid
            className="mt-4"
            items={[
              {
                label: t("form.project"),
                value: commitment.project ? (
                  <Link href={`/projects/${commitment.project.id}`} className="hover:text-accent">
                    {commitment.project.name}
                  </Link>
                ) : (
                  t("companyWide")
                ),
              },
              { label: t("commitmentForm.counterparty"), value: orDash(commitment.counterpartyName) },
              { label: t("form.category"), value: t(`category.${commitment.category}`) },
              { label: t("form.currency"), value: commitment.currency },
              {
                label: t("columns.expected"),
                value: commitment.expectedDate ? formatDate(commitment.expectedDate) : "—",
              },
              { label: t("invoices.raisedBy"), value: commitment.createdBy ? <PersonLink memberId={commitment.createdBy.memberId} name={commitment.createdBy.fullName} /> : "—" },
            ]}
          />

          {commitment.notes ? (
            <div className="mt-4 border-t border-line pt-4">
              <h3 className="text-table font-medium text-fg">{t("form.notes")}</h3>
              <p className="mt-1 whitespace-pre-wrap text-table text-fg-muted">
                {commitment.notes}
              </p>
            </div>
          ) : null}
        </section>

        <section className="nesto-card p-5">
          <h2 className="text-card font-semibold text-fg">{t("detail.approvals")}</h2>
          <ApprovalHistory approvals={commitment.approvals} />
        </section>
      </div>
      {/* Discussion on this record: comments, mentions, watchers (PRD #38 §36). */}
      <CollaborationPanel parentType="commitment" parentId={commitmentId} />
    </div>
  );
}
