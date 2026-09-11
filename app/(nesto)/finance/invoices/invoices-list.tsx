import { ReceiptText } from "lucide-react";

import { ListToolbar, type FilterConfig } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { InvoiceTable } from "@/components/finance/invoice-table";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";
import { parseInvoiceQuery } from "@/lib/modules/finance/finance.query";
import { invoiceFilterOptions } from "@/lib/modules/finance/invoices/invoice.repository";
import * as invoices from "@/lib/modules/finance/invoices/invoice.service";

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * The invoice list (PRD #15 §160–§164).
 *
 * Filter options come from the invoices this reader can already see, so a
 * dropdown can never name a client or project they have no access to
 * (PRD #15 §175).
 */
export async function InvoicesList({
  context,
  searchParams,
  archived = false,
  basePath,
}: {
  context: UserContext;
  searchParams: SearchParams;
  archived?: boolean;
  basePath: string;
}) {
  const query = parseInvoiceQuery(searchParams, archived ? { archived: true } : {});

  const [result, options] = await Promise.all([
    invoices.listInvoices(context, query),
    invoiceFilterOptions(context),
  ]);

  const hasFilters = Boolean(
    query.search ||
      query.status?.length ||
      query.settlement?.length ||
      query.clientId ||
      query.projectId ||
      query.currency,
  );

  const filters: FilterConfig[] = [
    ...(archived
      ? []
      : [
          {
            param: "status",
            label: "Status",
            options: [
              { value: "DRAFT", label: "Draft" },
              { value: "PENDING_APPROVAL", label: "Pending approval" },
              { value: "APPROVED", label: "Approved" },
              { value: "SENT", label: "Sent" },
              { value: "REJECTED", label: "Rejected" },
              { value: "CANCELLED", label: "Cancelled" },
            ],
          },
        ]),
    {
      param: "settlement",
      label: "Settlement",
      options: [
        { value: "UNPAID", label: "Unpaid" },
        { value: "PARTIALLY_PAID", label: "Partially paid" },
        { value: "PAID", label: "Paid" },
        { value: "OVERDUE", label: "Overdue" },
      ],
    },
    {
      param: "clientId",
      label: "Client",
      options: options.clients.map((client) => ({ value: client.id, label: client.name })),
    },
    {
      param: "projectId",
      label: "Project",
      options: options.projects.map((project) => ({ value: project.id, label: project.name })),
    },
    ...(options.currencies.length > 1
      ? [
          {
            param: "currency",
            label: "Currency",
            options: options.currencies.map((code) => ({ value: code, label: code })),
          },
        ]
      : []),
  ];

  function buildHref(page: number) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (typeof value === "string" && key !== "page") params.set(key, value);
    }
    if (page > 1) params.set("page", String(page));
    const search = params.toString();
    return search ? `${basePath}?${search}` : basePath;
  }

  return (
    <div className="space-y-4">
      <ListToolbar
        searchPlaceholder="Search number, client or project…"
        filters={filters}
        sortOptions={[
          { value: "issue-desc", label: "Newest first" },
          { value: "issue-asc", label: "Oldest first" },
          { value: "due-asc", label: "Due soonest" },
          { value: "amount-desc", label: "Largest first" },
          { value: "amount-asc", label: "Smallest first" },
          { value: "number-asc", label: "Invoice number" },
        ]}
      />

      {result.data.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={<ReceiptText />}
            title="No invoices match these filters."
            description="Adjust or clear the filters to see more."
            action={{ label: "Clear filters", href: basePath }}
          />
        ) : (
          <EmptyState
            icon={<ReceiptText />}
            title={archived ? "No archived invoices." : "No invoices yet."}
            description={
              archived
                ? "Invoices removed from active lists will appear here."
                : "Invoices you can see will appear here."
            }
            action={
              !archived && can(context, "finance.invoice.create")
                ? { label: "New invoice", href: "/finance/invoices/new" }
                : undefined
            }
          />
        )
      ) : (
        <>
          <InvoiceTable invoices={result.data} />
          <Pagination meta={result.pagination} buildHref={buildHref} />
        </>
      )}
    </div>
  );
}
