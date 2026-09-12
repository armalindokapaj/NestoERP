import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DocumentForm } from "@/components/inventory/document-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { createDocumentAction } from "@/lib/actions/inventory";
import {
  documentFormOptions,
  heldBalances,
} from "@/lib/modules/inventory/inventory.options";

export const metadata: Metadata = { title: "New receipt" };

/** Draft a receipt (PRD #20 §281). */
export default async function NewReceiptPage() {
  const context = await requireModule("inventory");
  if (!can(context, "inventory.receipt.create")) notFound();

  const [options, balances] = await Promise.all([
    documentFormOptions(context),
    heldBalances(context),
  ]);

  async function action(formData: FormData) {
    "use server";
    return createDocumentAction("receipts", formData);
  }

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "Inventory", href: "/inventory" },
          { label: "Receipts", href: "/inventory/receipts" },
          { label: "New receipt" },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">New receipt</h1>
        <p className="mt-1.5 text-body text-fg-muted">Record material arriving into stock. Save it as a draft, then post it to commit it to the ledger.</p>
      </div>

      <DocumentForm
        kind="receipts"
        action={action}
        cancelHref="/inventory/receipts"
        submitLabel="Save draft"
        pendingLabel="Saving…"
        options={options}
        balances={balances}
      />
    </div>
  );
}
