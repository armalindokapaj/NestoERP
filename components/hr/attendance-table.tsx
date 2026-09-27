import { DataTable, type TableColumn } from "@/components/data/data-table";
import type { TableSortConfig } from "@/components/data/sort-header";
import { StatusBadge } from "@/components/modules/status-badge";
import { Badge } from "@/components/ui/badge";
import { getTranslations } from "@/lib/i18n/server";
import { hrLabel } from "./hr-labels";
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
export async function AttendanceTable({
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
  const t = await getTranslations("hr");
  const columns: TableColumn<AttendanceDTO>[] = [
    ...(showEmployee
      ? [
          {
            key: "employee",
            id: "employee",
            mandatory: true,
            label: t("columns.employee"),
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
            label: t("attendance.date"),
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
            label: t("attendance.date"),
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
      label: t("columns.status"),
      render: (record) => <StatusBadge status={record.status} />,
    },
    {
      key: "checkIn",
      id: "checkIn",
      label: t("attendance.checkIn"),
      hideBelow: "md",
      render: (record) => (
        <span className="tabular-nums text-fg-muted">{formatTimeOfDay(record.checkIn)}</span>
      ),
    },
    {
      key: "checkOut",
      id: "checkOut",
      label: t("attendance.checkOut"),
      hideBelow: "md",
      render: (record) => (
        <span className="tabular-nums text-fg-muted">{formatTimeOfDay(record.checkOut)}</span>
      ),
    },
    {
      key: "worked",
      id: "worked",
      valueType: "number",
      label: t("attendance.worked"),
      align: "right",
      render: (record) => (
        <span className="tabular-nums text-fg">{formatWorkedMinutes(record.workedMinutes)}</span>
      ),
    },
    {
      key: "source",
      id: "source",
      label: t("attendance.source"),
      hideBelow: "xl",
      render: (record) => (
        <span className="text-fg-muted">{hrLabel(t, "attendanceSource", record.source)}</span>
      ),
    },
    {
      key: "exception",
      id: "exception",
      label: t("attendance.flag"),
      hideBelow: "lg",
      render: (record) =>
        record.isException ? <Badge tone="warning">{t("attendance.needsLook")}</Badge> : <span>—</span>,
    },
  ];

  return (
    <DataTable
      listId={listId}
      sort={sort}
      caption={t("meta.attendance")}
      columns={columns}
      records={records}
      rowKey={(record) => record.id}
      rowHref={(record) => `/hr/attendance/${record.id}`}
    />
  );
}
