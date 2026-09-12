import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DocumentForm } from "@/components/inventory/document-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { updateDocumentAction } from "@/lib/actions/inventory";
import * as adjustments from "@/lib/modules/inventory/documents/adjustment.service";
import {
  documentFormOptions,
  heldBalances,
} from "@/lib/modules/inventory/inventory.options";

type Params = { params: Promise<{ adjustmentId: string }> };

export const metadata: Metadata = { title: "Edit adjustment" };

/**
 * Edit a drafted adjustment (PRD #20 §295).
 *
 * Only a draft is editable. Once posted there is nothing here to change — the
 * ledger is written, and a correction is a reversal or an adjustment rather
 * than a quiet rewrite (PRD #20 §70).
 */
export default async function EditAdjustmentPage({ params }: Params) {
  const { adjustmentId } = await params;
  const context = await requireModule("inventory");

  let record;
  try {
    record = await adjustments.getAdjustment(context, adjustmentId);
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
    return updateDocumentAction("adjustments", adjustmentId, formData);
  }

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "Inventory", href: "/inventory" },
          { label: "Adjustments", href: "/inventory/adjustments" },
          { label: record.adjustmentNumber, href: `/inventory/adjustments/${record.id}` },
          { label: "Edit" },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">Edit adjustment</h1>
        <p className="mt-1.5 text-body text-fg-muted">{record.adjustmentNumber}</p>
      </div>

      <DocumentForm
        kind="adjustments"
        action={action}
        versionUpdatedAt={record.updatedAt}
        cancelHref={`/inventory/adjustments/${record.id}`}
        submitLabel="Save draft"
        pendingLabel="Saving…"
        options={options}
        balances={balances}
        values={{
          warehouseId: record.warehouse.id,
          reason: record.reason,
          date: record.adjustmentDate.slice(0, 10),
          notes: record.notes ?? "",
          lines: record.lines.map((line) => ({
            id: line.id,
            inventoryItemId: line.item.id,
            locationId: line.location.id,
            quantityDelta: line.quantityDelta,
            notes: line.notes ?? "",
          })),
        }}
      />
    </div>
  );
}
