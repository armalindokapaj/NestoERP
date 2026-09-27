import { DataTable, type TableColumn } from "@/components/data/data-table";
import { StatusBadge } from "@/components/modules/status-badge";
import type { SupplierSummaryDTO } from "@/lib/modules/procurement/procurement.types";
import { supplierTypeLabels } from "@/lib/modules/procurement/procurement.status";
import { companyColumn, isGroupRows, RecordLink } from "./company-cells";
import { procurementLabel } from "@/lib/i18n/modules/procurement/labels";
import { getTranslations } from "@/lib/i18n/server";

/** The supplier directory (PRD #19 §32). */
export async function SupplierTable({
  suppliers,
  caption,
}: {
  suppliers: SupplierSummaryDTO[];
  caption?: string;
}) {
  const grouped = isGroupRows(suppliers);
  const t = await getTranslations("procurement");

  const columns: TableColumn<SupplierSummaryDTO>[] = [
    {
      key: "name",
      id: "name",
      mandatory: true,
      label: t("common.supplier"),
      primary: true,
      render: (row) => (
        <RecordLink company={row.company} href={`/procurement/suppliers/${row.id}`}>
          <span className="flex flex-col">
            <span className="font-medium text-fg">{row.name}</span>
            {row.code ? <span className="text-meta text-fg-subtle">{row.code}</span> : null}
          </span>
        </RecordLink>
      ),
    },
    ...(grouped ? [companyColumn<SupplierSummaryDTO>(t("common.company"))] : []),
    {
      key: "supplierType",
      id: "supplierType",
      label: t("common.type"),
      hideBelow: "lg",
      render: (row) => procurementLabel(t, "supplierType", row.supplierType, supplierTypeLabels[row.supplierType]),
    },
    {
      key: "country",
      id: "country",
      label: t("common.country"),
      hideBelow: "xl",
      render: (row) => row.country ?? <span className="text-fg-subtle">—</span>,
    },
    {
      key: "paymentTermsDays",
      id: "paymentTermsDays",
      valueType: "number",
      label: t("suppliers.terms"),
      hideBelow: "xl",
      render: (row) =>
        row.paymentTermsDays === null ? (
          <span className="text-fg-subtle">—</span>
        ) : (
          t("common.days", { count: row.paymentTermsDays })
        ),
    },
    {
      key: "openOrders",
      id: "openOrders",
      valueType: "number",
      label: t("suppliers.openOrders"),
      align: "right",
      hideBelow: "md",
      render: (row) => <span className="tabular-nums">{row.openOrders}</span>,
    },
    {
      key: "status",
      id: "status",
      mandatory: true,
      valueType: "status",
      label: t("common.status"),
      render: (row) => <StatusBadge status={row.status} />,
    },
  ];

  return (
    <DataTable
      listId="procurement.suppliers"
      columns={columns}
      records={suppliers}
      rowKey={(row) => row.id}
      rowHref={grouped ? undefined : (row) => `/procurement/suppliers/${row.id}`}
      caption={caption ?? t("suppliers.caption")}
    />
  );
}
