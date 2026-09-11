import { DataTable, type TableColumn } from "@/components/data/data-table";
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

export function ExpenseTable({ expenses }: { expenses: ExpenseSummaryDTO[] }) {
  const columns: TableColumn<ExpenseSummaryDTO>[] = [
    {
      key: "description",
      label: "Expense",
      primary: true,
      render: (expense) => (
        <span className="min-w-0">
          <span className="block truncate">{expense.description}</span>
          <span className="block truncate text-meta font-normal text-fg-subtle">
            {expense.expenseNumber ? `${expense.expenseNumber} · ` : ""}
            {orDash(expense.payeeName)}
          </span>
        </span>
      ),
    },
    {
      key: "category",
      label: "Category",
      hideBelow: "lg",
      render: (expense) => (
        <Badge tone="neutral">{expenseCategoryLabels[expense.category]}</Badge>
      ),
    },
    {
      key: "project",
      label: "Project",
      hideBelow: "xl",
      render: (expense) => (
        <span className="text-fg-muted">{expense.project?.name ?? "Company-wide"}</span>
      ),
    },
    {
      key: "date",
      label: "Date",
      hideBelow: "lg",
      render: (expense) => (
        <span className="text-fg-muted">{formatDate(expense.expenseDate)}</span>
      ),
    },
    {
      key: "total",
      label: "Total",
      align: "right",
      render: (expense) => (
        <Money amount={expense.totalAmount} currency={expense.currency} emphasis />
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (expense) => <StatusBadge status={expense.status} />,
    },
    {
      key: "settlement",
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
      caption="Expenses"
      columns={columns}
      records={expenses}
      rowKey={(expense) => expense.id}
      rowHref={(expense) => `/finance/expenses/${expense.id}`}
    />
  );
}
