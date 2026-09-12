import { DataTable, type TableColumn } from "@/components/data/data-table";
import { StatusBadge } from "@/components/modules/status-badge";
import type { ContractSummaryDTO } from "@/lib/modules/contracts/contract.types";
import { contractTypeLabels } from "@/lib/modules/contracts/contracts/contract.schema";
import { formatDate } from "@/lib/utils/format";
import { commercialLabel, expiryLabel } from "./contract-format";

/**
 * The contract list (PRD #18 §82, §350, §495).
 *
 * The value column exists only when the reader may see values: a column of
 * dashes would still tell them there is a figure they are not being shown
 * (PRD #18 §495).
 *
 * Expiry is stated in words as well as colour, because "the orange one" is not
 * a state a keyboard or a screen reader can perceive (PRD #18 §350, §360).
 */
export function ContractTable({
  contracts,
  showClient = true,
  showProject = true,
  caption = "Contracts",
}: {
  contracts: ContractSummaryDTO[];
  showClient?: boolean;
  showProject?: boolean;
  caption?: string;
}) {
  const showValue = contracts.some((row) => row.commercial !== null);

  const columns: TableColumn<ContractSummaryDTO>[] = [
    {
      key: "contractNumber",
      label: "Contract",
      primary: true,
      render: (row) => (
        <span className="flex flex-col">
          <span className="font-medium text-fg">{row.contractNumber}</span>
          <span className="text-meta text-fg-subtle">{row.title}</span>
        </span>
      ),
    },
    {
      key: "type",
      label: "Type",
      hideBelow: "xl",
      render: (row) => contractTypeLabels[row.contractType],
    },
    ...(showClient
      ? [
          {
            key: "client",
            label: "Client / counterparty",
            hideBelow: "md" as const,
            render: (row: ContractSummaryDTO) =>
              row.client?.name ??
              row.counterpartyName ?? <span className="text-fg-subtle">No counterparty</span>,
          },
        ]
      : []),
    ...(showProject
      ? [
          {
            key: "project",
            label: "Project",
            hideBelow: "xl" as const,
            render: (row: ContractSummaryDTO) =>
              row.project?.code ?? <span className="text-fg-subtle">—</span>,
          },
        ]
      : []),
    {
      key: "owner",
      label: "Owner",
      hideBelow: "xl",
      render: (row) => (
        <span className={row.owner.active ? undefined : "text-fg-subtle"}>
          {row.owner.fullName}
          {row.owner.active ? "" : " (inactive)"}
        </span>
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (row) => <StatusBadge status={row.attention.effectiveStatus} />,
    },
    {
      key: "expiry",
      label: "Expiry",
      hideBelow: "lg",
      render: (row) =>
        row.expiryDate ? (
          <span
            className={
              row.attention.expiringSoon || row.attention.effectiveStatus === "EXPIRED"
                ? "text-warning-strong"
                : undefined
            }
          >
            {formatDate(row.expiryDate)}
            {row.attention.expiringSoon ? ` · ${expiryLabel(row.attention.daysToExpiry)}` : ""}
          </span>
        ) : (
          <span className="text-fg-subtle">No fixed expiry</span>
        ),
    },
  ];

  if (showValue) {
    columns.splice(columns.length - 2, 0, {
      key: "value",
      label: "Value",
      align: "right",
      render: (row) => (
        <span className="tabular-nums">{commercialLabel(row.commercial) ?? "—"}</span>
      ),
    });
  }

  return (
    <DataTable
      columns={columns}
      records={contracts}
      rowKey={(row) => row.id}
      rowHref={(row) => `/contracts/${row.id}`}
      caption={caption}
    />
  );
}
