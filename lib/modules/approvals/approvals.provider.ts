import type { ModuleKey } from "@/config/modules";
import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import type { RecordType } from "@/lib/core/records/record.types";
import { prisma } from "@/lib/database/prisma";
import type {
  ApprovalDecision,
  ApprovalDecisionOutcome,
  ApprovalPerson,
  ApprovalProviderKey,
  ApprovalTab,
  UnifiedApprovalDetail,
  UnifiedApprovalItem,
  UnifiedApprovalStatus,
} from "./approvals.types";

/**
 * The approval provider contract (PRD #41 §9, §11, §250).
 *
 * A provider is the owning module's window into the Center: it reads the
 * module's own approval records through the module's own permissions and
 * scope, maps them to the shared shape, and decides by calling the module's
 * own service — never by writing a status itself (§3, §49, §305).
 *
 * Every provider documents its three queries next to its implementation:
 * waiting for me, requested by me, and history — and the indexes each uses.
 */

/** A position in a date-ordered list, shared by every provider so pages merge exactly (§253). */
export type KeysetCursor = { at: Date; providerKey: string; approvalId: string };

export type ProviderQuery = {
  tab: ApprovalTab;
  statuses: UnifiedApprovalStatus[];
  projectId?: string;
  requesterId?: string;
  /** Bounds on the tab's own date: requested for waiting/requested/history, decided otherwise. */
  from?: Date;
  to?: Date;
  q?: string;
  amountMin?: number;
  amountMax?: number;
  returned: "by" | "to" | "all";
  order: "desc" | "asc";
  /** Continue after this position; only set when the list is ordered by the tab's date. */
  after: KeysetCursor | null;
  /** The most rows the Center will use from this provider. */
  limit: number;
  now: Date;
};

/** An item before the Center adds what it computes itself. */
export type ProviderItem = Omit<UnifiedApprovalItem, "dueState" | "urgency">;

export type ProviderDetail = Omit<UnifiedApprovalDetail, "item"> & { item: ProviderItem };

export type WaitingCounts = { total: number; overdue: number; critical: number };

export interface ApprovalProvider {
  key: ApprovalProviderKey;
  moduleKey: ModuleKey;
  label: string;
  /** The record registry types this provider decides, for deep links from a record (§42). */
  recordTypes: RecordType[];

  /** Whether this reader could see anything from this provider at all — module on, some grant. */
  available(context: UserContext): boolean;

  queue(context: UserContext, query: ProviderQuery): Promise<ProviderItem[]>;
  detail(context: UserContext, approvalId: string): Promise<ProviderDetail | null>;
  /** The latest cycle on a record this reader can see, pending first. */
  findByRecord(context: UserContext, recordType: string, recordId: string): Promise<string | null>;
  decide(
    context: UserContext,
    approvalId: string,
    decision: ApprovalDecision,
    input: { note: string | null; expectedVersion?: number },
  ): Promise<{ outcome: ApprovalDecisionOutcome; alreadyApplied: boolean }>;
}

/* -------------------------------------------------------------------------- */
/* Helpers shared by providers                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The keyset clause for one provider in a merged, date-ordered list.
 *
 * Items order by (date, provider key, approval id), all in one direction, so
 * every provider can resume from any other provider's last item and the merge
 * is exact rather than approximate.
 */
export function keysetWhere(
  field: string,
  providerKey: string,
  query: Pick<ProviderQuery, "after" | "order">,
  idField = "id",
): Record<string, unknown> | null {
  const after = query.after;
  if (!after) return null;
  const strict = query.order === "desc" ? "lt" : "gt";
  const loose = query.order === "desc" ? "lte" : "gte";
  if (providerKey === after.providerKey) {
    return { OR: [{ [field]: { [strict]: after.at } }, { [field]: after.at, [idField]: { [strict]: after.approvalId } }] };
  }
  const providerComesAfter = query.order === "desc" ? providerKey < after.providerKey : providerKey > after.providerKey;
  return { [field]: { [providerComesAfter ? loose : strict]: after.at } };
}

export function dateRange(query: Pick<ProviderQuery, "from" | "to">): { gte?: Date; lt?: Date } | undefined {
  if (!query.from && !query.to) return undefined;
  return {
    ...(query.from ? { gte: query.from } : {}),
    // `to` is a calendar day: everything before the next midnight.
    ...(query.to ? { lt: new Date(query.to.getTime() + 86_400_000) } : {}),
  };
}

export function approvalError(code: string, message: string, status: "CONFLICT" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_ERROR" = "CONFLICT"): AccessError {
  return new AccessError(status, message, { code });
}

export const notFound = () => approvalError("APPROVAL_NOT_FOUND", "This approval could not be found.", "NOT_FOUND");

/**
 * An approval whose module the company switched off answers "not found", like
 * any record the reader cannot reach — a 403 would confirm the approval is
 * there behind the switch (PRD #41 §198, §232, PRD #47 §175). The reason stays
 * in the security log.
 */
export const providerUnavailable = (message = "This approval's module is not available to you.") =>
  new AccessError("NOT_FOUND", message, { code: "APPROVAL_PROVIDER_UNAVAILABLE" }, "MODULE_DISABLED");

/**
 * Translates what a module's service refused into the Center's error
 * vocabulary (§193, §194), keeping the module's own words where they are the
 * clearer answer.
 */
export function translateSourceError(error: unknown): never {
  if (error instanceof AccessError) {
    const detailCode = (error.details as { code?: string } | undefined)?.code;
    if (error.code === "FORBIDDEN") {
      const self = detailCode === "SELF_APPROVAL" || /submitted this|your own/i.test(error.message);
      if (self) throw approvalError("APPROVAL_SELF_APPROVAL_BLOCKED", "You requested this, so somebody else has to decide it.", "FORBIDDEN");
      throw approvalError(detailCode?.startsWith("APPROVAL_") ? detailCode : "APPROVAL_FORBIDDEN", error.message === "You do not have permission to perform this action." ? "You cannot decide this approval." : error.message, "FORBIDDEN");
    }
    if (error.code === "CONFLICT") {
      if (detailCode === "APPROVAL_SOURCE_CHANGED") throw error;
      if (!detailCode || ["APPROVAL_DECIDED", "NO_PENDING_APPROVAL", "APPROVAL_ALREADY_DECIDED"].includes(detailCode) || /already|not waiting|no decision/i.test(error.message)) {
        throw approvalError("APPROVAL_ALREADY_DECIDED", "This approval was already decided.");
      }
      throw error;
    }
    if (error.code === "NOT_FOUND") throw approvalError("APPROVAL_NOT_FOUND", "You no longer have access to this approval.", "NOT_FOUND");
    if (error.code === "MODULE_UNAVAILABLE") throw providerUnavailable("This approval's module is switched off.");
  }
  throw error;
}

/** Names for the members an approval list mentions, in one query. */
export async function memberNames(companyId: string, ids: Array<string | null | undefined>): Promise<Map<string, ApprovalPerson>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();
  const rows = await prisma.companyMember.findMany({
    where: { companyId, id: { in: unique } },
    select: { id: true, user: { select: { firstName: true, lastName: true } } },
  });
  return new Map(rows.map((row) => [row.id, { memberId: row.id, name: `${row.user.firstName} ${row.user.lastName}` }]));
}

export function personOrUnknown(names: Map<string, ApprovalPerson>, id: string | null | undefined): ApprovalPerson {
  if (!id) return { memberId: "", name: "Unknown" };
  return names.get(id) ?? { memberId: id, name: "Former member" };
}

/** A business date (midday UTC) or a timestamp, formatted the way the Center prints dates (§211). */
export function formatDay(value: Date | null | undefined, timeZone = "UTC"): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone }).format(value);
}

export function formatMoney(value: string | number | { toString(): string }, currency: string): string {
  const amount = Number(value.toString());
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}
