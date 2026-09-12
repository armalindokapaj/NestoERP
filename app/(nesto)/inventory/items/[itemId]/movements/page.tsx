import type { Metadata } from "next";
import { History } from "lucide-react";

import { MovementTable } from "@/components/inventory/movement-table";
import { EmptyState } from "@/components/ui/empty-state";
import * as movements from "@/lib/modules/inventory/movements/movement.service";
import { ItemPageShell, loadItemPage } from "../item-shell";

export const metadata: Metadata = { title: "Movements" };

type Params = { params: Promise<{ itemId: string }> };

/** One item's ledger (PRD #20 §173, §432). */
export default async function ItemMovementsPage({ params }: Params) {
  const { itemId } = await params;
  const { context, item } = await loadItemPage(itemId, "movements");

  const rows = await movements.listForItem(context, itemId, 100);

  return (
    <ItemPageShell item={item} tab="movements">
      {rows.length === 0 ? (
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
            movements={rows}
            showItem={false}
            caption={`Movements for ${item.name}`}
          />
        </div>
      )}
    </ItemPageShell>
  );
}
