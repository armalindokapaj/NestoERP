import { DataTable, type TableColumn } from "@/components/data/data-table";
import type { TableSortConfig } from "@/components/data/sort-header";
import { StatusBadge } from "@/components/modules/status-badge";
import { PersonLink } from "@/components/people/person-link";
import { getTranslations } from "@/lib/i18n/server";
import { hrLabel } from "./hr-labels";
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
export async function LeaveTable({
  requests,
  showEmployee = true,
  listId = "hr.leave",
  sort,
}: {
  requests: LeaveRequestDTO[];
  /** Hidden on a single employee's own list, where every row is the same person. */
  showEmployee?: boolean;
  /** The table's own list id: a nested use names its own, so its column choice is its own (AUD-08 §5). */
  listId?: string;
  /** The list's parsed sort and allowlist; header sorts only where the page reads the `sort` they write (AUD-08 §4). */
  sort?: TableSortConfig;
}) {
  const t = await getTranslations("hr");
  const columns: TableColumn<LeaveRequestDTO>[] = [
    ...(showEmployee
      ? [
          {
            key: "employee",
            id: "employee",
            mandatory: true,
            label: t("columns.employee"),
            primary: true,
            render: (request: LeaveRequestDTO) => (
              <span className="min-w-0">
                <span className="block truncate">{request.employee.fullName}</span>
                <span className="block truncate text-meta font-normal text-fg-subtle">
                  {hrLabel(t, "leaveType", request.leaveType)}
                </span>
              </span>
            ),
          },
        ]
      : [
          {
            key: "leaveType",
            id: "leaveType",
            mandatory: true,
            label: t("columns.type"),
            primary: true,
            render: (request: LeaveRequestDTO) => <span>{hrLabel(t, "leaveType", request.leaveType)}</span>,
          },
        ]),
    ...(showEmployee
      ? [
          {
            key: "leaveType",
            id: "leaveType",
            mandatory: true,
            label: t("columns.type"),
            hideBelow: "xl" as const,
            render: (request: LeaveRequestDTO) => (
              <span className="text-fg-muted">{hrLabel(t, "leaveType", request.leaveType)}</span>
            ),
          },
        ]
      : []),
    {
      key: "from",
      id: "from",
      valueType: "date",
      sortKey: sort ? "start" : undefined,
      label: t("leave.from"),
      render: (request) => <span className="text-fg-muted">{formatDate(request.startDate)}</span>,
    },
    {
      key: "to",
      id: "to",
      valueType: "date",
      label: t("leave.to"),
      hideBelow: "md",
      render: (request) => <span className="text-fg-muted">{formatDate(request.endDate)}</span>,
    },
    {
      key: "days",
      id: "days",
      valueType: "number",
      label: t("attendance.days"),
      align: "right",
      render: (request) => (
        <span className="tabular-nums text-fg">{formatDays(request.days)}</span>
      ),
    },
    {
      key: "status",
      id: "status",
      mandatory: true,
      valueType: "status",
      label: t("columns.status"),
      render: (request) => <StatusBadge status={request.status} />,
    },
    {
      key: "decided",
      id: "decided",
      label: t("leave.decidedBy"),
      hideBelow: "xl",
      render: (request) => (
        <span className="text-fg-muted">
          {request.decidedByMemberId ? <PersonLink memberId={request.decidedByMemberId} name={request.decidedByName} /> : "—"}
        </span>
      ),
    },
  ];

  return (
    <DataTable
      listId={listId}
      sort={sort}
      caption={t("leave.caption")}
      columns={columns}
      records={requests}
      rowKey={(request) => request.id}
      rowHref={(request) => `/hr/leave/${request.id}`}
    />
  );
}
