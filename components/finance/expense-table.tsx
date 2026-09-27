import { DataTable, type TableColumn } from "@/components/data/data-table";
import type { TableSortConfig } from "@/components/data/sort-header";
import { companyColumn, GroupRecordLink } from "@/components/finance/group-rows";
import { Money } from "@/components/finance/money";
import { StatusBadge } from "@/components/modules/status-badge";
import { Badge } from "@/components/ui/badge";
import type { ExpenseSummaryDTO } from "@/lib/modules/finance/finance.types";
import { getTranslations } from "@/lib/i18n/server";
import { formatDate, orDash } from "@/lib/utils/format";

/** The expense list (PRD #15 §167). */
const SETTLEMENT_TONES = {
  PAID: "success",
  PARTIALLY_PAID: "info",
  UNPAID: "neutral",
} as const;

export async function ExpenseTable({ expenses, listId = "finance.expenses", sort }: {
  expenses: ExpenseSummaryDTO[];
  /** The table's own list id: a nested use names its own, so its column choice is its own (AUD-08 §5). */
  listId?: string;
  /** The list's parsed sort and allowlist; header sorts only where the page reads the `sort` they write (AUD-08 §4). */
  sort?: TableSortConfig;
}) {
  const t = await getTranslations("finance");
  // Rows read in the Group workspace name their company and open through it.
  const grouped = expenses.some((expense) => expense.company);

  const columns: TableColumn<ExpenseSummaryDTO>[] = [
    {
      key: "description",
      id: "description",
      mandatory: true,
      label: t("columns.expense"),
      primary: true,
      render: (expense) => {
        const label = (
          <span className="min-w-0">
            <span className="block truncate">{expense.description}</span>
            <span className="block truncate text-meta font-normal text-fg-subtle">
              {expense.expenseNumber ? `${expense.expenseNumber} · ` : ""}
              {orDash(expense.payeeName)}
            </span>
          </span>
        );
        return grouped && expense.company ? (
          <GroupRecordLink company={expense.company} href={`/finance/expenses/${expense.id}`}>
            {label}
          </GroupRecordLink>
        ) : (
          label
        );
      },
    },
    ...(grouped ? [companyColumn<ExpenseSummaryDTO>(t("group.company"))] : []),
    {
      key: "category",
      id: "category",
      label: t("columns.category"),
      hideBelow: "lg",
      render: (expense) => (
        <Badge tone="neutral">{t(`category.${expense.category}`)}</Badge>
      ),
    },
    {
      key: "project",
      id: "project",
      label: t("columns.project"),
      hideBelow: "xl",
      render: (expense) => (
        <span className="text-fg-muted">{expense.project?.name ?? t("companyWide")}</span>
      ),
    },
    {
      key: "date",
      id: "date",
      valueType: "date",
      sortKey: sort ? "date" : undefined,
      label: t("columns.date"),
      hideBelow: "lg",
      render: (expense) => (
        <span className="text-fg-muted">{formatDate(expense.expenseDate)}</span>
      ),
    },
    {
      key: "total",
      id: "total",
      mandatory: true,
      valueType: "money",
      sortKey: sort ? "amount" : undefined,
      label: t("columns.total"),
      align: "right",
      render: (expense) => (
        <Money amount={expense.totalAmount} currency={expense.currency} emphasis />
      ),
    },
    {
      key: "status",
      id: "status",
      mandatory: true,
      valueType: "status",
      label: t("columns.status"),
      render: (expense) => <StatusBadge status={expense.status} />,
    },
    {
      key: "settlement",
      id: "settlement",
      valueType: "status",
      label: t("columns.paid"),
      hideBelow: "md",
      render: (expense) => (
        <Badge tone={SETTLEMENT_TONES[expense.settlementStatus]}>
          {t(`expenseSettlement.${expense.settlementStatus}`)}
        </Badge>
      ),
    },
  ];

  return (
    <DataTable
      listId={listId}
      sort={sort}
      caption={t("captions.expenses")}
      columns={columns}
      records={expenses}
      rowKey={(expense) => expense.id}
      rowHref={grouped ? undefined : (expense) => `/finance/expenses/${expense.id}`}
    />
  );
}
