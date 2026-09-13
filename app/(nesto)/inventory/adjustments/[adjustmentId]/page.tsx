import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CollaborationPanel } from "@/components/collaboration/collaboration-panel";
import { DocumentActions } from "@/components/inventory/document-actions";
import { AdjustmentLinesTable } from "@/components/inventory/document-lines-table";
import { InventoryActivityFeed } from "@/components/inventory/record-activity";
import { InventoryRecordDocuments } from "@/components/inventory/record-documents";
import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { Badge } from "@/components/ui/badge";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import * as adjustments from "@/lib/modules/inventory/documents/adjustment.service";
import { adjustmentReasonLabels } from "@/lib/modules/inventory/inventory.status";
import { formatDate, formatDateTime, orDash } from "@/lib/utils/format";

type Params = { params: Promise<{ adjustmentId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { adjustmentId } = await params;
  try {
    const context = await requireModule("inventory");
    const adjustment = await adjustments.getAdjustment(context, adjustmentId);
    return { title: adjustment.adjustmentNumber };
  } catch {
    return { title: "Stock adjustment" };
  }
}

/** One adjustment (PRD #20 §142, §317, §318). */
export default async function AdjustmentPage({ params }: Params) {
  const { adjustmentId } = await params;
  const context = await requireModule("inventory");

  let adjustment;
  try {
    adjustment = await adjustments.getAdjustment(context, adjustmentId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const writesOff = adjustment.lines.some((line) => line.quantityDelta.trim().startsWith("-"));

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={[
          { label: "Inventory", href: "/inventory" },
          { label: "Adjustments", href: "/inventory/adjustments" },
          { label: adjustment.adjustmentNumber },
        ]}
        title={adjustment.adjustmentNumber}
        subtitle={adjustment.warehouse.name}
        status={adjustment.status}
        badges={<Badge tone="neutral">{adjustmentReasonLabels[adjustment.reason]}</Badge>}
        meta={[
          { label: "Adjusted", value: formatDate(adjustment.adjustmentDate) },
          { label: "Lines", value: String(adjustment.lineCount) },
        ]}
        actions={
          <DocumentActions
            kind="adjustments"
            documentId={adjustment.id}
            documentNumber={adjustment.adjustmentNumber}
            capabilities={adjustment.capabilities}
          />
        }
      />

      {adjustment.status === "DRAFT" && writesOff ? (
        <p className="rounded-md border border-danger bg-danger-soft px-4 py-3 text-table text-danger-strong">
          This adjustment writes stock off. Posting directly reduces what the company is recorded
          as holding, and it cannot be edited afterwards.
        </p>
      ) : adjustment.status === "DRAFT" ? (
        <p className="rounded-md border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted">
          This is a draft. Posting changes recorded stock without anything physically moving.
        </p>
      ) : adjustment.status === "REVERSED" ? (
        <p className="rounded-md border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted">
          This adjustment has been reversed. Both sets of movements remain on the ledger.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="space-y-3">
            <h2 className="text-card font-semibold text-fg">Lines</h2>
            <AdjustmentLinesTable
              lines={adjustment.lines}
              caption={`Lines on ${adjustment.adjustmentNumber}`}
            />
          </section>

          {adjustment.notes ? (
            <section className="nesto-card p-5">
              <h2 className="text-card font-semibold text-fg">Notes</h2>
              <p className="mt-2 whitespace-pre-wrap text-table text-fg-muted">
                {adjustment.notes}
              </p>
            </section>
          ) : null}

          {adjustment.capabilities.canViewDocuments ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Documents</h2>
              <InventoryRecordDocuments
                context={context}
                entityType="stock_adjustment"
                entityId={adjustment.id}
                emptyDescription="Count sheets and photographs supporting this adjustment appear here."
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
                { label: "Warehouse", value: adjustment.warehouse.name },
                { label: "Reason", value: adjustmentReasonLabels[adjustment.reason] },
                { label: "Drafted by", value: orDash(adjustment.createdBy?.fullName ?? null) },
                { label: "Drafted", value: formatDateTime(adjustment.createdAt) },
                { label: "Posted by", value: orDash(adjustment.postedBy?.fullName ?? null) },
              ]}
            />
          </section>

          {adjustment.capabilities.canViewActivity ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Activity</h2>
              <InventoryActivityFeed
                context={context}
                entityType="StockAdjustment"
                entityId={adjustment.id}
              />
            </section>
          ) : null}
        </div>
      </div>
      {/* Discussion on this record: comments, mentions, watchers (PRD #38 §36). */}
      <CollaborationPanel parentType="stock_adjustment" parentId={adjustmentId} />
    </div>
  );
}
