import { DataTable, type TableColumn } from "@/components/data/data-table";
import { StatusBadge } from "@/components/modules/status-badge";
import { PersonLink } from "@/components/people/person-link";
import type { RequestSummaryDTO } from "@/lib/modules/procurement/procurement.types";
import { priorityLabels } from "@/lib/modules/procurement/procurement.status";
import { formatDate } from "@/lib/utils/format";
import { companyColumn, isGroupRows, RecordLink } from "./company-cells";
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
  const grouped = isGroupRows(requests);

  const columns: TableColumn<RequestSummaryDTO>[] = [
    {
      key: "requestNumber",
      id: "requestNumber",
      mandatory: true,
      label: "Request",
      primary: true,
      render: (row) => (
        <RecordLink company={row.company} href={`/procurement/requests/${row.id}`}>
          <span className="flex flex-col">
            <span className="font-medium text-fg">{row.requestNumber}</span>
            <span className="text-meta text-fg-subtle">{row.title}</span>
          </span>
        </RecordLink>
      ),
    },
    ...(grouped ? [companyColumn<RequestSummaryDTO>()] : []),
    ...(showProject
      ? [
          {
            key: "project",
            id: "project",
            label: "Project",
            hideBelow: "lg" as const,
            render: (row: RequestSummaryDTO) =>
              row.project?.code ?? <span className="text-fg-subtle">Company</span>,
          },
        ]
      : []),
    {
      key: "requestedBy",
      id: "requestedBy",
      label: "Raised by",
      hideBelow: "xl",
      render: (row) => (
        <span className={row.requestedBy.active ? undefined : "text-fg-subtle"}>
          <PersonLink memberId={row.requestedBy.memberId} name={row.requestedBy.fullName} />
          {row.requestedBy.active ? "" : " (inactive)"}
        </span>
      ),
    },
    {
      key: "priority",
      id: "priority",
      valueType: "status",
      label: "Priority",
      hideBelow: "xl",
      render: (row) => priorityLabels[row.priority],
    },
    {
      key: "estimatedTotal",
      id: "estimatedTotal",
      valueType: "money",
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
      id: "status",
      mandatory: true,
      valueType: "status",
      label: "Status",
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: "requiredDate",
      id: "requiredDate",
      valueType: "date",
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
      listId="procurement.requests"
      columns={columns}
      records={requests}
      rowKey={(row) => row.id}
      rowHref={grouped ? undefined : (row) => `/procurement/requests/${row.id}`}
      caption={caption}
    />
  );
}
