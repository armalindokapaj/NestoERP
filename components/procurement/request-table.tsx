import { DataTable, type TableColumn } from "@/components/data/data-table";
import { StatusBadge } from "@/components/modules/status-badge";
import type { RequestSummaryDTO } from "@/lib/modules/procurement/procurement.types";
import { priorityLabels } from "@/lib/modules/procurement/procurement.status";
import { formatDate } from "@/lib/utils/format";
import { dueLabel, formatAmount } from "./procurement-format";

/**
 * The purchase request list (PRD #19 §249, §277).
 *
 * The estimated value is stated as an estimate, because a request is an ask
 * rather than a commitment and a column headed "Value" invites people to read
 * it as one (PRD #19 §48).
 */
export function RequestTable({
  requests,
  showProject = true,
  caption = "Purchase requests",
}: {
  requests: RequestSummaryDTO[];
  showProject?: boolean;
  caption?: string;
}) {
  const columns: TableColumn<RequestSummaryDTO>[] = [
    {
      key: "requestNumber",
      label: "Request",
      primary: true,
      render: (row) => (
        <span className="flex flex-col">
          <span className="font-medium text-fg">{row.requestNumber}</span>
          <span className="text-meta text-fg-subtle">{row.title}</span>
        </span>
      ),
    },
    ...(showProject
      ? [
          {
            key: "project",
            label: "Project",
            hideBelow: "lg" as const,
            render: (row: RequestSummaryDTO) =>
              row.project?.code ?? <span className="text-fg-subtle">Company</span>,
          },
        ]
      : []),
    {
      key: "requestedBy",
      label: "Raised by",
      hideBelow: "xl",
      render: (row) => (
        <span className={row.requestedBy.active ? undefined : "text-fg-subtle"}>
          {row.requestedBy.fullName}
          {row.requestedBy.active ? "" : " (inactive)"}
        </span>
      ),
    },
    {
      key: "priority",
      label: "Priority",
      hideBelow: "xl",
      render: (row) => priorityLabels[row.priority],
    },
    {
      key: "estimatedTotal",
      label: "Estimated",
      align: "right",
      render: (row) => (
        <span className="tabular-nums">
          {row.currency ? formatAmount(row.estimatedTotal, row.currency) : "—"}
        </span>
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: "requiredDate",
      label: "Needed",
      hideBelow: "md",
      render: (row) =>
        row.requiredDate ? (
          <span className={row.attention.overdue ? "text-warning-strong" : undefined}>
            {formatDate(row.requiredDate)}
            {row.attention.overdue ? ` · ${dueLabel(row.attention.daysToRequired)}` : ""}
          </span>
        ) : (
          <span className="text-fg-subtle">No date</span>
        ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      records={requests}
      rowKey={(row) => row.id}
      rowHref={(row) => `/procurement/requests/${row.id}`}
      caption={caption}
    />
  );
}
