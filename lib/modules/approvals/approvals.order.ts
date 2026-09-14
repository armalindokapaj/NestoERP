import type { ProviderItem } from "./approvals.provider";
import type { ApprovalPriority, ApprovalSort, DueState, UnifiedApprovalItem } from "./approvals.types";

/**
 * Urgency, due state and the merged order of the Center's lists (PRD #41
 * §94-§96, §216, §253).
 *
 * Pure functions, so the order a person sees is the order a test can state.
 * Every sort ends in the provider key and approval id, which makes it total:
 * two items never compare equal, pages never repeat or skip an item, and a
 * cursor is just the last item's position.
 */

const DAY = 86_400_000;

function dayStart(value: Date): number {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

export function dueStateOf(dueAt: string | null, now: Date): DueState {
  if (!dueAt) return "none";
  const due = dayStart(new Date(dueAt));
  const today = dayStart(now);
  if (due < today) return "overdue";
  if (due === today) return "due_today";
  if (due - today <= 3 * DAY) return "due_soon";
  return "later";
}

const PRIORITY_WEIGHT: Record<ApprovalPriority, number> = { CRITICAL: 500, HIGH: 150, NORMAL: 50, LOW: 0 };

/**
 * Overdue first, then critical, then due soon, then high priority, then the
 * oldest request (§95). Weights are far enough apart that each tier outranks
 * everything below it; waiting time breaks ties within a tier.
 */
export function urgencyOf(item: Pick<ProviderItem, "priority" | "dueAt" | "requestedAt" | "status">, now: Date): number {
  if (item.status !== "PENDING") return 0;
  const state = dueStateOf(item.dueAt, now);
  let score = PRIORITY_WEIGHT[item.priority];
  if (state === "overdue") score += 2000 + Math.min(90, Math.floor((dayStart(now) - dayStart(new Date(item.dueAt!))) / DAY));
  else if (state === "due_today") score += 400;
  else if (state === "due_soon") score += 250;
  const waitingDays = Math.floor((now.getTime() - new Date(item.requestedAt).getTime()) / DAY);
  return score + Math.max(0, Math.min(60, waitingDays));
}

export function completeItem(item: ProviderItem, now: Date): UnifiedApprovalItem {
  return { ...item, dueState: dueStateOf(item.dueAt, now), urgency: urgencyOf(item, now) };
}

/** A position in a sorted list: values compared in order, each in its own direction. */
type Key = Array<number | string>;
type Direction = 1 | -1;

const DIRECTIONS: Record<ApprovalSort, Direction[]> = {
  urgency: [-1, 1, 1, 1],
  newest: [-1, -1, -1],
  oldest: [1, 1, 1],
  due: [1, -1, 1, 1],
  amount: [-1, -1, 1, 1],
};

export function sortKey(item: UnifiedApprovalItem, sort: ApprovalSort): Key {
  const at = new Date(item.sortAt).getTime();
  switch (sort) {
    case "urgency":
      return [item.urgency, new Date(item.requestedAt).getTime(), item.providerKey, item.approvalId];
    case "newest":
    case "oldest":
      return [at, item.providerKey, item.approvalId];
    case "due":
      // No due date sorts after every real one.
      return [item.dueAt ? new Date(item.dueAt).getTime() : Number.MAX_SAFE_INTEGER, item.urgency, item.providerKey, item.approvalId];
    case "amount":
      return [item.amount ? Number(item.amount.value) : -1, at, item.providerKey, item.approvalId];
  }
}

export function compareKeys(a: Key, b: Key, sort: ApprovalSort): number {
  const directions = DIRECTIONS[sort];
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index];
    const right = b[index];
    if (left === right) continue;
    const order = typeof left === "number" && typeof right === "number" ? left - right : String(left) < String(right) ? -1 : 1;
    return order * directions[index];
  }
  return 0;
}

export function sortItems(items: UnifiedApprovalItem[], sort: ApprovalSort): UnifiedApprovalItem[] {
  return [...items].sort((a, b) => compareKeys(sortKey(a, sort), sortKey(b, sort), sort));
}

/* Cursors ------------------------------------------------------------------ */

type CursorPayload = { v: 1; tab: string; sort: ApprovalSort; key: Key };

export function encodeCursor(tab: string, sort: ApprovalSort, key: Key): string {
  return Buffer.from(JSON.stringify({ v: 1, tab, sort, key } satisfies CursorPayload)).toString("base64url");
}

/** A cursor from another tab or sort, or one somebody edited, starts from the top rather than failing. */
export function decodeCursor(value: string | undefined, tab: string, sort: ApprovalSort): Key | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<CursorPayload>;
    if (parsed.v !== 1 || parsed.tab !== tab || parsed.sort !== sort || !Array.isArray(parsed.key)) return null;
    const expected = DIRECTIONS[sort].length;
    if (parsed.key.length !== expected || !parsed.key.every((part) => typeof part === "number" || typeof part === "string")) return null;
    return parsed.key;
  } catch {
    return null;
  }
}

/** Items strictly after the cursor position. */
export function afterCursor(items: UnifiedApprovalItem[], sort: ApprovalSort, cursor: Key | null): UnifiedApprovalItem[] {
  if (!cursor) return items;
  return items.filter((item) => compareKeys(sortKey(item, sort), cursor, sort) > 0);
}
