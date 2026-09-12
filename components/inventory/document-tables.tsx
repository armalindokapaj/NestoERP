import Link from "next/link";

import { DataTable, type TableColumn } from "@/components/data/data-table";
import { StatusBadge } from "@/components/modules/status-badge";
import type {
  AdjustmentSummaryDTO,
  IssueSummaryDTO,
  ReceiptSummaryDTO,
  ReturnSummaryDTO,
  TransferSummaryDTO,
} from "@/lib/modules/inventory/inventory.types";
import { adjustmentReasonLabels } from "@/lib/modules/inventory/inventory.status";
import { formatDate } from "@/lib/utils/format";

/**
 * The five stock-document lists (PRD #20 §323–§325).
 *
 * They share a shape on purpose — number, where, when, how many lines, status —
 * because they are the same act with different directions, and a storeman
 * should not have to relearn the table each time.
 */

function lineLabel(count: number): string {
  return `${count} ${count === 1 ? "line" : "lines"}`;
}

export function ReceiptTable({
  receipts,
  caption = "Receipts",
}: {
  receipts: ReceiptSummaryDTO[];
  caption?: string;
}) {
  const columns: TableColumn<ReceiptSummaryDTO>[] = [
    {
      key: "receiptNumber",
      label: "Receipt",
      primary: true,
      render: (row) => (
        <span className="flex flex-col">
          <span className="font-medium text-fg">{row.receiptNumber}</span>
          {row.goodsReceiptLink ? (
            <span className="text-meta text-fg-subtle">From {row.goodsReceiptLink.label}</span>
          ) : (
            <span className="text-meta text-fg-subtle">Recorded directly</span>
          )}
        </span>
      ),
    },
    {
      key: "warehouse",
      label: "Warehouse",
      hideBelow: "md",
      render: (row) => row.warehouse.name,
    },
    {
      key: "receiptDate",
      label: "Date",
      render: (row) => formatDate(row.receiptDate),
    },
    {
      key: "lineCount",
      label: "Lines",
      align: "right",
      hideBelow: "lg",
      render: (row) => <span className="tabular-nums">{row.lineCount}</span>,
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
      records={receipts}
      rowKey={(row) => row.id}
      rowHref={(row) => `/inventory/receipts/${row.id}`}
      caption={caption}
    />
  );
}

export function IssueTable({
  issues,
  showProject = true,
  caption = "Issues",
}: {
  issues: IssueSummaryDTO[];
  showProject?: boolean;
  caption?: string;
}) {
  const columns: TableColumn<IssueSummaryDTO>[] = [
    {
      key: "issueNumber",
      label: "Issue",
      primary: true,
      render: (row) => (
        <span className="flex flex-col">
          <span className="font-medium text-fg">{row.issueNumber}</span>
          <span className="text-meta text-fg-subtle">
            {row.issuedTo ? `To ${row.issuedTo.fullName}` : lineLabel(row.lineCount)}
          </span>
        </span>
      ),
    },
  ];

  if (showProject) {
    columns.push({
      key: "project",
      label: "Project",
      hideBelow: "md",
      render: (row) =>
        row.project ? (
          <span className="flex flex-col">
            <span>{row.project.code}</span>
            <span className="text-meta text-fg-subtle">{row.project.name}</span>
          </span>
        ) : (
          <span className="text-fg-subtle">General</span>
        ),
    });
  }

  columns.push(
    {
      key: "warehouse",
      label: "Warehouse",
      hideBelow: "lg",
      render: (row) => row.warehouse.name,
    },
    {
      key: "issueDate",
      label: "Date",
      render: (row) => formatDate(row.issueDate),
    },
    {
      key: "lineCount",
      label: "Lines",
      align: "right",
      hideBelow: "xl",
      render: (row) => <span className="tabular-nums">{row.lineCount}</span>,
    },
    {
      key: "status",
      label: "Status",
      render: (row) => <StatusBadge status={row.status} />,
    },
  );

  return (
    <DataTable
      columns={columns}
      records={issues}
      rowKey={(row) => row.id}
      rowHref={(row) => `/inventory/issues/${row.id}`}
      caption={caption}
    />
  );
}

export function ReturnTable({
  returns,
  caption = "Returns",
}: {
  returns: ReturnSummaryDTO[];
  caption?: string;
}) {
  const columns: TableColumn<ReturnSummaryDTO>[] = [
    {
      key: "returnNumber",
      label: "Return",
      primary: true,
      render: (row) => (
        <span className="flex flex-col">
          <span className="font-medium text-fg">{row.returnNumber}</span>
          <span className="text-meta text-fg-subtle">{lineLabel(row.lineCount)}</span>
        </span>
      ),
    },
    {
      key: "project",
      label: "From project",
      hideBelow: "md",
      render: (row) => (
        <span className="flex flex-col">
          <span>{row.project.code}</span>
          <span className="text-meta text-fg-subtle">{row.project.name}</span>
        </span>
      ),
    },
    {
      key: "warehouse",
      label: "Back into",
      hideBelow: "lg",
      render: (row) => row.warehouse.name,
    },
    {
      key: "returnDate",
      label: "Date",
      render: (row) => formatDate(row.returnDate),
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
      records={returns}
      rowKey={(row) => row.id}
      rowHref={(row) => `/inventory/returns/${row.id}`}
      caption={caption}
    />
  );
}

export function TransferTable({
  transfers,
  caption = "Transfers",
}: {
  transfers: TransferSummaryDTO[];
  caption?: string;
}) {
  const columns: TableColumn<TransferSummaryDTO>[] = [
    {
      key: "transferNumber",
      label: "Transfer",
      primary: true,
      render: (row) => (
        <span className="flex flex-col">
          <span className="font-medium text-fg">{row.transferNumber}</span>
          <span className="text-meta text-fg-subtle">
            {row.fromWarehouse.code} → {row.toWarehouse.code}
          </span>
        </span>
      ),
    },
    {
      key: "route",
      label: "Route",
      hideBelow: "lg",
      render: (row) => (
        <span>
          {row.fromWarehouse.name}
          <span className="text-fg-subtle"> → </span>
          {row.toWarehouse.name}
        </span>
      ),
    },
    {
      key: "transferDate",
      label: "Date",
      render: (row) => formatDate(row.transferDate),
    },
    {
      key: "lineCount",
      label: "Lines",
      align: "right",
      hideBelow: "md",
      render: (row) => <span className="tabular-nums">{row.lineCount}</span>,
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
      records={transfers}
      rowKey={(row) => row.id}
      rowHref={(row) => `/inventory/transfers/${row.id}`}
      caption={caption}
    />
  );
}

export function AdjustmentTable({
  adjustments,
  caption = "Adjustments",
}: {
  adjustments: AdjustmentSummaryDTO[];
  caption?: string;
}) {
  const columns: TableColumn<AdjustmentSummaryDTO>[] = [
    {
      key: "adjustmentNumber",
      label: "Adjustment",
      primary: true,
      render: (row) => (
        <span className="flex flex-col">
          <span className="font-medium text-fg">{row.adjustmentNumber}</span>
          <span className="text-meta text-fg-subtle">{adjustmentReasonLabels[row.reason]}</span>
        </span>
      ),
    },
    {
      key: "warehouse",
      label: "Warehouse",
      hideBelow: "md",
      render: (row) => row.warehouse.name,
    },
    {
      key: "adjustmentDate",
      label: "Date",
      render: (row) => formatDate(row.adjustmentDate),
    },
    {
      key: "lineCount",
      label: "Lines",
      align: "right",
      hideBelow: "lg",
      render: (row) => <span className="tabular-nums">{row.lineCount}</span>,
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
      records={adjustments}
      rowKey={(row) => row.id}
      rowHref={(row) => `/inventory/adjustments/${row.id}`}
      caption={caption}
    />
  );
}

/** A link back to the Procurement delivery a receipt came from (PRD #20 §89). */
export function SourceLink({
  link,
}: {
  link: { label: string; href: string | null } | null;
}) {
  if (!link) return <span className="text-fg-subtle">—</span>;
  return link.href ? (
    <Link href={link.href} className="text-accent-strong hover:underline">
      {link.label}
    </Link>
  ) : (
    <span>{link.label}</span>
  );
}
