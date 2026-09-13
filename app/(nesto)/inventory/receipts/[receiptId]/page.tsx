import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CollaborationPanel } from "@/components/collaboration/collaboration-panel";
import { DocumentActions } from "@/components/inventory/document-actions";
import { DocumentLinesTable } from "@/components/inventory/document-lines-table";
import { SourceLink } from "@/components/inventory/document-tables";
import { InventoryActivityFeed } from "@/components/inventory/record-activity";
import { InventoryRecordDocuments } from "@/components/inventory/record-documents";
import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import * as receipts from "@/lib/modules/inventory/documents/receipt.service";
import { formatDate, formatDateTime, orDash } from "@/lib/utils/format";

type Params = { params: Promise<{ receiptId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { receiptId } = await params;
  try {
    const context = await requireModule("inventory");
    const receipt = await receipts.getReceipt(context, receiptId);
    return { title: receipt.receiptNumber };
  } catch {
    return { title: "Receipt" };
  }
}

/** One receipt (PRD #20 §85, §309, §311). */
export default async function ReceiptPage({ params }: Params) {
  const { receiptId } = await params;
  const context = await requireModule("inventory");

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
          { label: "Inventory", href: "/inventory" },
          { label: "Receipts", href: "/inventory/receipts" },
          { label: receipt.receiptNumber },
        ]}
        title={receipt.receiptNumber}
        subtitle={receipt.warehouse.name}
        status={receipt.status}
        meta={[
          { label: "Received", value: formatDate(receipt.receiptDate) },
          { label: "Lines", value: String(receipt.lineCount) },
          {
            label: "Source",
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
          This is a draft. Nothing has reached the stock ledger yet — posting is what increases
          stock.
        </p>
      ) : receipt.status === "REVERSED" ? (
        <p className="rounded-md border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted">
          This receipt has been reversed. The original movements are still on the ledger, with
          opposite movements beside them.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="space-y-3">
            <h2 className="text-card font-semibold text-fg">Lines</h2>
            <DocumentLinesTable
              lines={receipt.lines}
              caption={`Lines on ${receipt.receiptNumber}`}
            />
          </section>

          {receipt.notes ? (
            <section className="nesto-card p-5">
              <h2 className="text-card font-semibold text-fg">Notes</h2>
              <p className="mt-2 whitespace-pre-wrap text-table text-fg-muted">{receipt.notes}</p>
            </section>
          ) : null}

          {receipt.capabilities.canViewDocuments ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Documents</h2>
              <InventoryRecordDocuments
                context={context}
                entityType="inventory_receipt"
                entityId={receipt.id}
                emptyDescription="Delivery notes and photographs filed against this receipt appear here."
              />
            </section>
          ) : null}
        </div>

        <div className="space-y-4">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">Record</h2>
            <DetailGrid
              className="mt-4"
              items={[
                { label: "Warehouse", value: receipt.warehouse.name },
                { label: "Drafted by", value: orDash(receipt.createdBy?.fullName ?? null) },
                { label: "Drafted", value: formatDateTime(receipt.createdAt) },
                { label: "Posted by", value: orDash(receipt.postedBy?.fullName ?? null) },
                {
                  label: "Posted",
                  value: receipt.postedAt ? formatDateTime(receipt.postedAt) : "—",
                },
                ...(receipt.reversedAt
                  ? [{ label: "Reversed", value: formatDateTime(receipt.reversedAt) }]
                  : []),
              ]}
            />
          </section>

          {receipt.capabilities.canViewActivity ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Activity</h2>
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
