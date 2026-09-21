import { DataTable, type TableColumn } from "@/components/data/data-table";
import { StatusBadge } from "@/components/modules/status-badge";
import type { SupplierSummaryDTO } from "@/lib/modules/procurement/procurement.types";
import { supplierTypeLabels } from "@/lib/modules/procurement/procurement.status";
import { companyColumn, isGroupRows, RecordLink } from "./company-cells";

/** The supplier directory (PRD #19 §32). */
export function SupplierTable({
  suppliers,
  caption = "Suppliers",
}: {
  suppliers: SupplierSummaryDTO[];
  caption?: string;
}) {
  const grouped = isGroupRows(suppliers);

  const columns: TableColumn<SupplierSummaryDTO>[] = [
    {
      key: "name",
      label: "Supplier",
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
    ...(grouped ? [companyColumn<SupplierSummaryDTO>()] : []),
    {
      key: "supplierType",
      label: "Type",
      hideBelow: "lg",
      render: (row) => supplierTypeLabels[row.supplierType],
    },
    {
      key: "country",
      label: "Country",
      hideBelow: "xl",
      render: (row) => row.country ?? <span className="text-fg-subtle">—</span>,
    },
    {
      key: "paymentTermsDays",
      label: "Terms",
      hideBelow: "xl",
      render: (row) =>
        row.paymentTermsDays === null ? (
          <span className="text-fg-subtle">—</span>
        ) : (
          `${row.paymentTermsDays} days`
        ),
    },
    {
      key: "openOrders",
      label: "Open orders",
      align: "right",
      hideBelow: "md",
      render: (row) => <span className="tabular-nums">{row.openOrders}</span>,
    },
    {
      key: "status",
      label: "Status",
      render: (row) => <StatusBadge status={row.status} />,
    },
  ];

  return (
    <DataTable
      columns={columns}
      records={suppliers}
      rowKey={(row) => row.id}
      rowHref={grouped ? undefined : (row) => `/procurement/suppliers/${row.id}`}
      caption={caption}
    />
  );
}
