import Link from "@/components/navigation/nav-link";
import { ClipboardList } from "lucide-react";

import { ListToolbar, type FilterConfig } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";
import * as adjustments from "@/lib/modules/inventory/documents/adjustment.service";
import * as issues from "@/lib/modules/inventory/documents/issue.service";
import * as receipts from "@/lib/modules/inventory/documents/receipt.service";
import * as returns from "@/lib/modules/inventory/documents/return.service";
import * as transfers from "@/lib/modules/inventory/documents/transfer.service";
import { transactionListQuerySchema } from "@/lib/modules/inventory/inventory.schema";
import {
  ADJUSTMENT_REASONS,
  TRANSACTION_STATUSES,
  adjustmentReasonLabels,
  transactionStatusLabels,
} from "@/lib/modules/inventory/inventory.status";
import {
  AdjustmentTable,
  IssueTable,
  ReceiptTable,
  ReturnTable,
  TransferTable,
} from "./document-tables";

/**
 * The five stock-document lists, from one place (PRD #20 §323–§325).
 *
 * Search, filters and sort all write to the URL, so refresh, back/forward and a
 * shared link reproduce the same list (PRD #7 §17). The filter options name
 * only statuses and reasons, never records — a dropdown must not become a
 * directory of documents the reader cannot open (PRD #20 §297).
 */

export type DocumentKind = "receipts" | "issues" | "returns" | "transfers" | "adjustments";

const EMPTY_COPY: Record<DocumentKind, { title: string; description: string }> = {
  receipts: {
    title: "No receipts yet.",
    description:
      "A receipt records material arriving into stock, whether from a Procurement delivery or straight off a lorry.",
  },
  issues: {
    title: "No issues yet.",
    description:
      "An issue records material leaving stock for a project or for general use.",
  },
  returns: {
    title: "No returns yet.",
    description: "A return records unused material coming back from a project into stock.",
  },
  transfers: {
    title: "No transfers yet.",
    description:
      "A transfer moves material between locations. The company holds the same total either way.",
  },
  adjustments: {
    title: "No adjustments yet.",
    description:
      "An adjustment corrects what the company believes it holds — a count, a breakage, an opening balance.",
  },
};

const CREATE_PERMISSION = {
  receipts: "inventory.receipt.create",
  issues: "inventory.issue.create",
  returns: "inventory.return.create",
  transfers: "inventory.transfer.create",
  adjustments: "inventory.adjustment.create",
} as const;

const CREATE_LABEL: Record<DocumentKind, string> = {
  receipts: "New receipt",
  issues: "New issue",
  returns: "New return",
  transfers: "New transfer",
  adjustments: "New adjustment",
};

export async function DocumentListSection({
  context,
  kind,
  searchParams,
}: {
  context: UserContext;
  kind: DocumentKind;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const read = (key: string) =>
    typeof searchParams[key] === "string" ? (searchParams[key] as string) : undefined;

  const statuses = read("status")
    ?.split(",")
    .filter((value) => (TRANSACTION_STATUSES as readonly string[]).includes(value));

  const query = transactionListQuerySchema.parse({
    search: read("search"),
    status: statuses?.length ? statuses : undefined,
    warehouseId: read("warehouseId"),
    projectId: read("projectId"),
    reason: kind === "adjustments" ? read("reason") : undefined,
    sort: read("sort"),
    page: read("page"),
  });

  const result =
    kind === "receipts"
      ? await receipts.listReceipts(context, query)
      : kind === "issues"
        ? await issues.listIssues(context, query)
        : kind === "returns"
          ? await returns.listReturns(context, query)
          : kind === "transfers"
            ? await transfers.listTransfers(context, query)
            : await adjustments.listAdjustments(context, query);

  const hasFilters = Boolean(
    query.search || query.status?.length || query.warehouseId || query.projectId || query.reason,
  );

  const filters: FilterConfig[] = [
    {
      param: "status",
      label: "Status",
      options: TRANSACTION_STATUSES.map((value) => ({
        value,
        label: transactionStatusLabels[value],
      })),
    },
    ...(kind === "adjustments"
      ? [
          {
            param: "reason",
            label: "Reason",
            options: ADJUSTMENT_REASONS.map((value) => ({
              value,
              label: adjustmentReasonLabels[value],
            })),
          },
        ]
      : []),
  ];

  function buildHref(page: number) {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (typeof value === "string" && key !== "page") next.set(key, value);
    }
    if (page > 1) next.set("page", String(page));
    const search = next.toString();
    return search ? `/inventory/${kind}?${search}` : `/inventory/${kind}`;
  }

  const mayCreate = can(context, CREATE_PERMISSION[kind]);
  const copy = EMPTY_COPY[kind];

  if (result.data.length === 0) {
    return (
      <div className="space-y-4">
        <ListToolbar
          searchPlaceholder="Search by number or note…"
          filters={filters}
          sortOptions={[
            { value: "date-desc", label: "Newest first" },
            { value: "date-asc", label: "Oldest first" },
            { value: "number-asc", label: "By number" },
            { value: "updated-desc", label: "Recently updated" },
          ]}
        />
        {hasFilters ? (
          <EmptyState
            icon={<ClipboardList />}
            title="Nothing matches these filters."
            description="Adjust or clear the filters to see more."
            action={{ label: "Clear filters", href: `/inventory/${kind}` }}
          />
        ) : (
          <EmptyState
            icon={<ClipboardList />}
            title={copy.title}
            description={copy.description}
            action={
              mayCreate
                ? { label: CREATE_LABEL[kind], href: `/inventory/${kind}/new` }
                : undefined
            }
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ListToolbar
        searchPlaceholder="Search by number or note…"
        filters={filters}
        sortOptions={[
          { value: "date-desc", label: "Newest first" },
          { value: "date-asc", label: "Oldest first" },
          { value: "number-asc", label: "By number" },
          { value: "updated-desc", label: "Recently updated" },
        ]}
      />

      {kind === "receipts" ? (
        <ReceiptTable receipts={result.data as Awaited<ReturnType<typeof receipts.listReceipts>>["data"]} />
      ) : kind === "issues" ? (
        <IssueTable issues={result.data as Awaited<ReturnType<typeof issues.listIssues>>["data"]} />
      ) : kind === "returns" ? (
        <ReturnTable returns={result.data as Awaited<ReturnType<typeof returns.listReturns>>["data"]} />
      ) : kind === "transfers" ? (
        <TransferTable
          transfers={result.data as Awaited<ReturnType<typeof transfers.listTransfers>>["data"]}
        />
      ) : (
        <AdjustmentTable
          adjustments={
            result.data as Awaited<ReturnType<typeof adjustments.listAdjustments>>["data"]
          }
        />
      )}

      <Pagination meta={result.pagination} buildHref={buildHref} />
    </div>
  );
}

/** The "new" button for a document list header, when the reader may create one. */
export function DocumentCreateLink({
  context,
  kind,
}: {
  context: UserContext;
  kind: DocumentKind;
}) {
  if (!can(context, CREATE_PERMISSION[kind])) return null;
  return <Link href={`/inventory/${kind}/new`}>{CREATE_LABEL[kind]}</Link>;
}

export { CREATE_PERMISSION, CREATE_LABEL };
