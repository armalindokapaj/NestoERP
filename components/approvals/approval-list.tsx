"use client";

import * as React from "react";
import { ChevronRight } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { CompanyRecordLink } from "@/components/workspace/company-record-link";
import { CompanyTag } from "@/components/workspace/company-tag";
import type { ApprovalTab, UnifiedApprovalItem } from "@/lib/modules/approvals/approvals.types";
import type { Translate } from "@/lib/i18n/translator";
import { cn } from "@/lib/utils/cn";
import { useApprovalsTranslations, useApprovalsWord } from "./approvals-text";
import { DueBadge, formatMoney, PriorityBadge, relativeText, SourceIcon, StatusBadge, waitingText } from "./approval-ui";

/**
 * The queue (PRD #41 §76-§79, §102, §223).
 *
 * Disciplined rows, not cards: what it is and from which module, the
 * reference and value, where it belongs, who asked and how long ago, and —
 * only when they matter — step, due state and priority. Comfortable by
 * default, compact on request. Arrow keys move between rows; Enter opens one.
 *
 * In the Group workspace the queue is a read view (Workspace Context §33, §45,
 * §74): every row names its company and is a link that enters that company's
 * workspace, where the review, the decision and the delegation live.
 */

export type Density = "comfortable" | "compact";

export function ApprovalList({
  items,
  tab,
  selectedId,
  density,
  onSelect,
  group = false,
}: {
  items: UnifiedApprovalItem[];
  tab: ApprovalTab;
  selectedId: string | null;
  density: Density;
  onSelect: (item: UnifiedApprovalItem) => void;
  /** The Group workspace: rows are company-labelled links, not selectable reviews. */
  group?: boolean;
}) {
  const refs = React.useRef(new Map<string, HTMLButtonElement>());
  const t = useApprovalsTranslations();

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    const next = event.key === "ArrowDown" || event.key === "j" ? index + 1 : event.key === "ArrowUp" || event.key === "k" ? index - 1 : null;
    if (next === null) return;
    const target = items[next];
    if (!target) return;
    event.preventDefault();
    refs.current.get(target.id)?.focus();
  }

  return (
    <ul className="divide-y divide-line" aria-label={t("list.label")} data-testid="approval-list">
      {items.map((item, index) => {
        if (group) return <GroupRow key={`${item.company?.id ?? ""}:${item.id}`} item={item} tab={tab} density={density} />;
        const selected = item.id === selectedId;
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
              <RowMain item={item} tab={tab} density={density} />
              <RowBadges item={item} tab={tab} />
              <ChevronRight aria-hidden="true" className="mt-1 hidden size-4 shrink-0 text-fg-subtle opacity-0 transition-opacity group-hover:opacity-100 lg:block" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * One approval of the Group workspace. The row opens the approval inside its own
 * company (the Center there holds the review and the decision); a second link
 * opens the source record. Both go through the enter-company step (§31).
 */
function GroupRow({ item, tab, density }: { item: UnifiedApprovalItem; tab: ApprovalTab; density: Density }) {
  const t = useApprovalsTranslations();
  const company = item.company;
  const review = `/approvals?approval=${encodeURIComponent(item.id)}`;
  const title = company ? (
    <CompanyRecordLink
      companyId={company.id}
      companyName={company.name}
      href={review}
      className="after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring/40"
    >
      {item.title}
    </CompanyRecordLink>
  ) : (
    item.title
  );
  return (
    <li>
      <div
        data-testid="approval-row"
        data-approval={item.id}
        data-company={company?.id}
        className={cn("group relative flex items-start gap-3 transition-colors hover:bg-hover", density === "compact" ? "px-4 py-2.5" : "px-4 py-3.5 sm:px-5")}
      >
        {density === "comfortable" ? <SourceIcon provider={item.providerKey} className="mt-0.5 hidden sm:flex" /> : null}
        <RowMain
          item={item}
          tab={tab}
          density={density}
          title={title}
          lead={company ? <CompanyTag name={company.name} /> : null}
          extra={
            company ? (
              <CompanyRecordLink
                companyId={company.id}
                companyName={company.name}
                href={item.href}
                className="relative z-10 font-medium text-fg-muted underline-offset-4 hover:text-fg hover:underline"
              >
                {t("list.openRecord")}
              </CompanyRecordLink>
            ) : null
          }
        />
        <RowBadges item={item} tab={tab} />
      </div>
    </li>
  );
}

function RowMain({
  item,
  tab,
  density,
  title = item.title,
  lead = null,
  extra = null,
}: {
  item: UnifiedApprovalItem;
  tab: ApprovalTab;
  density: Density;
  title?: React.ReactNode;
  /** The company tag, in the Group workspace. */
  lead?: React.ReactNode;
  /** A link after the meta line, in the Group workspace. */
  extra?: React.ReactNode;
}) {
  const t = useApprovalsTranslations();
  const word = useApprovalsWord();
  const amount = formatMoney(item.amount);
  return (
    <span className="min-w-0 flex-1">
      <span className={lead ? "flex flex-wrap items-center gap-x-2 gap-y-1" : "flex items-center gap-2"}>
        {lead}
        <span className="text-micro font-semibold uppercase tracking-[0.1em] text-fg-subtle">{word(item.sourceLabel)}</span>
        {item.totalSteps ? (
          <span className="text-micro text-fg-subtle">
            · {t("list.step", { current: item.currentStep ?? "", total: item.totalSteps })}
          </span>
        ) : null}
      </span>
      <span className={cn("mt-0.5 block truncate font-medium text-fg", density === "compact" ? "text-table" : "text-body")}>{title}</span>
      {density === "comfortable" ? (
        <>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-table text-fg-muted">
            {amount ? <span className="font-semibold tabular-nums text-fg">{amount}</span> : null}
            {amount && item.project ? <span aria-hidden="true">·</span> : null}
            {item.project ? <span className="truncate">{item.project.name}</span> : null}
            {!amount && !item.project && item.subtitle ? <span className="truncate">{item.subtitle}</span> : null}
          </span>
          <span className="mt-1 block text-meta text-fg-subtle">{rowMeta(item, tab, t)}</span>
        </>
      ) : (
        <span className="mt-0.5 block truncate text-meta text-fg-subtle">{[amount, item.project?.name, rowMeta(item, tab, t)].filter(Boolean).join(" · ")}</span>
      )}
      {extra ? <span className="mt-1 block text-meta">{extra}</span> : null}
    </span>
  );
}

function RowBadges({ item, tab }: { item: UnifiedApprovalItem; tab: ApprovalTab }) {
  return (
    <span className="flex shrink-0 flex-col items-end gap-1.5">
      {tab === "waiting" ? null : <StatusBadge status={item.status} />}
      <PriorityBadge priority={item.priority} />
      <DueBadge item={item} />
    </span>
  );
}

function rowMeta(item: UnifiedApprovalItem, tab: ApprovalTab, t: Translate<"approvals">): string {
  const now = new Date();
  const requestedBy = t("list.requestedBy", { name: item.requester.name });
  if (tab === "waiting") {
    return `${requestedBy} · ${waitingText(item.requestedAt, now, t)}${item.onBehalfOf ? ` · ${t("list.forPerson", { name: item.onBehalfOf.name })}` : ""}`;
  }
  if ((tab === "approved" || tab === "rejected" || tab === "returned") && item.sortAt) {
    return `${requestedBy} · ${t("list.decided", { when: relativeText(item.sortAt, now, t) })}`;
  }
  if (tab === "requested") {
    return item.status === "PENDING"
      ? `${item.stepLabel ? `${t("list.withStep", { step: item.stepLabel })} · ` : ""}${waitingText(item.requestedAt, now, t)}`
      : `${item.decidedBy ? `${item.decidedBy.name} · ` : ""}${item.decidedAt ? relativeText(item.decidedAt, now, t) : ""}`;
  }
  return `${requestedBy} · ${relativeText(item.requestedAt, now, t)}`;
}

export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  const t = useApprovalsTranslations();
  return (
    <ul className="divide-y divide-line" aria-busy="true" aria-label={t("list.loading")}>
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
