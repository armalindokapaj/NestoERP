import { DataTable, type TableColumn } from "@/components/data/data-table";
import { StatusBadge } from "@/components/modules/status-badge";
import type { RfqSummaryDTO } from "@/lib/modules/procurement/procurement.types";
import { formatDate } from "@/lib/utils/format";
import { getTranslations } from "@/lib/i18n/server";

/** The enquiry list (PRD #19 §252). */
export async function RfqTable({
  rfqs,
  caption,
}: {
  rfqs: RfqSummaryDTO[];
  caption?: string;
}) {
  const t = await getTranslations("procurement");
  const columns: TableColumn<RfqSummaryDTO>[] = [
    {
      key: "rfqNumber",
      id: "rfqNumber",
      mandatory: true,
      label: t("common.enquiry"),
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
      id: "project",
      label: t("common.project"),
      hideBelow: "xl",
      render: (row) => row.project?.code ?? <span className="text-fg-subtle">{t("common.company")}</span>,
    },
    {
      key: "responses",
      id: "responses",
      valueType: "number",
      label: t("rfqs.responses"),
      align: "right",
      render: (row) => (
        <span className="tabular-nums">
          {row.respondedCount} / {row.invitedCount}
        </span>
      ),
    },
    {
      key: "status",
      id: "status",
      mandatory: true,
      valueType: "status",
      label: t("common.status"),
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: "responseDueDate",
      id: "responseDueDate",
      valueType: "date",
      label: t("rfqs.responsesBy"),
      hideBelow: "md",
      render: (row) =>
        row.responseDueDate ? (
          <span className={row.overdue ? "text-warning-strong" : undefined}>
            {formatDate(row.responseDueDate)}
            {row.overdue ? t("rfqs.overdueSuffix") : ""}
          </span>
        ) : (
          <span className="text-fg-subtle">{t("common.noDate")}</span>
        ),
    },
  ];

  return (
    <DataTable
      listId="procurement.rfqs"
      columns={columns}
      records={rfqs}
      rowKey={(row) => row.id}
      rowHref={(row) => `/procurement/rfqs/${row.id}`}
      caption={caption ?? t("rfqs.caption")}
    />
  );
}
