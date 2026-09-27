import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ClientForm } from "@/components/clients/client-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { createClientAction } from "@/lib/actions/clients";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("clients"))("meta.newClient") };
}

/**
 * Create a client (PRD #12 §39–§50).
 *
 * The optional primary contact is created in the same transaction, so a client
 * is never left half-made if the second write fails (PRD #12 §50).
 */
export default async function NewClientPage() {
  const context = await requireModule("clients");
  if (!can(context, "client.create")) notFound();
  const t = await getTranslations("clients");

  return (
    <div className="space-y-5">
      <Breadcrumbs items={[{ label: t("meta.clients"), href: "/clients" }, { label: t("newPage.title") }]} />

      <div>
        <h1 className="text-page font-semibold text-fg">{t("newPage.title")}</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          {t("newPage.description")}
        </p>
      </div>

      <ClientForm
        mode="create"
        cancelHref="/clients/all"
        showPrimaryContact={can(context, "contact.create")}
        action={createClientAction}
        initial={{
          code: "",
          name: "",
          legalName: "",
          type: "COMPANY",
          email: "",
          phone: "",
          website: "",
          address: "",
          city: "",
          country: "",
          status: "ACTIVE",
        }}
      />
    </div>
  );
}
