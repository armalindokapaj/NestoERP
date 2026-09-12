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

export const metadata: Metadata = { title: "New adjustment" };

/** Draft a adjustment (PRD #20 §281). */
export default async function NewAdjustmentPage() {
  const context = await requireModule("inventory");
  if (!can(context, "inventory.adjustment.create")) notFound();

  const [options, balances] = await Promise.all([
    documentFormOptions(context),
    heldBalances(context),
  ]);

  async function action(formData: FormData) {
    "use server";
    return createDocumentAction("adjustments", formData);
  }

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "Inventory", href: "/inventory" },
          { label: "Adjustments", href: "/inventory/adjustments" },
          { label: "New adjustment" },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">New adjustment</h1>
        <p className="mt-1.5 text-body text-fg-muted">Correct what the company believes it holds. Nothing physically moves — this is the one act that can make stock appear.</p>
      </div>

      <DocumentForm
        kind="adjustments"
        action={action}
        cancelHref="/inventory/adjustments"
        submitLabel="Save draft"
        pendingLabel="Saving…"
        options={options}
        balances={balances}
      />
    </div>
  );
}
