import { can } from "@/lib/access/can";
import { buildMemberContexts } from "@/lib/context/member-context";
import type { UserContext } from "@/lib/context/types";
import { assertEveryCompanySucceeded, forEachCompany } from "@/lib/core/jobs/system-context";
import { logger } from "@/lib/core/observability/logger";
import { loadRecord, recordDefinition } from "@/lib/core/records/record.registry";
import { prisma } from "@/lib/database/prisma";
import { resolveAttentionFor } from "./attention.service";
import {
  attentionConditionDefinitions,
  attentionDedupeKey,
  readerAllowed,
  type AttentionCandidate,
  type AttentionConditionDefinition,
} from "./attention.conditions";

/**
 * Attention reconciliation (PRD #38 §84, §85).
 *
 * Runs on the scheduler. For each company it asks every condition what is true
 * now, re-reads each record in each recipient's own context, and makes the
 * attention table agree:
 *
 *   - a condition that holds for someone who can open the record is an ACTIVE
 *     item (created, or refreshed if the wording or priority moved)
 *   - an ACTIVE item that no longer matches — the condition ended, the person
 *     lost access, the record was archived — is RESOLVED
 *   - a DISMISSED item stays dismissed for that episode; a new episode (a new
 *     due date, a new approval cycle) has a new key and appears again
 *
 * Idempotent: running it twice in a row changes nothing the second time.
 */

export type ReconcileResult = {
  companies: number;
  created: number;
  refreshed: number;
  resolved: number;
  failedConditions: string[];
};

type Desired = {
  recipientMemberId: string;
  conditionKey: string;
  moduleKey: string;
  entityType: string;
  entityId: string;
  projectId: string | null;
  title: string;
  body: string | null;
  priority: AttentionCandidate["priority"];
  dismissible: boolean;
  dedupeKey: string;
};

const pairKey = (memberId: string, dedupeKey: string) => `${memberId}|${dedupeKey}`;

export async function reconcileAttention(options: { companyId?: string; now?: Date } = {}): Promise<ReconcileResult> {
  const now = options.now ?? new Date();
  const result: ReconcileResult = { companies: 0, created: 0, refreshed: 0, resolved: 0, failedConditions: [] };
  const run = await forEachCompany(
    "attention.reconcile",
    async ({ companyId }) => {
      const outcome = await reconcileCompany(companyId, now);
      result.companies += 1;
      result.created += outcome.created;
      result.refreshed += outcome.refreshed;
      result.resolved += outcome.resolved;
      result.failedConditions.push(...outcome.failedConditions);
    },
    options.companyId ? { companyIds: [options.companyId] } : {},
  );
  assertEveryCompanySucceeded("attention.reconcile", run);
  return result;
}

async function reconcileCompany(companyId: string, now: Date): Promise<Omit<ReconcileResult, "companies">> {
  const definitions = attentionConditionDefinitions();
  const collected: Array<{ definition: AttentionConditionDefinition; candidates: AttentionCandidate[] }> = [];
  const failedConditions: string[] = [];

  for (const definition of definitions) {
    try {
      collected.push({ definition, candidates: await definition.collect(companyId, now) });
    } catch (error) {
      // One broken condition must not resolve every other condition's items:
      // its own existing items are left exactly as they are.
      failedConditions.push(definition.key);
      logger.error("attention.condition.failed", {
        companyId,
        condition: definition.key,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  const desired = await resolveRecipients(companyId, collected);
  const evaluated = collected.map(({ definition }) => definition.key);

  const existing = await prisma.attentionItem.findMany({
    where: { companyId, conditionKey: { in: evaluated } },
    select: { id: true, recipientMemberId: true, dedupeKey: true, status: true, title: true, body: true, priority: true },
  });
  const existingByPair = new Map(existing.map((row) => [pairKey(row.recipientMemberId, row.dedupeKey), row]));
  const desiredPairs = new Set(desired.map((row) => pairKey(row.recipientMemberId, row.dedupeKey)));

  let created = 0;
  let refreshed = 0;
  const unchanged: string[] = [];

  for (const item of desired) {
    const current = existingByPair.get(pairKey(item.recipientMemberId, item.dedupeKey));
    if (!current) {
      await prisma.attentionItem.createMany({ data: [{ ...item, companyId, lastEvaluatedAt: now }], skipDuplicates: true });
      created += 1;
      continue;
    }
    if (current.status === "DISMISSED") continue;
    const changed =
      current.status !== "ACTIVE" || current.title !== item.title || current.priority !== item.priority || current.body !== item.body;
    if (!changed) {
      unchanged.push(current.id);
      continue;
    }
    // Priority may escalate as a deadline nears; the item is the same item.
    await prisma.attentionItem.update({
      where: { id: current.id },
      data: {
        status: "ACTIVE",
        resolvedAt: null,
        title: item.title,
        body: item.body,
        priority: item.priority,
        dismissible: item.dismissible,
        lastEvaluatedAt: now,
      },
    });
    refreshed += 1;
  }
  if (unchanged.length > 0) {
    await prisma.attentionItem.updateMany({ where: { id: { in: unchanged } }, data: { lastEvaluatedAt: now } });
  }

  const stale = existing.filter(
    (row) => row.status === "ACTIVE" && !desiredPairs.has(pairKey(row.recipientMemberId, row.dedupeKey)),
  );
  if (stale.length > 0) {
    await prisma.attentionItem.updateMany({
      where: { id: { in: stale.map((row) => row.id) }, status: "ACTIVE" },
      data: { status: "RESOLVED", resolvedAt: now, lastEvaluatedAt: now },
    });
  }

  return { created, refreshed, resolved: stale.length, failedConditions };
}

/**
 * Who each candidate reaches: named members plus permission holders, each one
 * then checked against the record in their own context.
 */
async function resolveRecipients(
  companyId: string,
  collected: Array<{ definition: AttentionConditionDefinition; candidates: AttentionCandidate[] }>,
): Promise<Desired[]> {
  const needsEveryone = collected.some(({ candidates }) => candidates.some((candidate) => candidate.holders?.length));
  const named = collected.flatMap(({ candidates }) =>
    candidates.flatMap((candidate) => candidate.recipients.filter((id): id is string => Boolean(id))),
  );
  const everyone = needsEveryone
    ? (await prisma.companyMember.findMany({ where: { companyId, status: "ACTIVE" }, select: { id: true } })).map((row) => row.id)
    : [];
  const contexts = await buildMemberContexts(companyId, [...new Set([...named, ...everyone])]);

  const readable = new Map<string, boolean>();
  async function canOpen(context: UserContext, type: string, id: string): Promise<boolean> {
    const key = `${context.membershipId}|${type}|${id}`;
    let answer = readable.get(key);
    if (answer === undefined) {
      const record = await loadRecord(context, type, id);
      answer = record !== null && !record.archived;
      readable.set(key, answer);
    }
    return answer;
  }

  const desired: Desired[] = [];
  for (const { definition, candidates } of collected) {
    for (const candidate of candidates) {
      const registry = recordDefinition(candidate.entityType);
      if (!registry) continue;

      const members = new Set(candidate.recipients.filter((id): id is string => Boolean(id)));
      if (candidate.holders?.length) {
        for (const [memberId, context] of contexts) {
          if (candidate.holders.every((permission) => can(context, permission))) members.add(memberId);
        }
      }
      for (const excluded of candidate.exclude ?? []) members.delete(excluded);

      const dedupeKey = attentionDedupeKey(definition.key, candidate);
      for (const memberId of members) {
        const context = contexts.get(memberId);
        if (!context) continue;
        if (!readerAllowed(context, definition)) continue;
        if (!(await canOpen(context, candidate.entityType, candidate.entityId))) continue;
        desired.push({
          recipientMemberId: memberId,
          conditionKey: definition.key,
          moduleKey: registry.moduleKey,
          entityType: candidate.entityType,
          entityId: candidate.entityId,
          projectId: candidate.projectId,
          title: candidate.title.slice(0, 300),
          body: candidate.body?.slice(0, 1000) ?? null,
          priority: candidate.priority,
          dismissible: candidate.dismissible,
          dedupeKey,
        });
      }
    }
  }
  return desired;
}

/**
 * Resolves the items for one record straight away, when the service that ended
 * the condition knows it did (PRD #38 §85). The scheduled run would get there;
 * this makes it immediate for the obvious cases.
 */
export async function resolveAttentionForRecord(
  tx: Pick<typeof prisma, "attentionItem">,
  companyId: string,
  entityType: string,
  entityId: string,
  conditionKeys: string[],
  options: { recipientMemberId?: string; includeDismissed?: boolean } = {},
): Promise<void> {
  await resolveAttentionFor(tx, { companyId, entityType, entityId, conditionKeys, ...options });
}
