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

export const metadata: Metadata = { title: "New transfer" };

/** Draft a transfer (PRD #20 §281). */
export default async function NewTransferPage() {
  const context = await requireModule("inventory");
  if (!can(context, "inventory.transfer.create")) notFound();

  const [options, balances] = await Promise.all([
    documentFormOptions(context),
    heldBalances(context),
  ]);

  async function action(formData: FormData) {
    "use server";
    return createDocumentAction("transfers", formData);
  }

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "Inventory", href: "/inventory" },
          { label: "Transfers", href: "/inventory/transfers" },
          { label: "New transfer" },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">New transfer</h1>
        <p className="mt-1.5 text-body text-fg-muted">Move material between locations. Posting writes a paired movement — out of one location, into the other — in one step.</p>
      </div>

      <DocumentForm
        kind="transfers"
        action={action}
        cancelHref="/inventory/transfers"
        submitLabel="Save draft"
        pendingLabel="Saving…"
        options={options}
        balances={balances}
      />
    </div>
  );
}
