import type { Prisma } from "@prisma/client";

import { inGroupWorkspace } from "@/config/workspace";
import { can } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { resolveWorkspaceContexts } from "@/lib/context/workspace-access";
import type { RecordSummary } from "@/lib/core/records/record.types";
import { prisma } from "@/lib/database/prisma";

/**
 * Attention items (PRD #25 §63-§79, §146).
 *
 * Condition-based, not event-based. An overdue invoice produces one attention
 * item that stays until the invoice is paid, however many times the evaluator
 * runs — reading it changes nothing (PRD #25 §14, §15, §77).
 */

export type AttentionItemDTO = {
  id: string;
  conditionKey: string;
  moduleKey: string;
  title: string;
  body: string | null;
  priority: string;
  status: string;
  dismissible: boolean;
  firstDetectedAt: string;
  entity: { entityType: string; entityId: string };
};

/** The condition stopped being true (PRD #25 §15). */
export async function resolveAttention(
  tx: Prisma.TransactionClient,
  companyId: string,
  dedupeKey: string,
): Promise<void> {
  await resolveAttentionFor(tx, { companyId, dedupeKey });
}

/**
 * Which items to resolve, for a service that has just ended a condition.
 *
 * Every field narrows; an empty selection beyond `companyId` is refused rather
 * than resolving a company's whole list by accident.
 */
export type AttentionTarget = {
  companyId: string;
  entityType?: string;
  entityId?: string;
  conditionKeys?: string[];
  /** One person's copy of a condition everyone was told about. */
  recipientMemberId?: string;
  dedupeKey?: string;
  /** Items keyed `…:<id>` — one approval round's items across every reviewer. */
  dedupeKeySuffix?: string;
  /**
   * Resolve items the recipient had already dismissed. Dismissing hides an
   * item; it does not make the condition untrue, so a condition that really
   * has ended should close both (PRD #25 §76).
   */
  includeDismissed?: boolean;
};

/**
 * Attention's own write door (PRD #48 §66, §67).
 *
 * Attention is shared platform infrastructure: a module knows its condition
 * ended, not how the item is stored, who else holds a copy, or what "resolved"
 * means for one that was dismissed first. Modules call this inside their own
 * transaction so the resolution commits with the change that caused it
 * (PRD #48 §123); nothing outside this file writes `AttentionItem`.
 *
 * Answers how many items closed, for callers that report it.
 */
export async function resolveAttentionFor(
  tx: Pick<Prisma.TransactionClient, "attentionItem">,
  target: AttentionTarget,
): Promise<number> {
  const { companyId, entityType, entityId, conditionKeys, recipientMemberId, dedupeKey, dedupeKeySuffix, includeDismissed } = target;
  if (!entityType && !entityId && !conditionKeys?.length && !recipientMemberId && !dedupeKey && !dedupeKeySuffix) {
    throw new AccessError("VALIDATION_ERROR", "Resolving attention needs something to resolve.");
  }
  // Both would land on the same `dedupeKey` key and one would silently win.
  if (dedupeKey && dedupeKeySuffix) {
    throw new AccessError("VALIDATION_ERROR", "Give a dedupe key or a suffix, not both.");
  }

  const { count } = await tx.attentionItem.updateMany({
    where: {
      companyId,
      ...(entityType ? { entityType } : {}),
      ...(entityId ? { entityId } : {}),
      ...(conditionKeys?.length ? { conditionKey: { in: conditionKeys } } : {}),
      ...(recipientMemberId ? { recipientMemberId } : {}),
      ...(dedupeKey ? { dedupeKey } : {}),
      ...(dedupeKeySuffix ? { dedupeKey: { endsWith: dedupeKeySuffix } } : {}),
      status: includeDismissed ? { in: ["ACTIVE", "DISMISSED"] } : "ACTIVE",
    },
    data: { status: "RESOLVED", resolvedAt: new Date() },
  });
  return count;
}

/**
 * Modules this reader can open right now: enabled for the company, and not
 * NONE for their role. An item filed under anything else is not theirs to see,
 * whatever the table still says (PRD #25 §279, PRD #47 §26).
 */
function reachableModuleKeys(context: UserContext): string[] {
  return Object.entries(context.moduleAccess)
    .filter(([, access]) => access.enabled && access.accessLevel !== "NONE")
    .map(([key]) => key);
}

/**
 * The raw active rows for this member — a note written when a condition was
 * detected, not a statement of current access. Never served as it stands:
 * `listReadableAttention` and `countReadableAttention` re-read each record
 * first (PRD #47 §77).
 */
export async function listActiveAttention(context: UserContext, limit = 25): Promise<AttentionItemDTO[]> {
  const rows = await prisma.attentionItem.findMany({
    where: {
      companyId: context.companyId,
      recipientMemberId: context.membershipId,
      status: "ACTIVE",
      moduleKey: { in: reachableModuleKeys(context) },
    },
    // Most urgent first, then oldest unresolved (PRD #25 §156).
    orderBy: [{ priority: "desc" }, { firstDetectedAt: "asc" }],
    take: Math.min(limit, 100),
  });

  return rows.map((row) => ({
    id: row.id,
    conditionKey: row.conditionKey,
    moduleKey: row.moduleKey,
    title: row.title,
    body: row.body,
    priority: row.priority,
    status: row.status,
    dismissible: row.dismissible,
    firstDetectedAt: row.firstDetectedAt.toISOString(),
    entity: { entityType: row.entityType, entityId: row.entityId },
  }));
}

export async function dismissAttention(context: UserContext, id: string): Promise<void> {
  const item = await prisma.attentionItem.findFirst({
    where: { id, companyId: context.companyId, recipientMemberId: context.membershipId },
  });
  if (!item) throw new AccessError("NOT_FOUND");

  // A critical safety condition is not something a user can wave away
  // (PRD #25 §79, §160).
  if (!item.dismissible) {
    throw new AccessError("FORBIDDEN", "This item cannot be dismissed while the condition applies.");
  }

  await prisma.attentionItem.update({
    where: { id },
    data: { status: "DISMISSED", dismissedAt: new Date() },
  });
}

/**
 * When a module is switched off or access is withdrawn, its outstanding
 * attention goes quiet rather than pointing at something unreachable
 * (PRD #25 §279, §281).
 *
 * Belongs in the module switch in Company Settings. Until it is called there,
 * the read side does not depend on it: lists and counts drop items for modules
 * the reader cannot reach, and reconciliation resolves them on its next run.
 */
export async function suppressModuleAttention(companyId: string, moduleKey: string): Promise<number> {
  const result = await prisma.attentionItem.updateMany({
    where: { companyId, moduleKey, status: "ACTIVE" },
    data: { status: "RESOLVED", resolvedAt: new Date() },
  });
  return result.count;
}

export type ReadableAttentionDTO = AttentionItemDTO & {
  href: string;
  /** The company the condition is in, named in the Group workspace only (Workspace Context §45). */
  company?: { id: string; name: string };
};

const APPROVAL_CONDITIONS = new Set(["PENDING_APPROVAL", "PROCUREMENT_ACTION_REQUIRED", "APPROVAL_OVERDUE"]);

function approvalLink(recordType: string, recordId: string): string {
  return `/approvals?record=${encodeURIComponent(`${recordType}:${recordId}`)}`;
}

/**
 * Whether this reader may be shown the item now: the condition's own reader
 * permissions (when the record is not the condition's subject), and the record
 * itself, read through the registry in their context. Null when not.
 */
async function readableRecord(context: UserContext, item: AttentionItemDTO, cache: Map<string, RecordSummary | null>): Promise<RecordSummary | null> {
  const { loadRecord } = await import("@/lib/core/records/record.registry");
  const { normaliseEntityType } = await import("./notification.dispatch");
  const { findAttentionCondition, readerAllowed } = await import("./attention.conditions");

  const condition = findAttentionCondition(item.conditionKey);
  if (condition && !readerAllowed(context, condition)) return null;

  const type = normaliseEntityType(item.entity.entityType);
  const key = `${type}:${item.entity.entityId}`;
  if (!cache.has(key)) cache.set(key, await loadRecord(context, type, item.entity.entityId));
  const record = cache.get(key) ?? null;
  return record && !record.archived ? record : null;
}

/**
 * Active attention the reader can still act on, each with a link resolved now
 * (PRD #38 §82, §86).
 *
 * An item is a note written when the condition was detected; the record behind
 * it is read again through the record registry before a link is offered. An
 * item whose record this person can no longer open is left out entirely —
 * title included — until reconciliation resolves it.
 */
export async function listReadableAttention(context: UserContext, limit = 25): Promise<ReadableAttentionDTO[]> {
  const { normaliseEntityType } = await import("./notification.dispatch");
  const { findAttentionCondition } = await import("./attention.conditions");

  const now = new Date();
  const items = await listActiveAttention(context, Math.min(limit * 2, 100));
  const readable: ReadableAttentionDTO[] = [];
  const ended: string[] = [];
  const records = new Map<string, RecordSummary | null>();
  for (const item of items) {
    const type = normaliseEntityType(item.entity.entityType);
    // The condition is asked again first: a task completed a minute ago is not
    // shown as overdue while the scheduler catches up (PRD #38 §85).
    const condition = findAttentionCondition(item.conditionKey);
    if (condition && !(await condition.holds(context.companyId, type, item.entity.entityId, now))) {
      ended.push(item.id);
      continue;
    }
    const record = await readableRecord(context, item, records);
    if (!record) continue;
    // Waiting approvals open in the Approvals Center's drawer (PRD #41 §42).
    const href = APPROVAL_CONDITIONS.has(item.conditionKey) && can(context, "approvals.view") ? approvalLink(record.type, record.id) : record.href;
    readable.push({ ...item, href });
    if (readable.length >= limit) break;
  }
  if (ended.length > 0) {
    await prisma.attentionItem.updateMany({
      where: { id: { in: ended }, companyId: context.companyId, recipientMemberId: context.membershipId, status: "ACTIVE" },
      data: { status: "RESOLVED", resolvedAt: now },
    });
  }
  return readable;
}

/** How many active items the count looks at — enough for any badge, bounded for a poll. */
export const ATTENTION_COUNT_WINDOW = 100;

/**
 * The attention counts, taken from what the reader could actually be shown
 * (PRD #47 §77, §175).
 *
 * Counts are data: a count of rows would tell somebody who lost a record — or
 * whose company switched its module off — that something about it is still
 * waiting. Each item's record is re-read in this reader's context, over a
 * bounded window of the most urgent items. Unlike the list, the condition is
 * not re-evaluated here: that is freshness, not access, and some conditions
 * are too expensive to ask on every poll of the top bar.
 */
export async function countReadableAttention(context: UserContext): Promise<{ active: number; critical: number }> {
  const items = await listActiveAttention(context, ATTENTION_COUNT_WINDOW);
  const records = new Map<string, RecordSummary | null>();
  let active = 0;
  let critical = 0;
  for (const item of items) {
    if (!(await readableRecord(context, item, records))) continue;
    active += 1;
    if (item.priority === "CRITICAL") critical += 1;
  }
  return { active, critical };
}

/* -------------------------------------------------------------------------- */
/* The active workspace (Workspace Context §45)                                */
/* -------------------------------------------------------------------------- */

const PRIORITY_RANK: Record<string, number> = { LOW: 0, NORMAL: 1, HIGH: 2, CRITICAL: 3 };

/**
 * The attention the person can act on in the active workspace. In the Group
 * workspace it is each company's own list — this person's items there, each
 * record read again in that company's context — merged most urgent first, then
 * oldest unresolved (§156), every item naming its company.
 */
export async function listReadableAttentionForWorkspace(session: UserContext, limit = 25): Promise<ReadableAttentionDTO[]> {
  if (!inGroupWorkspace(session)) return listReadableAttention(session, limit);
  const contexts = await resolveWorkspaceContexts(session, {});
  const lists = await Promise.all(
    contexts.map(async (context) => {
      const company = { id: context.companyId, name: context.company.name };
      return (await listReadableAttention(context, limit)).map((item) => ({ ...item, company }));
    }),
  );
  return lists
    .flat()
    .sort(
      (a, b) =>
        (PRIORITY_RANK[b.priority] ?? 0) - (PRIORITY_RANK[a.priority] ?? 0) ||
        a.firstDetectedAt.localeCompare(b.firstDetectedAt) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, limit);
}

/** Dismisses one of the person's own items, in the company it belongs to, by that company's own rules (a critical condition still cannot be waved away). */
export async function dismissAttentionForWorkspace(session: UserContext, id: string): Promise<void> {
  if (!inGroupWorkspace(session)) return dismissAttention(session, id);
  const contexts = await resolveWorkspaceContexts(session, {});
  const item = await prisma.attentionItem.findFirst({
    where: { id, OR: contexts.map((context) => ({ companyId: context.companyId, recipientMemberId: context.membershipId })) },
    select: { companyId: true },
  });
  const owner = contexts.find((context) => context.companyId === item?.companyId);
  if (!owner) throw new AccessError("NOT_FOUND");
  await dismissAttention(owner, id);
}
