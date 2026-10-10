import Link from "@/components/navigation/nav-link";
import { RecordFavorite } from "@/components/productivity/record-favorite";
import { RecordHeader } from "@/components/modules/record-header";
import { ClientActions } from "@/components/clients/client-actions";
import { Badge } from "@/components/ui/badge";
import { clientTypeLabels } from "@/lib/modules/clients/client.status";
import * as clients from "@/lib/modules/clients/client.service";
import { clientsLabel } from "@/lib/i18n/modules/clients/labels";
import { getTranslations } from "@/lib/i18n/server";
import { clientBreadcrumbs, loadClient } from "../client-context";
import { ClientTabs } from "../client-tabs";

type Params = { params: Promise<{ clientId: string }> };

/** The record's frame: header and tabs stay mounted while the tab content swaps beneath them. */
export default async function ClientTabsLayout({ children, params }: Params & { children: React.ReactNode }) {
  const { clientId } = await params;
  const { context, client } = await loadClient(clientId);
  const archived = client.archivedAt !== null || client.status === "ARCHIVED";
  const may = client.capabilities;
  const t = await getTranslations("clients");
  const typeLabel = clientsLabel(t, "clientType", client.type, clientTypeLabels[client.type]);

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={clientBreadcrumbs(client, undefined, t("meta.clients"))}
        title={client.name}
        subtitle={client.code ?? client.legalName ?? undefined}
        status={client.status}
        badges={<Badge tone="neutral">{typeLabel}</Badge>}
        meta={[
          {
            label: t("detail.primaryContact"),
            value: client.primaryContact ? (
              <span className="flex items-center gap-2">
                {client.primaryContact.fullName}
                {client.primaryContact.status === "INACTIVE" ? (
                  <Badge tone="neutral">{t("common.inactive")}</Badge>
                ) : null}
              </span>
            ) : (
              t("common.none")
            ),
          },
          {
            label: t("detail.activeProjects"),
            value: may.canViewProjects ? (
              <Link
                href={`/clients/${client.id}/projects`}
                className="text-fg transition-colors hover:text-accent"
              >
                {client.counts.visibleProjects}
              </Link>
            ) : (
              "—"
            ),
          },
          { label: t("detail.contacts"), value: may.canViewContacts ? client.counts.activeContacts : "—" },
        ]}
        actions={
          <>
          <RecordFavorite context={context} entityType="client" entityId={client.id} />
          <ClientActions
            clientId={client.id}
            clientName={client.name}
            archived={archived}
            activeProjects={client.counts.visibleProjects}
            canUpdate={may.canEdit}
            canArchive={may.canArchive}
            canRestore={may.canRestore}
          />
          </>
        }
      />

      <ClientTabs
        clientId={client.id}
        capabilities={client.capabilities}
      />

      {children}
    </div>
  );
}
