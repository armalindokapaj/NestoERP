import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { notFound } from "next/navigation";

import { CollaborationPanel } from "@/components/collaboration/collaboration-panel";
import { DocumentActions } from "@/components/inventory/document-actions";
import { DocumentLinesTable } from "@/components/inventory/document-lines-table";
import { SourceLink } from "@/components/inventory/document-tables";
import { InventoryActivityFeed } from "@/components/inventory/record-activity";
import { InventoryRecordDocuments } from "@/components/inventory/record-documents";
import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { PersonLink } from "@/components/people/person-link";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import * as receipts from "@/lib/modules/inventory/documents/receipt.service";
import { formatDate, formatDateTime } from "@/lib/utils/format";

type Params = { params: Promise<{ receiptId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { receiptId } = await params;
  try {
    const context = await requireModule("inventory");
    const receipt = await receipts.getReceipt(context, receiptId);
    return { title: receipt.receiptNumber };
  } catch {
    const t = await getTranslations("inventory");
    return { title: t("meta.receipt") };
  }
}

/** One receipt (PRD #20 §85, §309, §311). */
export default async function ReceiptPage({ params }: Params) {
  const { receiptId } = await params;
  const context = await requireModule("inventory");
  const t = await getTranslations("inventory");

  let receipt;
  try {
    receipt = await receipts.getReceipt(context, receiptId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={[
          { label: t("meta.inventory"), href: "/inventory" },
          { label: t("meta.receipts"), href: "/inventory/receipts" },
          { label: receipt.receiptNumber },
        ]}
        title={receipt.receiptNumber}
        subtitle={receipt.warehouse.name}
        status={receipt.status}
        meta={[
          { label: t("detail.received"), value: formatDate(receipt.receiptDate) },
          { label: t("columns.lines"), value: String(receipt.lineCount) },
          {
            label: t("columns.source"),
            value: <SourceLink link={receipt.goodsReceiptLink} />,
          },
        ]}
        actions={
          <DocumentActions
            kind="receipts"
            documentId={receipt.id}
            documentNumber={receipt.receiptNumber}
            capabilities={receipt.capabilities}
          />
        }
      />

      {receipt.status === "DRAFT" ? (
        <p className="rounded-md border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted">
          {t("notice.receiptDraft")}
        </p>
      ) : receipt.status === "REVERSED" ? (
        <p className="rounded-md border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted">
          {t("notice.receiptReversed")}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="space-y-3">
            <h2 className="text-card font-semibold text-fg">{t("documentForm.lines")}</h2>
            <DocumentLinesTable
              lines={receipt.lines}
              caption={t("detail.linesOn", { number: receipt.receiptNumber })}
            />
          </section>

          {receipt.notes ? (
            <section className="nesto-card p-5">
              <h2 className="text-card font-semibold text-fg">{t("fields.notes")}</h2>
              <p className="mt-2 whitespace-pre-wrap text-table text-fg-muted">{receipt.notes}</p>
            </section>
          ) : null}

          {receipt.capabilities.canViewDocuments ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">{t("meta.documents")}</h2>
              <InventoryRecordDocuments
                context={context}
                entityType="inventory_receipt"
                entityId={receipt.id}
                emptyDescription={t("documents.receiptEmpty")}
              />
            </section>
          ) : null}
        </div>

        <div className="space-y-4">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("detail.record")}</h2>
            <DetailGrid
              className="mt-4"
              items={[
                { label: t("fields.warehouse"), value: receipt.warehouse.name },
                { label: t("detail.draftedBy"), value: receipt.createdBy ? <PersonLink memberId={receipt.createdBy.memberId} name={receipt.createdBy.fullName} /> : "—" },
                { label: t("detail.drafted"), value: formatDateTime(receipt.createdAt) },
                { label: t("columns.postedBy"), value: receipt.postedBy ? <PersonLink memberId={receipt.postedBy.memberId} name={receipt.postedBy.fullName} /> : "—" },
                {
                  label: t("detail.posted"),
                  value: receipt.postedAt ? formatDateTime(receipt.postedAt) : "—",
                },
                ...(receipt.reversedAt
                  ? [{ label: t("labels.transactionStatus.REVERSED"), value: formatDateTime(receipt.reversedAt) }]
                  : []),
              ]}
            />
          </section>

          {receipt.capabilities.canViewActivity ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">{t("meta.activity")}</h2>
              <InventoryActivityFeed
                context={context}
                entityType="InventoryReceipt"
                entityId={receipt.id}
              />
            </section>
          ) : null}
        </div>
      </div>
      {/* Discussion on this record: comments, mentions, watchers (PRD #38 §36). */}
      <CollaborationPanel parentType="inventory_receipt" parentId={receiptId} />
    </div>
  );
}
