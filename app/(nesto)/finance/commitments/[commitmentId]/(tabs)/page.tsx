import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";

import { CollaborationPanel } from "@/components/collaboration/collaboration-panel";
import { ApprovalHistory } from "@/components/finance/approval-history";
import { DetailGrid } from "@/components/modules/record-header";
import { PersonLink } from "@/components/people/person-link";
import { getTranslations } from "@/lib/i18n/server";
import { formatDate, orDash } from "@/lib/utils/format";
import { commitmentLabel, loadCommitment } from "../commitment-context";

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

  return (
    <div className="space-y-5">
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
