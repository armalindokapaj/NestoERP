import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
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

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("inventory");
  return { title: t("meta.newTransfer") };
}

/** Draft a transfer (PRD #20 §281). */
export default async function NewTransferPage() {
  const context = await requireModule("inventory");
  const t = await getTranslations("inventory");
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
          { label: t("meta.inventory"), href: "/inventory" },
          { label: t("meta.transfers"), href: "/inventory/transfers" },
          { label: t("meta.newTransfer") },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">{t("meta.newTransfer")}</h1>
        <p className="mt-1.5 text-body text-fg-muted">{t("newPage.transfers")}</p>
      </div>

      <DocumentForm
        kind="transfers"
        action={action}
        cancelHref="/inventory/transfers"
        submitLabel={t("form.saveDraft")}
        pendingLabel={t("form.saving")}
        options={options}
        balances={balances}
      />
    </div>
  );
}
