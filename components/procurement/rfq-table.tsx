import { DataTable, type TableColumn } from "@/components/data/data-table";
import { StatusBadge } from "@/components/modules/status-badge";
import type { RfqSummaryDTO } from "@/lib/modules/procurement/procurement.types";
import { formatDate } from "@/lib/utils/format";

/** The enquiry list (PRD #19 §252). */
export function RfqTable({
  rfqs,
  caption = "Enquiries",
}: {
  rfqs: RfqSummaryDTO[];
  caption?: string;
}) {
  const columns: TableColumn<RfqSummaryDTO>[] = [
    {
      key: "rfqNumber",
      label: "Enquiry",
      primary: true,
      render: (row) => (
        <span className="flex flex-col">
          <span className="font-medium text-fg">{row.rfqNumber}</span>
          <span className="text-meta text-fg-subtle">{row.title}</span>
        </span>
      ),
    },
    {
      key: "project",
      label: "Project",
      hideBelow: "xl",
      render: (row) => row.project?.code ?? <span className="text-fg-subtle">Company</span>,
    },
    {
      key: "responses",
      label: "Responses",
      align: "right",
      render: (row) => (
        <span className="tabular-nums">
          {row.respondedCount} / {row.invitedCount}
        </span>
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: "responseDueDate",
      label: "Responses by",
      hideBelow: "md",
      render: (row) =>
        row.responseDueDate ? (
          <span className={row.overdue ? "text-warning-strong" : undefined}>
            {formatDate(row.responseDueDate)}
            {row.overdue ? " · overdue" : ""}
          </span>
        ) : (
          <span className="text-fg-subtle">No date</span>
        ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      records={rfqs}
      rowKey={(row) => row.id}
      rowHref={(row) => `/procurement/rfqs/${row.id}`}
      caption={caption}
    />
  );
}
