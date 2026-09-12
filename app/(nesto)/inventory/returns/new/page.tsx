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

export const metadata: Metadata = { title: "New return" };

/** Draft a return (PRD #20 §281). */
export default async function NewReturnPage() {
  const context = await requireModule("inventory");
  if (!can(context, "inventory.return.create")) notFound();

  const [options, balances] = await Promise.all([
    documentFormOptions(context),
    heldBalances(context),
  ]);

  async function action(formData: FormData) {
    "use server";
    return createDocumentAction("returns", formData);
  }

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "Inventory", href: "/inventory" },
          { label: "Returns", href: "/inventory/returns" },
          { label: "New return" },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">New return</h1>
        <p className="mt-1.5 text-body text-fg-muted">Record unused material coming back from a project. Save it as a draft, then post it to put the stock back.</p>
      </div>

      <DocumentForm
        kind="returns"
        action={action}
        cancelHref="/inventory/returns"
        submitLabel="Save draft"
        pendingLabel="Saving…"
        options={options}
        balances={balances}
      />
    </div>
  );
}
