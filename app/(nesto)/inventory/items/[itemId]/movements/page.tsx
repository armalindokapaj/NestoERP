import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { History } from "lucide-react";

import { Pagination } from "@/components/data/pagination";
import { MovementTable } from "@/components/inventory/movement-table";
import { EmptyState } from "@/components/ui/empty-state";
import { movementListQuerySchema } from "@/lib/modules/inventory/inventory.schema";
import * as movements from "@/lib/modules/inventory/movements/movement.service";
import { firstValue, listPageRedirect, pageHref } from "@/lib/modules/shared/list-query";
import { ItemPageShell, loadItemPage } from "../item-shell";

export const metadata: Metadata = { title: "Movements" };

type Params = {
  params: Promise<{ itemId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * One item's ledger (PRD #20 §173, §432), newest first, page by page: the
 * register's own query narrowed to this item, so every movement is reachable
 * and the count is the ledger's (AUD-08 §4) — it used to stop silently at 100.
 */
export default async function ItemMovementsPage({ params, searchParams }: Params) {
  const { itemId } = await params;
  const { context, item } = await loadItemPage(itemId, "movements");

  const search = await searchParams;
  const basePath = `/inventory/items/${itemId}/movements`;
  const query = movementListQuerySchema.parse({ inventoryItemId: itemId, page: firstValue(search.page) });
  const result = await movements.listMovements(context, query);
  // A page past the end moves once to the last real page (AUD-08 §4, DT-05).
  if (result.pagination.page !== query.page) redirect(listPageRedirect(basePath, search, result.pagination.page));

  return (
    <ItemPageShell item={item} tab="movements">
      {result.data.length === 0 ? (
        <EmptyState
          icon={<History />}
          title="Nothing has moved."
          description="Every receipt, issue, transfer and adjustment touching this item appears here, in order."
        />
      ) : (
        <div className="space-y-3">
          <p className="text-meta text-fg-subtle">
            The ledger is the record. A correction is a new row here, never an edit to an old
            one.
          </p>
          <MovementTable
            movements={result.data}
            showItem={false}
            caption={`Movements for ${item.name}`}
            listId="inventory.item-movements"
          />
          <Pagination meta={result.pagination} buildHref={(next) => pageHref(basePath, search, next)} />
        </div>
      )}
    </ItemPageShell>
  );
}
