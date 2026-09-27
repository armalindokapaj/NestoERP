import { getTranslations } from "@/lib/i18n/server";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ClientForm } from "@/components/clients/client-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { updateClientAction } from "@/lib/actions/clients";
import { clientBreadcrumbs, loadClient } from "../client-context";

type Params = { params: Promise<{ clientId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("clients"))("meta.editClient") };
}

/**
 * Edit a client (PRD #12 §65–§68).
 *
 * An archived client is read-only and has no edit page: it must be restored
 * first (PRD #12 §68).
 */
export default async function EditClientPage({ params }: Params) {
  const { clientId } = await params;
  const { client } = await loadClient(clientId);

  if (!client.capabilities.canEdit) notFound();
  const t = await getTranslations("clients");

  async function action(formData: FormData) {
    "use server";
    return updateClientAction(clientId, formData);
  }

  return (
    <div className="space-y-5">
      <Breadcrumbs items={clientBreadcrumbs(client, t("tabs.edit"), t("meta.clients"))} />

      <div>
        <h1 className="text-page font-semibold text-fg">{t("editPage.title")}</h1>
        <p className="mt-1.5 text-body text-fg-muted">{client.name}</p>
      </div>

      <ClientForm
        mode="edit"
        cancelHref={`/clients/${client.id}`}
        versionUpdatedAt={client.updatedAt}
        action={action}
        initial={{
          code: client.code ?? "",
          name: client.name,
          legalName: client.legalName ?? "",
          type: client.type,
          email: client.contact.email ?? "",
          phone: client.contact.phone ?? "",
          website: client.contact.website ?? "",
          address: client.address.address ?? "",
          city: client.address.city ?? "",
          country: client.address.country ?? "",
          status: client.status === "ARCHIVED" ? "ACTIVE" : client.status,
        }}
      />
    </div>
  );
}
