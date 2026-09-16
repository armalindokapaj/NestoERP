import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/database/prisma";
import { currentRequestContext } from "@/lib/core/observability/request-context";
import type { UserContext } from "@/lib/context/types";
import { applyRedaction } from "./audit-redaction";
import { findAuditPolicy } from "./audit-policy.registry";
import type { AuditChange, AuditContext, RecordAuditInput } from "./audit.types";

/**
 * The audit writer (PRD #28 §45-§50, §262).
 *
 * Writes are INSERT only — this module deliberately exposes no update and no
 * delete (PRD #28 §11, §189). Where a policy is `required`, the write happens
 * inside the caller's transaction so a failed audit rolls the business mutation
 * back: an action that must be auditable is not allowed to happen unaudited
 * (PRD #28 §49, §136, §292).
 */

/** Field-level differences, with unchanged fields omitted (PRD #28 §34, §310). */
export function diffFields(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): Record<string, AuditChange> | null {
  if (!before && !after) return null;

  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const changes: Record<string, AuditChange> = {};

  for (const key of keys) {
    const from = before?.[key] ?? null;
    const to = after?.[key] ?? null;
    if (JSON.stringify(from) === JSON.stringify(to)) continue;
    changes[key] = { before: from, after: to };
  }

  return Object.keys(changes).length > 0 ? changes : null;
}

/** Builds an audit context from the resolved user context (PRD #28 §357). */
export function auditContextFromUser(
  context: UserContext,
  extra: Partial<Pick<AuditContext, "requestId" | "correlationId" | "ipAddress" | "userAgent">> = {},
): AuditContext {
  return {
    companyId: context.companyId,
    actor: {
      type: "USER",
      userId: context.userId,
      memberId: context.membershipId,
      displayNameSnapshot: `${context.firstName} ${context.lastName}`.trim() || null,
      roleSnapshot: context.role ?? null,
    },
    ...extra,
  };
}

async function write(
  client: Prisma.TransactionClient | typeof prisma,
  context: AuditContext,
  input: RecordAuditInput,
) {
  const policy = findAuditPolicy(input.actionKey);
  // An unregistered action key would store evidence nobody can interpret.
  if (!policy) throw new Error(`UNREGISTERED_AUDIT_ACTION:${input.actionKey}`);

  const before = applyRedaction(input.before, policy.allowFields, policy.redactFields);
  const after = applyRedaction(input.after, policy.allowFields, policy.redactFields);

  const snapshot = policy.snapshotMode;
  const changes = snapshot === "NONE" ? null : diffFields(before, after);
  // A job's audit names the job, so "System" is never the whole answer to who did it (PRD #51 §13).
  const jobKey = context.actor.type === "SYSTEM" ? currentRequestContext()?.jobKey : undefined;

  return client.auditEvent.create({
    data: {
      companyId: context.companyId,
      actorType: context.actor.type,
      actorUserId: context.actor.userId ?? null,
      actorMemberId: context.actor.memberId ?? null,
      actorDisplayNameSnapshot: context.actor.displayNameSnapshot ?? (jobKey ? `System (${jobKey})` : null),
      actorRoleSnapshot: context.actor.roleSnapshot ?? null,
      moduleKey: policy.moduleKey,
      category: policy.category,
      severity: policy.severity,
      actionKey: policy.actionKey,
      entityType: input.entity?.type ?? null,
      entityId: input.entity?.id ?? null,
      entityLabelSnapshot: input.entity?.label?.slice(0, 200) ?? null,
      projectId: input.projectId ?? null,
      beforeJson: snapshot === "BEFORE_AFTER" ? (before as Prisma.InputJsonValue) ?? undefined : undefined,
      afterJson: snapshot === "BEFORE_AFTER" ? (after as Prisma.InputJsonValue) ?? undefined : undefined,
      changesJson: changes ? (changes as unknown as Prisma.InputJsonValue) : undefined,
      reason: input.reason?.slice(0, 2000) ?? null,
      metadataJson: input.metadata ? (input.metadata as Prisma.InputJsonValue) : undefined,
      // The request's own ids when the caller did not pass any, so a decision,
      // its outbox event and its audit share one correlation (PRD #32 §34, PRD #41 §229).
      correlationId: context.correlationId ?? currentRequestContext()?.correlationId ?? null,
      requestId: context.requestId ?? currentRequestContext()?.requestId ?? null,
      ipAddress: context.ipAddress ?? null,
      userAgent: context.userAgent?.slice(0, 500) ?? null,
    },
  });
}

/**
 * Records an audited action.
 *
 * Pass `tx` for anything a policy marks required, so the evidence and the
 * mutation commit together. Without a transaction a required policy still
 * throws on failure rather than swallowing it (PRD #28 §291, §292).
 */
export async function recordAuditEvent(
  context: AuditContext,
  input: RecordAuditInput,
  options: { tx?: Prisma.TransactionClient } = {},
): Promise<void> {
  const policy = findAuditPolicy(input.actionKey);
  const client = options.tx ?? prisma;

  try {
    await write(client, context, input);
  } catch (error) {
    if (policy?.required) throw error;
    // Informational audit must never take a working feature down with it.
    console.error("audit.write.failed", {
      actionKey: input.actionKey,
      companyId: context.companyId,
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}

/** Convenience wrapper for the common case: a user did something. */
export async function recordUserAction(
  context: UserContext,
  input: RecordAuditInput,
  options: { tx?: Prisma.TransactionClient; correlationId?: string } = {},
): Promise<void> {
  return recordAuditEvent(
    auditContextFromUser(context, { correlationId: options.correlationId }),
    input,
    { tx: options.tx },
  );
}

/** Automatic platform actions: expiries, scheduled transitions (PRD #28 §15). */
export async function recordSystemAction(
  companyId: string,
  input: RecordAuditInput,
  options: { tx?: Prisma.TransactionClient; correlationId?: string } = {},
): Promise<void> {
  return recordAuditEvent(
    { companyId, actor: { type: "SYSTEM" }, correlationId: options.correlationId },
    input,
    { tx: options.tx },
  );
}

/**
 * Cross-module handoffs, carrying the human who triggered them in metadata so
 * the chain stays readable (PRD #28 §16, §207, §208).
 */
export async function recordIntegrationAction(
  companyId: string,
  input: RecordAuditInput,
  options: { tx?: Prisma.TransactionClient; correlationId?: string; initiatedByMemberId?: string } = {},
): Promise<void> {
  return recordAuditEvent(
    { companyId, actor: { type: "INTEGRATION" }, correlationId: options.correlationId },
    {
      ...input,
      metadata: { ...(input.metadata ?? {}), initiatedByMemberId: options.initiatedByMemberId ?? null },
    },
    { tx: options.tx },
  );
}
