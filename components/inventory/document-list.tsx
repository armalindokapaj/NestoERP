import { redirect } from "next/navigation";
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
import { TRANSACTION_SORT_KEYS, transactionListQuerySchema } from "@/lib/modules/inventory/inventory.schema";
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
import { listPageRedirect, pageHref } from "@/lib/modules/shared/list-query";
import { getTranslations } from "@/lib/i18n/server";
import { inventoryLabel } from "./inventory-labels";

/**
 * The five stock-document lists, from one place (PRD #20 §323–§325).
 *
 * Search, filters and sort all write to the URL, so refresh, back/forward and a
 * shared link reproduce the same list (PRD #7 §17). The filter options name
 * only statuses and reasons, never records — a dropdown must not become a
 * directory of documents the reader cannot open (PRD #20 §297).
 */

export type DocumentKind = "receipts" | "issues" | "returns" | "transfers" | "adjustments";

const CREATE_PERMISSION = {
  receipts: "inventory.receipt.create",
  issues: "inventory.issue.create",
  returns: "inventory.return.create",
  transfers: "inventory.transfer.create",
  adjustments: "inventory.adjustment.create",
} as const;

export async function DocumentListSection({
  context,
  kind,
  searchParams,
}: {
  context: UserContext;
  kind: DocumentKind;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const t = await getTranslations("inventory");
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
      label: t("columns.status"),
      options: TRANSACTION_STATUSES.map((value) => ({
        value,
        label: inventoryLabel(t, "transactionStatus", value, transactionStatusLabels[value]),
      })),
    },
    ...(kind === "adjustments"
      ? [
          {
            param: "reason",
            label: t("fields.reason"),
            options: ADJUSTMENT_REASONS.map((value) => ({
              value,
              label: inventoryLabel(t, "adjustmentReason", value, adjustmentReasonLabels[value]),
            })),
          },
        ]
      : []),
  ];

  // A page past the end moves once to the last real page (AUD-08 §4, DT-05).
  if (result.pagination.page !== query.page) redirect(listPageRedirect(`/inventory/${kind}`, searchParams, result.pagination.page));
  const buildHref = (page: number) => pageHref(`/inventory/${kind}`, searchParams, page);

  const mayCreate = can(context, CREATE_PERMISSION[kind]);

  if (result.data.length === 0) {
    return (
      <div className="space-y-4">
        <ListToolbar
          searchPlaceholder={t("documentList.search")}
          filters={filters}
          sortOptions={[
            { value: "date-desc", label: t("sort.newest") },
            { value: "date-asc", label: t("sort.oldest") },
            { value: "number-asc", label: t("sort.byNumber") },
            { value: "updated-desc", label: t("sort.recentlyUpdated") },
          ]}
        />
        {hasFilters ? (
          <EmptyState
            icon={<ClipboardList />}
            title={t("empty.noMatchTitle")}
            description={t("empty.noMatchDescription")}
            action={{ label: t("empty.clearFilters"), href: `/inventory/${kind}` }}
          />
        ) : (
          <EmptyState
            icon={<ClipboardList />}
            title={t(`documentList.empty.${kind}.title`)}
            description={t(`documentList.empty.${kind}.description`)}
            action={
              mayCreate
                ? { label: t(`documentList.create.${kind}`), href: `/inventory/${kind}/new` }
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
        searchPlaceholder={t("documentList.search")}
        filters={filters}
        sortOptions={[
          { value: "date-desc", label: t("sort.newest") },
          { value: "date-asc", label: t("sort.oldest") },
          { value: "number-asc", label: t("sort.byNumber") },
          { value: "updated-desc", label: t("sort.recentlyUpdated") },
        ]}
      />

      {kind === "receipts" ? (
        <ReceiptTable receipts={result.data as Awaited<ReturnType<typeof receipts.listReceipts>>["data"]} sort={{ value: query.sort, keys: TRANSACTION_SORT_KEYS }} />
      ) : kind === "issues" ? (
        <IssueTable issues={result.data as Awaited<ReturnType<typeof issues.listIssues>>["data"]} sort={{ value: query.sort, keys: TRANSACTION_SORT_KEYS }} />
      ) : kind === "returns" ? (
        <ReturnTable returns={result.data as Awaited<ReturnType<typeof returns.listReturns>>["data"]} sort={{ value: query.sort, keys: TRANSACTION_SORT_KEYS }} />
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


export { CREATE_PERMISSION };
