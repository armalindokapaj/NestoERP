import { CommitmentActions } from "@/components/finance/commitment-actions";
import { Money } from "@/components/finance/money";
import { RecordHeader } from "@/components/modules/record-header";
import { Badge } from "@/components/ui/badge";
import { getTranslations } from "@/lib/i18n/server";
import { pendingCycle } from "@/lib/modules/finance/approvals/approval.service";
import { formatDate } from "@/lib/utils/format";
import { commitmentBreadcrumbs, commitmentLabel, loadCommitment } from "../commitment-context";
import { FinanceRecordTabs } from "../../../invoices/[invoiceId]/record-tabs";

type Props = { children: React.ReactNode; params: Promise<{ commitmentId: string }> };

/** The record's frame: header and tabs stay mounted while Overview, Documents and Activity swap beneath them. */
export default async function CommitmentTabsLayout({ children, params }: Props) {
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
        show={{ documents: may.canViewDocuments, activity: may.canViewActivity }}
      />

      {children}
    </div>
  );
}
