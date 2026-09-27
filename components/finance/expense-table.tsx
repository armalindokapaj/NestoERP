import { DataTable, type TableColumn } from "@/components/data/data-table";
import type { TableSortConfig } from "@/components/data/sort-header";
import { companyColumn, GroupRecordLink } from "@/components/finance/group-rows";
import { Money } from "@/components/finance/money";
import { StatusBadge } from "@/components/modules/status-badge";
import { Badge } from "@/components/ui/badge";
import { expenseCategoryLabels } from "@/lib/modules/finance/expenses/expense.status";
import type { ExpenseSummaryDTO } from "@/lib/modules/finance/finance.types";
import { formatDate, orDash } from "@/lib/utils/format";

/** The expense list (PRD #15 §167). */
const SETTLEMENT_TONES = {
  PAID: "success",
  PARTIALLY_PAID: "info",
  UNPAID: "neutral",
} as const;

export function ExpenseTable({ expenses, listId = "finance.expenses", sort }: {
  expenses: ExpenseSummaryDTO[];
  /** The table's own list id: a nested use names its own, so its column choice is its own (AUD-08 §5). */
  listId?: string;
  /** The list's parsed sort and allowlist; header sorts only where the page reads the `sort` they write (AUD-08 §4). */
  sort?: TableSortConfig;
}) {
  // Rows read in the Group workspace name their company and open through it.
  const grouped = expenses.some((expense) => expense.company);

  const columns: TableColumn<ExpenseSummaryDTO>[] = [
    {
      key: "description",
      id: "description",
      mandatory: true,
      label: "Expense",
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
    ...(grouped ? [companyColumn<ExpenseSummaryDTO>()] : []),
    {
      key: "category",
      id: "category",
      label: "Category",
      hideBelow: "lg",
      render: (expense) => (
        <Badge tone="neutral">{expenseCategoryLabels[expense.category]}</Badge>
      ),
    },
    {
      key: "project",
      id: "project",
      label: "Project",
      hideBelow: "xl",
      render: (expense) => (
        <span className="text-fg-muted">{expense.project?.name ?? "Company-wide"}</span>
      ),
    },
    {
      key: "date",
      id: "date",
      valueType: "date",
      sortKey: sort ? "date" : undefined,
      label: "Date",
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
      label: "Total",
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
      label: "Status",
      render: (expense) => <StatusBadge status={expense.status} />,
    },
    {
      key: "settlement",
      id: "settlement",
      valueType: "status",
      label: "Paid",
      hideBelow: "md",
      render: (expense) => (
        <Badge tone={SETTLEMENT_TONES[expense.settlementStatus]}>
          {expense.settlementStatus === "PARTIALLY_PAID"
            ? "Part paid"
            : expense.settlementStatus === "PAID"
              ? "Paid"
              : "Unpaid"}
        </Badge>
      ),
    },
  ];

  return (
    <DataTable
      listId={listId}
      sort={sort}
      caption="Expenses"
      columns={columns}
      records={expenses}
      rowKey={(expense) => expense.id}
      rowHref={grouped ? undefined : (expense) => `/finance/expenses/${expense.id}`}
    />
  );
}
