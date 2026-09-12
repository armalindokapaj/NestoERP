"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { RejectDialog } from "@/components/finance/reject-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { disqualifyQuoteAction, selectQuoteAction } from "@/lib/actions/procurement";
import type { QuoteComparisonDTO } from "@/lib/modules/procurement/procurement.types";
import { quoteStatusLabels } from "@/lib/modules/procurement/procurement.status";
import { formatAmount } from "./procurement-format";

/**
 * The quote comparison grid (PRD #19 §270, §271, §290).
 *
 * A real table with row and column headers rather than a grid of divs, because
 * "cheapest" is a comparison a screen reader has to be able to make too. The
 * lowest qualified price is named in words as well as marked, for the same
 * reason (PRD #19 §290).
 *
 * A reader without quote access sees who was asked and who answered, and no
 * figures at all — a ranking is a statement about the prices behind it
 * (PRD #19 §261).
 */
export function QuoteComparison({
  comparison,
  canSelect,
  canDisqualify,
}: {
  comparison: QuoteComparisonDTO;
  canSelect: boolean;
  canDisqualify: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = React.useTransition();
  const [selecting, setSelecting] = React.useState<string | null>(null);
  const [disqualifying, setDisqualifying] = React.useState<string | null>(null);

  const { rfq, items, rows, canCompare } = comparison;

  function select(quoteId: string) {
    startTransition(async () => {
      const result = await selectQuoteAction(rfq.id, quoteId);
      setSelecting(null);
      if (result.ok) {
        toast({ title: "Quote selected.", tone: "success" });
        router.refresh();
      } else {
        toast({ title: result.error, tone: "danger" });
      }
    });
  }

  if (rows.length === 0) {
    return (
      <p className="nesto-card p-5 text-table text-fg-subtle">
        No supplier has answered this enquiry yet.
      </p>
    );
  }

  const lowest = rows.find((row) => row.isLowest);

  return (
    <div className="space-y-3">
      {canCompare && lowest ? (
        <p className="text-table text-fg-muted">
          Lowest qualified price:{" "}
          <span className="font-medium text-fg">{lowest.supplier.name}</span>
          {lowest.pricing ? ` at ${formatAmount(lowest.pricing.totalAmount, lowest.pricing.currency)}` : ""}.
          A low price is not automatically the right choice — lead time and terms are on the row too.
        </p>
      ) : null}

      <div className="nesto-card overflow-x-auto">
        <table className="w-full text-table">
          <caption className="sr-only">
            Supplier quotes for enquiry {rfq.rfqNumber}, compared line by line
          </caption>
          <thead>
            <tr className="border-b border-line text-left text-meta text-fg-subtle">
              <th scope="col" className="px-5 py-3 font-medium">Supplier</th>
              {canCompare
                ? items.map((item) => (
                    <th key={item.id} scope="col" className="px-5 py-3 text-right font-medium">
                      {item.description}
                      <span className="block font-normal text-fg-subtle">
                        {item.quantity} {item.unit}
                      </span>
                    </th>
                  ))
                : null}
              {canCompare ? (
                <th scope="col" className="px-5 py-3 text-right font-medium">Total</th>
              ) : null}
              <th scope="col" className="px-5 py-3 text-right font-medium">Lead time</th>
              <th scope="col" className="px-5 py-3 font-medium">Status</th>
              {canSelect || canDisqualify ? <th scope="col" className="px-5 py-3" /> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => {
              const excluded = row.status === "DISQUALIFIED";
              return (
                <tr key={row.quoteId} className={excluded ? "opacity-60" : undefined}>
                  <th scope="row" className="px-5 py-3 text-left font-medium text-fg">
                    {row.supplier.name}
                    {row.isLowest ? (
                      <span className="ml-2 align-middle">
                        <Badge tone="success">Lowest</Badge>
                      </span>
                    ) : null}
                  </th>

                  {canCompare
                    ? items.map((item) => (
                        <td key={item.id} className="px-5 py-3 text-right tabular-nums text-fg-muted">
                          {row.itemTotals[item.id] && row.pricing
                            ? formatAmount(row.itemTotals[item.id]!, row.pricing.currency)
                            : "—"}
                        </td>
                      ))
                    : null}

                  {canCompare ? (
                    <td className="px-5 py-3 text-right tabular-nums font-medium text-fg">
                      {row.pricing
                        ? formatAmount(row.pricing.totalAmount, row.pricing.currency)
                        : "—"}
                    </td>
                  ) : null}

                  <td className="px-5 py-3 text-right tabular-nums text-fg-muted">
                    {row.leadTimeDays === null ? "—" : `${row.leadTimeDays} days`}
                  </td>

                  <td className="px-5 py-3">
                    <Badge
                      tone={
                        row.status === "SELECTED"
                          ? "success"
                          : row.status === "DISQUALIFIED"
                            ? "danger"
                            : "neutral"
                      }
                    >
                      {quoteStatusLabels[row.status]}
                    </Badge>
                  </td>

                  {canSelect || canDisqualify ? (
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-2">
                        {canDisqualify && row.status === "RECEIVED" ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={pending}
                            onClick={() => setDisqualifying(row.quoteId)}
                          >
                            Disqualify
                          </Button>
                        ) : null}
                        {canSelect && row.status === "RECEIVED" ? (
                          <Button
                            size="sm"
                            disabled={pending}
                            onClick={() => setSelecting(row.quoteId)}
                          >
                            Select
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={selecting !== null}
        onOpenChange={(open) => !open && setSelecting(null)}
        title="Select this quote?"
        description="Every other qualified answer is marked not selected. An order can then be raised from it at the price that was accepted."
        confirmLabel="Select quote"
        destructive={false}
        pending={pending}
        onConfirm={() => selecting && select(selecting)}
      />

      <RejectDialog
        open={disqualifying !== null}
        onOpenChange={(open) => !open && setDisqualifying(null)}
        title="Disqualify this quote?"
        description="It stays on the record so the comparison is complete, but it cannot win."
        label="Reason"
        placeholder="Why is this answer excluded?"
        confirmLabel="Disqualify"
        pendingLabel="Disqualifying…"
        emptyMessage="Say why it is excluded."
        onReject={async (reason) => {
          if (!disqualifying) return false;
          const result = await disqualifyQuoteAction(rfq.id, disqualifying, reason);
          if (result.ok) {
            toast({ title: "Quote disqualified.", tone: "success" });
            setDisqualifying(null);
            router.refresh();
            return true;
          }
          toast({ title: result.error, tone: "danger" });
          return false;
        }}
      />
    </div>
  );
}
