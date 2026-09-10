import { DataTable, type TableColumn } from "@/components/data/data-table";
import { StatusBadge } from "@/components/modules/status-badge";
import type { ClientSummaryDTO } from "@/lib/modules/clients/client.types";
import { clientTypeLabels } from "@/lib/modules/clients/client.status";
import { formatDate } from "@/lib/utils/format";

/**
 * The Clients list (PRD #12 §28, §29).
 *
 * Clicking a row opens the client — individual cells are not separately
 * clickable. The project count is the number this reader can actually open,
 * never the company-wide total (PRD #12 §93).
 */
export function ClientTable({ clients }: { clients: ClientSummaryDTO[] }) {
  const columns: TableColumn<ClientSummaryDTO>[] = [
    {
      key: "name",
      label: "Client",
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
      label: "Code",
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
      label: "Type",
      hideBelow: "lg",
      render: (client) => <span className="text-fg-muted">{clientTypeLabels[client.type]}</span>,
    },
    {
      key: "primaryContact",
      label: "Primary contact",
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
      label: "Active projects",
      hideBelow: "md",
      align: "right",
      render: (client) => <span className="text-fg-muted">{client.activeProjectsCount}</span>,
    },
    {
      key: "status",
      label: "Status",
      render: (client) => <StatusBadge status={client.status} />,
    },
    {
      key: "updatedAt",
      label: "Updated",
      hideBelow: "xl",
      render: (client) => <span className="text-fg-muted">{formatDate(client.updatedAt)}</span>,
    },
  ];

  return (
    <DataTable
      caption="Clients"
      columns={columns}
      records={clients}
      rowKey={(client) => client.id}
      rowHref={(client) => `/clients/${client.id}`}
    />
  );
}
