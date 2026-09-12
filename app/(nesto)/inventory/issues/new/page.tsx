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

export const metadata: Metadata = { title: "New issue" };

/** Draft a issue (PRD #20 §281). */
export default async function NewIssuePage() {
  const context = await requireModule("inventory");
  if (!can(context, "inventory.issue.create")) notFound();

  const [options, balances] = await Promise.all([
    documentFormOptions(context),
    heldBalances(context),
  ]);

  async function action(formData: FormData) {
    "use server";
    return createDocumentAction("issues", formData);
  }

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "Inventory", href: "/inventory" },
          { label: "Issues", href: "/inventory/issues" },
          { label: "New issue" },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">New issue</h1>
        <p className="mt-1.5 text-body text-fg-muted">Record material leaving stock. Save it as a draft, then post it to commit it to the ledger.</p>
      </div>

      <DocumentForm
        kind="issues"
        action={action}
        cancelHref="/inventory/issues"
        submitLabel="Save draft"
        pendingLabel="Saving…"
        options={options}
        balances={balances}
      />
    </div>
  );
}
