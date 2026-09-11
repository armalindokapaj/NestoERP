import type { Prisma } from "@prisma/client";

import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
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

/**
 * Creates or refreshes an active condition.
 *
 * Priority may escalate as a deadline approaches, and the copy may change with
 * it — the item is the same item throughout (PRD #25 §196, §197).
 */
export async function upsertAttention(
  tx: Prisma.TransactionClient,
  input: {
    companyId: string;
    recipientMemberId: string;
    conditionKey: string;
    moduleKey: string;
    entityType: string;
    entityId: string;
    projectId?: string | null;
    title: string;
    body?: string | null;
    priority?: "LOW" | "NORMAL" | "HIGH" | "CRITICAL";
    dismissible?: boolean;
    dedupeKey: string;
  },
): Promise<void> {
  await tx.attentionItem.upsert({
    where: {
      companyId_recipientMemberId_dedupeKey: {
        companyId: input.companyId,
        recipientMemberId: input.recipientMemberId,
        dedupeKey: input.dedupeKey,
      },
    },
    update: {
      title: input.title,
      body: input.body ?? null,
      priority: input.priority ?? "NORMAL",
      status: "ACTIVE",
      lastEvaluatedAt: new Date(),
      resolvedAt: null,
    },
    create: {
      companyId: input.companyId,
      recipientMemberId: input.recipientMemberId,
      conditionKey: input.conditionKey,
      moduleKey: input.moduleKey,
      entityType: input.entityType,
      entityId: input.entityId,
      projectId: input.projectId ?? null,
      title: input.title,
      body: input.body ?? null,
      priority: input.priority ?? "NORMAL",
      dismissible: input.dismissible ?? true,
      dedupeKey: input.dedupeKey,
    },
  });
}

/** The condition stopped being true (PRD #25 §15). */
export async function resolveAttention(
  tx: Prisma.TransactionClient,
  companyId: string,
  dedupeKey: string,
): Promise<void> {
  await tx.attentionItem.updateMany({
    where: { companyId, dedupeKey, status: "ACTIVE" },
    data: { status: "RESOLVED", resolvedAt: new Date() },
  });
}

export async function listActiveAttention(context: UserContext, limit = 25): Promise<AttentionItemDTO[]> {
  const rows = await prisma.attentionItem.findMany({
    where: {
      companyId: context.companyId,
      recipientMemberId: context.membershipId,
      status: "ACTIVE",
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
 */
export async function suppressModuleAttention(companyId: string, moduleKey: string): Promise<number> {
  const result = await prisma.attentionItem.updateMany({
    where: { companyId, moduleKey, status: "ACTIVE" },
    data: { status: "RESOLVED", resolvedAt: new Date() },
  });
  return result.count;
}
