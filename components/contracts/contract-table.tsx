import { DataTable, type TableColumn } from "@/components/data/data-table";
import { StatusBadge } from "@/components/modules/status-badge";
import { PersonLink } from "@/components/people/person-link";
import type { ContractSummaryDTO } from "@/lib/modules/contracts/contract.types";
import { contractTypeLabels } from "@/lib/modules/contracts/contracts/contract.schema";
import { contractsLabel } from "@/lib/i18n/modules/contracts/labels";
import { getTranslations } from "@/lib/i18n/server";
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
export async function ContractTable({
  contracts,
  showClient = true,
  showProject = true,
  caption,
  listId = "contracts.list",
}: {
  contracts: ContractSummaryDTO[];
  showClient?: boolean;
  showProject?: boolean;
  caption?: string;
  /** The table's own list id: a nested use names its own, so its column choice is its own (AUD-08 §5). */
  listId?: string;
}) {
  const t = await getTranslations("contracts");
  const showValue = contracts.some((row) => row.commercial !== null);

  const columns: TableColumn<ContractSummaryDTO>[] = [
    {
      key: "contractNumber",
      id: "contractNumber",
      mandatory: true,
      label: t("table.contract"),
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
      id: "type",
      label: t("table.type"),
      hideBelow: "xl",
      render: (row) => contractsLabel(t, "contractType", row.contractType, contractTypeLabels[row.contractType]),
    },
    ...(showClient
      ? [
          {
            key: "client",
            id: "client",
            label: t("table.client"),
            hideBelow: "md" as const,
            render: (row: ContractSummaryDTO) =>
              row.client?.name ??
              row.counterpartyName ?? <span className="text-fg-subtle">{t("common.noCounterparty")}</span>,
          },
        ]
      : []),
    ...(showProject
      ? [
          {
            key: "project",
            id: "project",
            label: t("table.project"),
            hideBelow: "xl" as const,
            render: (row: ContractSummaryDTO) =>
              row.project?.code ?? <span className="text-fg-subtle">—</span>,
          },
        ]
      : []),
    {
      key: "owner",
      id: "owner",
      label: t("table.owner"),
      hideBelow: "xl",
      render: (row) => (
        <span className={row.owner.active ? undefined : "text-fg-subtle"}>
          <PersonLink memberId={row.owner.memberId} name={row.owner.fullName} />
          {row.owner.active ? "" : t("common.inactiveSuffix")}
        </span>
      ),
    },
    {
      key: "status",
      id: "status",
      mandatory: true,
      valueType: "status",
      label: t("table.status"),
      render: (row) => <StatusBadge status={row.attention.effectiveStatus} />,
    },
    {
      key: "expiry",
      id: "expiry",
      valueType: "date",
      label: t("table.expiry"),
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
            {row.attention.expiringSoon ? ` · ${expiryLabel(row.attention.daysToExpiry, t)}` : ""}
          </span>
        ) : (
          <span className="text-fg-subtle">{t("format.noFixedExpiry")}</span>
        ),
    },
  ];

  if (showValue) {
    columns.splice(columns.length - 2, 0, {
      key: "value",
      id: "value",
      valueType: "money",
      label: t("table.value"),
      align: "right",
      render: (row) => (
        <span className="tabular-nums">{commercialLabel(row.commercial, t) ?? "—"}</span>
      ),
    });
  }

  return (
    <DataTable
      listId={listId}
      columns={columns}
      records={contracts}
      rowKey={(row) => row.id}
      rowHref={(row) => `/contracts/${row.id}`}
      caption={caption ?? t("table.caption")}
    />
  );
}
