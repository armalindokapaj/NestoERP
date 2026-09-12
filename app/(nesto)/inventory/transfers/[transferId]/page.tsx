import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DocumentActions } from "@/components/inventory/document-actions";
import { TransferLinesTable } from "@/components/inventory/document-lines-table";
import { InventoryActivityFeed } from "@/components/inventory/record-activity";
import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import * as transfers from "@/lib/modules/inventory/documents/transfer.service";
import { formatDate, formatDateTime, orDash } from "@/lib/utils/format";

type Params = { params: Promise<{ transferId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { transferId } = await params;
  try {
    const context = await requireModule("inventory");
    const transfer = await transfers.getTransfer(context, transferId);
    return { title: transfer.transferNumber };
  } catch {
    return { title: "Stock transfer" };
  }
}

/** One transfer (PRD #20 §130, §315, §316). */
export default async function TransferPage({ params }: Params) {
  const { transferId } = await params;
  const context = await requireModule("inventory");

  let transfer;
  try {
    transfer = await transfers.getTransfer(context, transferId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={[
          { label: "Inventory", href: "/inventory" },
          { label: "Transfers", href: "/inventory/transfers" },
          { label: transfer.transferNumber },
        ]}
        title={transfer.transferNumber}
        subtitle={`${transfer.fromWarehouse.name} → ${transfer.toWarehouse.name}`}
        status={transfer.status}
        meta={[
          { label: "Transferred", value: formatDate(transfer.transferDate) },
          { label: "Lines", value: String(transfer.lineCount) },
        ]}
        actions={
          <DocumentActions
            kind="transfers"
            documentId={transfer.id}
            documentNumber={transfer.transferNumber}
            capabilities={transfer.capabilities}
          />
        }
      />

      {transfer.status === "DRAFT" ? (
        <p className="rounded-md border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted">
          This is a draft. Posting writes both halves at once — out of the source and into the
          destination — so the company total never changes mid-flight.
        </p>
      ) : transfer.status === "REVERSED" ? (
        <p className="rounded-md border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted">
          This transfer has been reversed and the material is back where it started. All four
          movements remain on the ledger.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="space-y-3">
            <h2 className="text-card font-semibold text-fg">Lines</h2>
            <TransferLinesTable
              lines={transfer.lines}
              caption={`Lines on ${transfer.transferNumber}`}
            />
          </section>

          {transfer.notes ? (
            <section className="nesto-card p-5">
              <h2 className="text-card font-semibold text-fg">Notes</h2>
              <p className="mt-2 whitespace-pre-wrap text-table text-fg-muted">
                {transfer.notes}
              </p>
            </section>
          ) : null}
        </div>

        <div className="space-y-4">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">Record</h2>
            <DetailGrid
              className="mt-4"
              items={[
                { label: "From", value: transfer.fromWarehouse.name },
                { label: "To", value: transfer.toWarehouse.name },
                { label: "Drafted by", value: orDash(transfer.createdBy?.fullName ?? null) },
                { label: "Drafted", value: formatDateTime(transfer.createdAt) },
                { label: "Posted by", value: orDash(transfer.postedBy?.fullName ?? null) },
              ]}
            />
          </section>

          {transfer.capabilities.canViewActivity ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Activity</h2>
              <InventoryActivityFeed
                context={context}
                entityType="StockTransfer"
                entityId={transfer.id}
              />
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
