import { DataTable, type TableColumn } from "@/components/data/data-table";
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
}: {
  records: AttendanceDTO[];
  showEmployee?: boolean;
}) {
  const columns: TableColumn<AttendanceDTO>[] = [
    ...(showEmployee
      ? [
          {
            key: "employee",
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
            label: "Date",
            primary: true,
            render: (record: AttendanceDTO) => <span>{formatDate(record.date)}</span>,
          },
        ]),
    ...(showEmployee
      ? [
          {
            key: "date",
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
      label: "Status",
      render: (record) => <StatusBadge status={record.status} />,
    },
    {
      key: "checkIn",
      label: "Check in",
      hideBelow: "md",
      render: (record) => (
        <span className="tabular-nums text-fg-muted">{formatTimeOfDay(record.checkIn)}</span>
      ),
    },
    {
      key: "checkOut",
      label: "Check out",
      hideBelow: "md",
      render: (record) => (
        <span className="tabular-nums text-fg-muted">{formatTimeOfDay(record.checkOut)}</span>
      ),
    },
    {
      key: "worked",
      label: "Worked",
      align: "right",
      render: (record) => (
        <span className="tabular-nums text-fg">{formatWorkedMinutes(record.workedMinutes)}</span>
      ),
    },
    {
      key: "source",
      label: "Source",
      hideBelow: "xl",
      render: (record) => (
        <span className="text-fg-muted">{attendanceSourceLabels[record.source]}</span>
      ),
    },
    {
      key: "exception",
      label: "Flag",
      hideBelow: "lg",
      render: (record) =>
        record.isException ? <Badge tone="warning">Needs a look</Badge> : <span>—</span>,
    },
  ];

  return (
    <DataTable
      caption="Attendance"
      columns={columns}
      records={records}
      rowKey={(record) => record.id}
      rowHref={(record) => `/hr/attendance/${record.id}`}
    />
  );
}
