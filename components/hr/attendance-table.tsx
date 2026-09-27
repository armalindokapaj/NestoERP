import { DataTable, type TableColumn } from "@/components/data/data-table";
import type { TableSortConfig } from "@/components/data/sort-header";
import { StatusBadge } from "@/components/modules/status-badge";
import { Badge } from "@/components/ui/badge";
import { attendanceSourceLabels } from "@/lib/modules/hr/hr.status";
import type { AttendanceDTO } from "@/lib/modules/hr/hr.types";
import { formatDate } from "@/lib/utils/format";
import { formatTimeOfDay, formatWorkedMinutes } from "./hr-format";

/**
 * The attendance list (PRD #16 §308).
 *
 * Worked time is shown, never entered: it is derived from check-in and
 * check-out by the service, so the column can't disagree with the record
 * (PRD #16 §106).
 */
export function AttendanceTable({
  records,
  showEmployee = true,
  listId = "hr.attendance",
  sort,
}: {
  records: AttendanceDTO[];
  showEmployee?: boolean;
  /** The table's own list id: a nested use names its own, so its column choice is its own (AUD-08 §5). */
  listId?: string;
  /** The list's parsed sort and allowlist; header sorts only where the page reads the `sort` they write (AUD-08 §4). */
  sort?: TableSortConfig;
}) {
  const columns: TableColumn<AttendanceDTO>[] = [
    ...(showEmployee
      ? [
          {
            key: "employee",
            id: "employee",
            mandatory: true,
            label: "Employee",
            primary: true,
            render: (record: AttendanceDTO) => (
              <span className="min-w-0">
                <span className="block truncate">{record.employee.fullName}</span>
                <span className="block truncate text-meta font-normal text-fg-subtle">
                  {formatDate(record.date)}
                </span>
              </span>
            ),
          },
        ]
      : [
          {
            key: "date",
            id: "date",
            mandatory: true,
            valueType: "date" as const,
            sortKey: sort ? "date" : undefined,
            label: "Date",
            primary: true,
            render: (record: AttendanceDTO) => <span>{formatDate(record.date)}</span>,
          },
        ]),
    ...(showEmployee
      ? [
          {
            key: "date",
            id: "date",
            mandatory: true,
            valueType: "date" as const,
            sortKey: sort ? "date" : undefined,
            label: "Date",
            hideBelow: "xl" as const,
            render: (record: AttendanceDTO) => (
              <span className="text-fg-muted">{formatDate(record.date)}</span>
            ),
          },
        ]
      : []),
    {
      key: "status",
      id: "status",
      mandatory: true,
      valueType: "status",
      label: "Status",
      render: (record) => <StatusBadge status={record.status} />,
    },
    {
      key: "checkIn",
      id: "checkIn",
      label: "Check in",
      hideBelow: "md",
      render: (record) => (
        <span className="tabular-nums text-fg-muted">{formatTimeOfDay(record.checkIn)}</span>
      ),
    },
    {
      key: "checkOut",
      id: "checkOut",
      label: "Check out",
      hideBelow: "md",
      render: (record) => (
        <span className="tabular-nums text-fg-muted">{formatTimeOfDay(record.checkOut)}</span>
      ),
    },
    {
      key: "worked",
      id: "worked",
      valueType: "number",
      label: "Worked",
      align: "right",
      render: (record) => (
        <span className="tabular-nums text-fg">{formatWorkedMinutes(record.workedMinutes)}</span>
      ),
    },
    {
      key: "source",
      id: "source",
      label: "Source",
      hideBelow: "xl",
      render: (record) => (
        <span className="text-fg-muted">{attendanceSourceLabels[record.source]}</span>
      ),
    },
    {
      key: "exception",
      id: "exception",
      label: "Flag",
      hideBelow: "lg",
      render: (record) =>
        record.isException ? <Badge tone="warning">Needs a look</Badge> : <span>—</span>,
    },
  ];

  return (
    <DataTable
      listId={listId}
      sort={sort}
      caption="Attendance"
      columns={columns}
      records={records}
      rowKey={(record) => record.id}
      rowHref={(record) => `/hr/attendance/${record.id}`}
    />
  );
}
