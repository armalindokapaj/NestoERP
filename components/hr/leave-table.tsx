import { DataTable, type TableColumn } from "@/components/data/data-table";
import { StatusBadge } from "@/components/modules/status-badge";
import { leaveTypeLabels } from "@/lib/modules/hr/hr.status";
import type { LeaveRequestDTO } from "@/lib/modules/hr/hr.types";
import { formatDate } from "@/lib/utils/format";
import { formatDays } from "./hr-format";

/**
 * The leave list (PRD #16 §307).
 *
 * The reason is never a column. It may be medical, and it is only in the DTO at
 * all for a reader who is the requester or holds `hr.leave.reason.view`
 * (PRD #16 §95).
 */
export function LeaveTable({
  requests,
  showEmployee = true,
}: {
  requests: LeaveRequestDTO[];
  /** Hidden on a single employee's own list, where every row is the same person. */
  showEmployee?: boolean;
}) {
  const columns: TableColumn<LeaveRequestDTO>[] = [
    ...(showEmployee
      ? [
          {
            key: "employee",
            label: "Employee",
            primary: true,
            render: (request: LeaveRequestDTO) => (
              <span className="min-w-0">
                <span className="block truncate">{request.employee.fullName}</span>
                <span className="block truncate text-meta font-normal text-fg-subtle">
                  {leaveTypeLabels[request.leaveType]}
                </span>
              </span>
            ),
          },
        ]
      : [
          {
            key: "leaveType",
            label: "Type",
            primary: true,
            render: (request: LeaveRequestDTO) => <span>{leaveTypeLabels[request.leaveType]}</span>,
          },
        ]),
    ...(showEmployee
      ? [
          {
            key: "leaveType",
            label: "Type",
            hideBelow: "xl" as const,
            render: (request: LeaveRequestDTO) => (
              <span className="text-fg-muted">{leaveTypeLabels[request.leaveType]}</span>
            ),
          },
        ]
      : []),
    {
      key: "from",
      label: "From",
      render: (request) => <span className="text-fg-muted">{formatDate(request.startDate)}</span>,
    },
    {
      key: "to",
      label: "To",
      hideBelow: "md",
      render: (request) => <span className="text-fg-muted">{formatDate(request.endDate)}</span>,
    },
    {
      key: "days",
      label: "Days",
      align: "right",
      render: (request) => (
        <span className="tabular-nums text-fg">{formatDays(request.days)}</span>
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (request) => <StatusBadge status={request.status} />,
    },
    {
      key: "decided",
      label: "Decided by",
      hideBelow: "xl",
      render: (request) => <span className="text-fg-muted">{request.decidedBy ?? "—"}</span>,
    },
  ];

  return (
    <DataTable
      caption="Leave requests"
      columns={columns}
      records={requests}
      rowKey={(request) => request.id}
      rowHref={(request) => `/hr/leave/${request.id}`}
    />
  );
}
