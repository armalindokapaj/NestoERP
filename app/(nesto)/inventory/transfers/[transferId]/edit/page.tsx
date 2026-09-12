import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DocumentForm } from "@/components/inventory/document-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { updateDocumentAction } from "@/lib/actions/inventory";
import * as transfers from "@/lib/modules/inventory/documents/transfer.service";
import {
  documentFormOptions,
  heldBalances,
} from "@/lib/modules/inventory/inventory.options";

type Params = { params: Promise<{ transferId: string }> };

export const metadata: Metadata = { title: "Edit transfer" };

/**
 * Edit a drafted transfer (PRD #20 §295).
 *
 * Only a draft is editable. Once posted there is nothing here to change — the
 * ledger is written, and a correction is a reversal or an adjustment rather
 * than a quiet rewrite (PRD #20 §70).
 */
export default async function EditTransferPage({ params }: Params) {
  const { transferId } = await params;
  const context = await requireModule("inventory");

  let record;
  try {
    record = await transfers.getTransfer(context, transferId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  if (!record.capabilities.canEdit) notFound();

  const [options, balances] = await Promise.all([
    documentFormOptions(context),
    heldBalances(context),
  ]);

  async function action(formData: FormData) {
    "use server";
    return updateDocumentAction("transfers", transferId, formData);
  }

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "Inventory", href: "/inventory" },
          { label: "Transfers", href: "/inventory/transfers" },
          { label: record.transferNumber, href: `/inventory/transfers/${record.id}` },
          { label: "Edit" },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">Edit transfer</h1>
        <p className="mt-1.5 text-body text-fg-muted">{record.transferNumber}</p>
      </div>

      <DocumentForm
        kind="transfers"
        action={action}
        versionUpdatedAt={record.updatedAt}
        cancelHref={`/inventory/transfers/${record.id}`}
        submitLabel="Save draft"
        pendingLabel="Saving…"
        options={options}
        balances={balances}
        values={{
          fromWarehouseId: record.fromWarehouse.id,
          toWarehouseId: record.toWarehouse.id,
          date: record.transferDate.slice(0, 10),
          notes: record.notes ?? "",
          lines: record.lines.map((line) => ({
            id: line.id,
            inventoryItemId: line.item.id,
            fromLocationId: line.fromLocation.id,
            toLocationId: line.toLocation.id,
            quantity: line.quantity,
            notes: line.notes ?? "",
          })),
        }}
      />
    </div>
  );
}
