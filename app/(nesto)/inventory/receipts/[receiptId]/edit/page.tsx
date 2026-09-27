import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { notFound } from "next/navigation";

import { DocumentForm } from "@/components/inventory/document-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { updateDocumentAction } from "@/lib/actions/inventory";
import * as receipts from "@/lib/modules/inventory/documents/receipt.service";
import {
  documentFormOptions,
  heldBalances,
} from "@/lib/modules/inventory/inventory.options";

type Params = { params: Promise<{ receiptId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("inventory");
  return { title: t("meta.editReceipt") };
}

/**
 * Edit a drafted receipt (PRD #20 §295).
 *
 * Only a draft is editable. Once posted there is nothing here to change — the
 * ledger is written, and a correction is a reversal or an adjustment rather
 * than a quiet rewrite (PRD #20 §70).
 */
export default async function EditReceiptPage({ params }: Params) {
  const { receiptId } = await params;
  const context = await requireModule("inventory");
  const t = await getTranslations("inventory");

  let record;
  try {
    record = await receipts.getReceipt(context, receiptId);
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
    return updateDocumentAction("receipts", receiptId, formData);
  }

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: t("meta.inventory"), href: "/inventory" },
          { label: t("meta.receipts"), href: "/inventory/receipts" },
          { label: record.receiptNumber, href: `/inventory/receipts/${record.id}` },
          { label: t("actions.edit") },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">{t("meta.editReceipt")}</h1>
        <p className="mt-1.5 text-body text-fg-muted">{record.receiptNumber}</p>
      </div>

      <DocumentForm
        kind="receipts"
        action={action}
        versionUpdatedAt={record.updatedAt}
        cancelHref={`/inventory/receipts/${record.id}`}
        submitLabel={t("form.saveDraft")}
        pendingLabel={t("form.saving")}
        options={options}
        balances={balances}
        values={{
          warehouseId: record.warehouse.id,
          date: record.receiptDate.slice(0, 10),
          notes: record.notes ?? "",
          lines: record.lines.map((line) => ({
            id: line.id,
            inventoryItemId: line.item.id,
            locationId: line.location?.id ?? "",
            quantity: line.quantity,
            notes: line.notes ?? "",
          })),
        }}
      />
    </div>
  );
}
