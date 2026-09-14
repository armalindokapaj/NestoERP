"use client";

import * as React from "react";
import { ChevronRight } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import type { ApprovalTab, UnifiedApprovalItem } from "@/lib/modules/approvals/approvals.types";
import { cn } from "@/lib/utils/cn";
import { DueBadge, formatMoney, PriorityBadge, relativeText, SourceIcon, StatusBadge, waitingText } from "./approval-ui";

/**
 * The queue (PRD #41 §76-§79, §102, §223).
 *
 * Disciplined rows, not cards: what it is and from which module, the
 * reference and value, where it belongs, who asked and how long ago, and —
 * only when they matter — step, due state and priority. Comfortable by
 * default, compact on request. Arrow keys move between rows; Enter opens one.
 */

export type Density = "comfortable" | "compact";

export function ApprovalList({
  items,
  tab,
  selectedId,
  density,
  onSelect,
}: {
  items: UnifiedApprovalItem[];
  tab: ApprovalTab;
  selectedId: string | null;
  density: Density;
  onSelect: (item: UnifiedApprovalItem) => void;
}) {
  const refs = React.useRef(new Map<string, HTMLButtonElement>());

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    const next = event.key === "ArrowDown" || event.key === "j" ? index + 1 : event.key === "ArrowUp" || event.key === "k" ? index - 1 : null;
    if (next === null) return;
    const target = items[next];
    if (!target) return;
    event.preventDefault();
    refs.current.get(target.id)?.focus();
  }

  return (
    <ul className="divide-y divide-line" aria-label="Approvals" data-testid="approval-list">
      {items.map((item, index) => {
        const selected = item.id === selectedId;
        const amount = formatMoney(item.amount);
        return (
          <li key={item.id}>
            <button
              type="button"
              ref={(node) => {
                if (node) refs.current.set(item.id, node);
                else refs.current.delete(item.id);
              }}
              onClick={() => onSelect(item)}
              onKeyDown={(event) => onKeyDown(event, index)}
              aria-current={selected ? "true" : undefined}
              data-testid="approval-row"
              data-approval={item.id}
              className={cn(
                "group relative flex w-full items-start gap-3 text-left transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40",
                density === "compact" ? "px-4 py-2.5" : "px-4 py-3.5 sm:px-5",
                selected ? "bg-accent-soft/60" : "hover:bg-hover",
              )}
            >
              {selected ? <span aria-hidden="true" className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-accent" /> : null}
              {density === "comfortable" ? <SourceIcon provider={item.providerKey} className="mt-0.5 hidden sm:flex" /> : null}
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="text-micro font-semibold uppercase tracking-[0.1em] text-fg-subtle">{item.sourceLabel}</span>
                  {item.totalSteps ? (
                    <span className="text-micro text-fg-subtle">
                      · Step {item.currentStep} of {item.totalSteps}
                    </span>
                  ) : null}
                </span>
                <span className={cn("mt-0.5 block truncate font-medium text-fg", density === "compact" ? "text-table" : "text-body")}>{item.title}</span>
                {density === "comfortable" ? (
                  <>
                    <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-table text-fg-muted">
                      {amount ? <span className="font-semibold tabular-nums text-fg">{amount}</span> : null}
                      {amount && item.project ? <span aria-hidden="true">·</span> : null}
                      {item.project ? <span className="truncate">{item.project.name}</span> : null}
                      {!amount && !item.project && item.subtitle ? <span className="truncate">{item.subtitle}</span> : null}
                    </span>
                    <span className="mt-1 block text-meta text-fg-subtle">
                      {rowMeta(item, tab)}
                    </span>
                  </>
                ) : (
                  <span className="mt-0.5 block truncate text-meta text-fg-subtle">
                    {[amount, item.project?.name, rowMeta(item, tab)].filter(Boolean).join(" · ")}
                  </span>
                )}
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1.5">
                {tab === "waiting" ? null : <StatusBadge status={item.status} />}
                <PriorityBadge priority={item.priority} />
                <DueBadge item={item} />
              </span>
              <ChevronRight aria-hidden="true" className="mt-1 hidden size-4 shrink-0 text-fg-subtle opacity-0 transition-opacity group-hover:opacity-100 lg:block" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function rowMeta(item: UnifiedApprovalItem, tab: ApprovalTab): string {
  if (tab === "waiting") {
    return `Requested by ${item.requester.name} · ${waitingText(item.requestedAt)}${item.onBehalfOf ? ` · for ${item.onBehalfOf.name}` : ""}`;
  }
  if ((tab === "approved" || tab === "rejected" || tab === "returned") && item.sortAt) {
    return `Requested by ${item.requester.name} · decided ${relativeText(item.sortAt)}`;
  }
  if (tab === "requested") {
    return item.status === "PENDING"
      ? `${item.stepLabel ? `With ${item.stepLabel} · ` : ""}${waitingText(item.requestedAt)}`
      : `${item.decidedBy ? `${item.decidedBy.name} · ` : ""}${item.decidedAt ? relativeText(item.decidedAt) : ""}`;
  }
  return `Requested by ${item.requester.name} · ${relativeText(item.requestedAt)}`;
}

export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <ul className="divide-y divide-line" aria-busy="true" aria-label="Loading approvals">
      {Array.from({ length: rows }, (_, index) => (
        <li key={index} className="flex gap-3 px-5 py-4">
          <Skeleton className="hidden size-9 rounded-lg sm:block" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-2.5 w-24" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="h-5 w-14 rounded-full" />
        </li>
      ))}
    </ul>
  );
}
