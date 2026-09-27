import { DataTable, type TableColumn, type TableSortConfig } from "@/components/data/data-table";
import { StatusBadge } from "@/components/modules/status-badge";
import type { ClientSummaryDTO } from "@/lib/modules/clients/client.types";
import { clientTypeLabels } from "@/lib/modules/clients/client.status";
import { formatDate } from "@/lib/utils/format";
import { clientsLabel } from "@/lib/i18n/modules/clients/labels";
import { getTranslations } from "@/lib/i18n/server";

/**
 * The Clients list (PRD #12 §28, §29).
 *
 * Clicking a row opens the client — individual cells are not separately
 * clickable. The project count is the number this reader can actually open,
 * never the company-wide total (PRD #12 §93).
 *
 * Column metadata (AUD-08 §5): the client name is the identity column; status
 * is mandatory. Header sorts only where the page passes `sort`; "Active
 * projects" is not a header sort because `projects-desc` orders by every
 * linked project, not the scoped active count the column shows.
 */
export async function ClientTable({ clients, listId = "clients.list", sort }: { clients: ClientSummaryDTO[]; listId?: string; sort?: TableSortConfig }) {
  const t = await getTranslations("clients");
  const sortable = Boolean(sort);
  const columns: TableColumn<ClientSummaryDTO>[] = [
    {
      key: "name",
      id: "name",
      mandatory: true,
      sortKey: sortable ? "name" : undefined,
      label: t("table.client"),
      primary: true,
      render: (client) => (
        <>
          <span className="block truncate">{client.name}</span>
          {client.legalName && client.legalName !== client.name ? (
            <span className="block text-meta font-normal text-fg-subtle">{client.legalName}</span>
          ) : null}
        </>
      ),
    },
    {
      key: "code",
      id: "code",
      label: t("table.code"),
      hideBelow: "lg",
      render: (client) =>
        client.code ? (
          <span className="text-fg-muted">{client.code}</span>
        ) : (
          <span className="text-fg-subtle">—</span>
        ),
    },
    {
      key: "type",
      id: "type",
      sortKey: sortable ? "type" : undefined,
      label: t("table.type"),
      hideBelow: "lg",
      render: (client) => <span className="text-fg-muted">{clientsLabel(t, "clientType", client.type, clientTypeLabels[client.type])}</span>,
    },
    {
      key: "primaryContact",
      id: "primaryContact",
      label: t("table.primaryContact"),
      hideBelow: "xl",
      render: (client) =>
        client.primaryContact ? (
          <span className="text-fg-muted">{client.primaryContact.fullName}</span>
        ) : (
          <span className="text-fg-subtle">—</span>
        ),
    },
    {
      key: "projects",
      id: "activeProjects",
      valueType: "number",
      label: t("table.activeProjects"),
      hideBelow: "md",
      align: "right",
      render: (client) => <span className="text-fg-muted">{client.activeProjectsCount}</span>,
    },
    {
      key: "status",
      id: "status",
      mandatory: true,
      valueType: "status",
      sortKey: sortable ? "status" : undefined,
      label: t("table.status"),
      render: (client) => <StatusBadge status={client.status} />,
    },
    {
      key: "updatedAt",
      id: "updated",
      valueType: "date",
      label: t("table.updated"),
      hideBelow: "xl",
      render: (client) => <span className="text-fg-muted">{formatDate(client.updatedAt)}</span>,
    },
  ];

  return (
    <DataTable
      listId={listId}
      sort={sort}
      caption={t("table.caption")}
      columns={columns}
      records={clients}
      rowKey={(client) => client.id}
      rowHref={(client) => `/clients/${client.id}`}
    />
  );
}
