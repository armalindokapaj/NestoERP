"use client";

import * as React from "react";
import { useRouter } from "@/components/navigation/guarded-router";

import { RejectDialog } from "@/components/finance/reject-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ScrollRegion } from "@/components/ui/scroll-region";
import { useToast } from "@/components/ui/toast";
import {
  disqualifyQuoteAction,
  orderFromQuoteAction,
  selectQuoteAction,
} from "@/lib/actions/procurement";
import type { QuoteComparisonDTO } from "@/lib/modules/procurement/procurement.types";
import { quoteStatusLabels } from "@/lib/modules/procurement/procurement.status";
import { cn } from "@/lib/utils/cn";
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

  function draft(quoteId: string) {
    startTransition(async () => {
      const result = await orderFromQuoteAction(quoteId);
      if (result.ok) {
        toast({ title: "Draft order created from the quote.", tone: "success" });
        router.refresh();
      } else {
        toast({ title: result.error, tone: "danger" });
      }
    });
  }

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

  // The row's decisions, shared by the phone card and the table row.
  function rowActions(row: (typeof rows)[number]) {
    return (
      <>
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
        {/*
          * The selected quote is the one that becomes an
          * order. Drafting it here carries the supplier, the
          * prices and the lines across rather than asking
          * somebody to retype what was quoted (PRD #19 §98).
          */}
        {canSelect && row.status === "SELECTED" ? (
          <Button size="sm" disabled={pending} onClick={() => draft(row.quoteId)}>
            Draft order
          </Button>
        ) : null}
      </>
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

      <ScrollRegion label={`Supplier quotes for enquiry ${rfq.rfqNumber}`} className="nesto-card hidden md:block">
        <table className="w-full text-table">
          <caption className="sr-only">
            Supplier quotes for enquiry {rfq.rfqNumber}, compared line by line
          </caption>
          <thead>
            <tr className="border-b border-line text-left text-meta text-fg-subtle">
              {/* The supplier column stays put while the prices pan beside it. */}
              <th scope="col" className="sticky left-0 z-[1] bg-surface px-5 py-3 font-medium">Supplier</th>
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
                  <th scope="row" className="sticky left-0 z-[1] bg-surface px-5 py-3 text-left font-medium text-fg">
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
                      <div className="flex justify-end gap-2">{rowActions(row)}</div>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollRegion>

      {/*
        Phones get one card per supplier (after the table in source, so a
        desktop reader's first match is the table) — name, total, lead time, status and the
        decision buttons in view, the per-line prices a tap away — instead of a
        matrix whose actions sit off-screen to the right (AUD-04 §5, MW-05).
      */}
      <ul className="space-y-2 md:hidden" aria-label={`Supplier quotes for enquiry ${rfq.rfqNumber}`} data-testid="quote-cards">
        {rows.map((row) => {
          const excluded = row.status === "DISQUALIFIED";
          return (
            <li key={row.quoteId} className={cn("nesto-card space-y-2 p-4 text-table", excluded && "opacity-60")} data-testid="quote-card">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 break-words font-medium text-fg">{row.supplier.name}</span>
                {row.isLowest ? <Badge tone="success">Lowest</Badge> : null}
                <span className="ml-auto">
                  <Badge tone={row.status === "SELECTED" ? "success" : row.status === "DISQUALIFIED" ? "danger" : "neutral"}>{quoteStatusLabels[row.status]}</Badge>
                </span>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
                {canCompare ? (
                  <>
                    <dt className="text-fg-subtle">Total</dt>
                    <dd className="text-right font-medium tabular-nums text-fg">{row.pricing ? formatAmount(row.pricing.totalAmount, row.pricing.currency) : "—"}</dd>
                  </>
                ) : null}
                <dt className="text-fg-subtle">Lead time</dt>
                <dd className="text-right tabular-nums text-fg-muted">{row.leadTimeDays === null ? "—" : `${row.leadTimeDays} days`}</dd>
              </dl>
              {canCompare && items.length ? (
                <details className="rounded-md border border-line">
                  <summary className="cursor-pointer px-3 py-2 text-fg-muted touch:min-h-11 touch:content-center">Prices by line ({items.length})</summary>
                  <dl className="space-y-1 border-t border-line px-3 py-2">
                    {items.map((item) => (
                      <div key={item.id} className="flex items-baseline justify-between gap-3">
                        <dt className="min-w-0 break-words text-fg-muted">
                          {item.description} <span className="text-fg-subtle">· {item.quantity} {item.unit}</span>
                        </dt>
                        <dd className="shrink-0 tabular-nums text-fg">{row.itemTotals[item.id] && row.pricing ? formatAmount(row.itemTotals[item.id]!, row.pricing.currency) : "—"}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              ) : null}
              {canSelect || canDisqualify ? <div className="flex flex-wrap justify-end gap-2 empty:hidden">{rowActions(row)}</div> : null}
            </li>
          );
        })}
      </ul>

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
