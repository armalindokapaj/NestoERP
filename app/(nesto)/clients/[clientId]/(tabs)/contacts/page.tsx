import { getTranslations } from "@/lib/i18n/server";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ContactList } from "@/components/clients/contact-list";
import { can } from "@/lib/access/can";
import * as clients from "@/lib/modules/clients/client.service";
import { loadClient } from "../../client-context";

type Params = { params: Promise<{ clientId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("clients"))("meta.contacts") };
}

/**
 * Client contacts (PRD #12 §76–§79).
 *
 * Business contacts at the client, not employee records: nothing here is an HR
 * field (PRD #12 §90, §143).
 */
export default async function ClientContactsPage({ params }: Params) {
  const { clientId } = await params;
  const { context, client } = await loadClient(clientId);

  if (!client.capabilities.canViewContacts) notFound();
  const t = await getTranslations("clients");

  const archived = client.archivedAt !== null || client.status === "ARCHIVED";
  const contacts = await clients.listContacts(context, clientId, { archived: true });

  return (
    <div className="space-y-5">
      <ContactList
        clientId={client.id}
        contacts={contacts}
        canCreate={!archived && can(context, "contact.create")}
        canUpdate={!archived && can(context, "contact.update")}
        canArchive={!archived && can(context, "contact.archive")}
        canRestore={!archived && can(context, "contact.restore")}
      />
    </div>
  );
}
