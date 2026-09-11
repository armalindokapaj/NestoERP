import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ContactList } from "@/components/clients/contact-list";
import { RecordContextHeader } from "@/components/modules/record-header";
import { can } from "@/lib/access/can";
import * as clients from "@/lib/modules/clients/client.service";
import { clientBreadcrumbs, loadClient } from "../client-context";
import { ClientTabs } from "../client-tabs";

type Params = { params: Promise<{ clientId: string }> };

export const metadata: Metadata = { title: "Contacts" };

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

  const archived = client.archivedAt !== null || client.status === "ARCHIVED";
  const contacts = await clients.listContacts(context, clientId, { archived: true });

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={clientBreadcrumbs(client, "Contacts")}
        title={client.name}
        subtitle={client.code ?? undefined}
        status={client.status}
      />

      <ClientTabs
        clientId={client.id}
        active="contacts"
        show={{
          contacts: true,
          projects: client.capabilities.canViewProjects,
          finance: client.capabilities.canViewFinance,
          documents: client.capabilities.canViewDocuments,
          activity: client.capabilities.canViewActivity,
        }}
      />

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
