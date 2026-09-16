import type { Prisma } from "@prisma/client";

import { AccessError } from "@/lib/access/guards";
import type { ModuleKey } from "@/config/modules";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { logger } from "@/lib/core/observability/logger";
import { currentRequestContext, newCorrelationId } from "@/lib/core/observability/request-context";
import { buildIdempotencyKey, findIntegration } from "./integration.registry";

/**
 * Cross-module handoff execution (PRD #23 §17, §44-§47).
 *
 * The guarantee this exists for: running the same handoff twice produces one
 * target, not two. A duplicated commitment or invoice is a financial defect, so
 * idempotency is enforced by a unique constraint rather than a pre-check
 * (PRD #23 §45, §230, PRD #35 §47).
 */

export type EntityRef = {
  module: string;
  entityType: string;
  id: string;
  label?: string | null;
  href?: string | null;
};

export type IntegrationResult<T> = {
  integrationType: string;
  status: "CREATED" | "EXISTING" | "SKIPPED";
  target: EntityRef | null;
  integrationLinkId: string | null;
  value: T | null;
};

function moduleEnabled(context: UserContext, moduleKey: string): boolean {
  const access = context.moduleAccess[moduleKey as ModuleKey];
  return Boolean(access?.enabled);
}

/**
 * Runs a CREATE_FROM or SYNCHRONIZE handoff.
 *
 * `create` receives the transaction so the target record, the link and any
 * required audit all commit together — or none of them do (PRD #23 §41, §327).
 */
export async function runIntegration<T>(
  context: UserContext,
  params: {
    integrationType: string;
    source: { entityType: string; id: string; label?: string | null };
    correlationId?: string;
    create: (tx: Prisma.TransactionClient) => Promise<{ id: string; label?: string | null }>;
  },
): Promise<IntegrationResult<T>> {
  const definition = findIntegration(params.integrationType);
  if (!definition) throw new AccessError("NOT_FOUND", "That integration is not supported.");

  const correlationId =
    params.correlationId ?? currentRequestContext()?.correlationId ?? newCorrelationId();

  const idempotencyKey = buildIdempotencyKey(
    context.companyId,
    definition.id,
    params.source.id,
  );

  // An existing link means the handoff already happened. Returning it is the
  // whole point: a retry is safe (PRD #23 §45, §94).
  const existing = await prisma.integrationLink.findUnique({
    where: {
      companyId_integrationType_idempotencyKey: {
        companyId: context.companyId,
        integrationType: definition.id,
        idempotencyKey,
      },
    },
  });

  if (existing && existing.status === "ACTIVE") {
    return {
      integrationType: definition.id,
      status: "EXISTING",
      target: {
        module: existing.targetModule,
        entityType: existing.targetEntityType,
        id: existing.targetEntityId,
      },
      integrationLinkId: existing.id,
      value: null,
    };
  }

  // A disabled target module means the handoff cannot happen; whether that is
  // an error or simply nothing depends on the definition (PRD #23 §28).
  if (!moduleEnabled(context, definition.targetModule)) {
    if (definition.targetModuleRequired) {
      throw new AccessError("MODULE_UNAVAILABLE", "The target module is not enabled.");
    }
    await recordAttempt(context.companyId, definition.id, params.source, idempotencyKey, correlationId, "SKIPPED");
    return {
      integrationType: definition.id,
      status: "SKIPPED",
      target: null,
      integrationLinkId: null,
      value: null,
    };
  }

  const attempt = await recordAttempt(
    context.companyId,
    definition.id,
    params.source,
    idempotencyKey,
    correlationId,
    "STARTED",
  );

  try {
    const result = await prisma.$transaction(async (tx) => {
      const target = await params.create(tx);

      const link = await tx.integrationLink.create({
        data: {
          companyId: context.companyId,
          integrationType: definition.id,
          mode: definition.mode,
          sourceModule: definition.sourceModule,
          sourceEntityType: definition.sourceEntityType,
          sourceEntityId: params.source.id,
          targetModule: definition.targetModule,
          targetEntityType: definition.targetEntityType,
          targetEntityId: target.id,
          idempotencyKey,
          correlationId,
          createdByMemberId: context.membershipId,
        },
      });

      return { target, link };
    });

    await prisma.integrationAttempt.update({
      where: { id: attempt.id },
      data: { status: "SUCCEEDED", completedAt: new Date() },
    });

    logger.info("integration.succeeded", {
      integrationType: definition.id,
      sourceEntityId: params.source.id,
      targetEntityId: result.target.id,
    });

    return {
      integrationType: definition.id,
      status: "CREATED",
      target: {
        module: definition.targetModule,
        entityType: definition.targetEntityType,
        id: result.target.id,
        label: result.target.label ?? null,
      },
      integrationLinkId: result.link.id,
      value: null,
    };
  } catch (error) {
    const errorCode = error instanceof Error ? error.message.slice(0, 100) : "UNKNOWN";
    await prisma.integrationAttempt.update({
      where: { id: attempt.id },
      data: { status: "FAILED", errorCode, completedAt: new Date() },
    });
    logger.error("integration.failed", { integrationType: definition.id, errorCode });
    throw error;
  }
}

async function recordAttempt(
  companyId: string,
  integrationType: string,
  source: { entityType: string; id: string },
  idempotencyKey: string,
  correlationId: string,
  status: "STARTED" | "SKIPPED",
) {
  const previous = await prisma.integrationAttempt.count({
    where: { companyId, integrationType, idempotencyKey },
  });

  const definition = findIntegration(integrationType);

  return prisma.integrationAttempt.create({
    data: {
      companyId,
      integrationType,
      sourceModule: definition?.sourceModule ?? "unknown",
      sourceEntityType: source.entityType,
      sourceEntityId: source.id,
      idempotencyKey,
      correlationId,
      status,
      attemptNumber: previous + 1,
      completedAt: status === "SKIPPED" ? new Date() : null,
    },
  });
}

/**
 * Related records for a source, filtered to what the viewer may actually open.
 * A link the user cannot access yields no href and no label (PRD #23 §34, §131).
 */
export async function listIntegrationLinks(
  context: UserContext,
  source: { entityType: string; id: string },
): Promise<EntityRef[]> {
  const links = await prisma.integrationLink.findMany({
    where: {
      companyId: context.companyId,
      sourceEntityType: source.entityType,
      sourceEntityId: source.id,
      status: "ACTIVE",
    },
  });

  return links.map((link) => ({
    module: link.targetModule,
    entityType: link.targetEntityType,
    id: link.targetEntityId,
    href: moduleEnabled(context, link.targetModule) ? null : null,
  }));
}

/**
 * Records a handoff that a module performed itself (PRD #23 §21, §44, §94).
 *
 * `runIntegration` owns its transaction, which suits a handoff that starts
 * fresh. Several of NESTO's handoffs do not: approving a purchase order writes
 * the order, its status history and the finance commitment in one transaction,
 * and the commitment cannot be moved out of it without losing the atomicity
 * PRD #23 §41 requires. Those flows call this instead.
 *
 * It writes the same link and the same attempt, from the same registry, with
 * the same idempotency key — so the trace does not depend on which entry point
 * a handoff used. What it deliberately does not do is decide whether the
 * handoff should happen: the caller already did that, inside its own
 * transaction, with its own rules.
 *
 * Safe to call repeatedly. The unique constraint on
 * (companyId, integrationType, idempotencyKey) is what makes a retry produce
 * one link rather than two, so this upserts rather than pre-checking.
 */
export async function linkIntegration(
  tx: Prisma.TransactionClient,
  context: UserContext,
  params: {
    integrationType: string;
    source: { id: string };
    target: { id: string };
  },
): Promise<string | null> {
  const definition = findIntegration(params.integrationType);
  if (!definition) return null;

  const correlationId = currentRequestContext()?.correlationId ?? newCorrelationId();
  const idempotencyKey = buildIdempotencyKey(
    context.companyId,
    definition.id,
    params.source.id,
  );

  const link = await tx.integrationLink.upsert({
    where: {
      companyId_integrationType_idempotencyKey: {
        companyId: context.companyId,
        integrationType: definition.id,
        idempotencyKey,
      },
    },
    // A synchronise re-run points at the same target; re-pointing it is how a
    // SYNCHRONIZE handoff stays true after the target is replaced.
    update: { targetEntityId: params.target.id, status: "ACTIVE" },
    create: {
      companyId: context.companyId,
      integrationType: definition.id,
      mode: definition.mode,
      sourceModule: definition.sourceModule,
      sourceEntityType: definition.sourceEntityType,
      sourceEntityId: params.source.id,
      targetModule: definition.targetModule,
      targetEntityType: definition.targetEntityType,
      targetEntityId: params.target.id,
      idempotencyKey,
      correlationId,
      createdByMemberId: context.membershipId,
    },
    select: { id: true },
  });

  const previous = await tx.integrationAttempt.count({
    where: { companyId: context.companyId, integrationType: definition.id, idempotencyKey },
  });

  await tx.integrationAttempt.create({
    data: {
      companyId: context.companyId,
      integrationType: definition.id,
      sourceModule: definition.sourceModule,
      sourceEntityType: definition.sourceEntityType,
      sourceEntityId: params.source.id,
      idempotencyKey,
      correlationId,
      status: "SUCCEEDED",
      attemptNumber: previous + 1,
      completedAt: new Date(),
    },
  });

  return link.id;
}

/* -------------------------------------------------------------------------- */
/* Reference links (PRD #48 §64, §65)                                          */
/* -------------------------------------------------------------------------- */

/**
 * A reference one record keeps to another — a daily log to an inspection, a
 * milestone to a meeting, an RFI to a submittal.
 *
 * Unlike the handoffs above, nothing is created on the other side and nothing
 * is kept in step: the link is the whole fact. What it shares with them is the
 * table, which is why it is written here. `IntegrationLink` is shared
 * infrastructure, and a module that writes it directly writes its own idea of
 * mode, status and idempotency key — three modules did, three slightly
 * different ways (PRD #48 §64, §106).
 *
 * The caller has already decided the link is allowed: that its author may edit
 * the source, may read the target, and that both are on the same project. This
 * owns how the row is shaped and how a repeat is absorbed.
 */
export async function linkReference(
  tx: Prisma.TransactionClient,
  context: UserContext,
  params: {
    integrationType: string;
    source: { module: string; entityType: string; id: string };
    target: { module: string; entityType: string; id: string };
  },
): Promise<{ id: string }> {
  const { source, target } = params;
  // Re-linking a pair that was unlinked returns the same row to ACTIVE rather
  // than leaving two rows for one relationship (PRD #48 §33, §205).
  const idempotencyKey = `${source.entityType}:${source.id}:${target.entityType}:${target.id}`;

  return tx.integrationLink.upsert({
    where: {
      companyId_integrationType_idempotencyKey: {
        companyId: context.companyId,
        integrationType: params.integrationType,
        idempotencyKey,
      },
    },
    create: {
      companyId: context.companyId,
      integrationType: params.integrationType,
      mode: "REFERENCE",
      sourceModule: source.module,
      sourceEntityType: source.entityType,
      sourceEntityId: source.id,
      targetModule: target.module,
      targetEntityType: target.entityType,
      targetEntityId: target.id,
      idempotencyKey,
      correlationId: currentRequestContext()?.correlationId ?? null,
      createdByMemberId: context.membershipId,
    },
    update: { status: "ACTIVE", targetEntityId: target.id },
    select: { id: true },
  });
}

/**
 * Withdraws a reference link.
 *
 * Cancelled rather than deleted: the link was a statement somebody made, and
 * the audit trail of it outlives the relationship (PRD #48 §128, §206).
 * Answers whether this call is the one that withdrew it, so a caller can tell
 * a repeat from a link that was never theirs.
 */
export async function unlinkReference(
  tx: Prisma.TransactionClient,
  context: UserContext,
  params: { integrationType: string; linkId: string; source: { entityType: string; id: string } },
): Promise<boolean> {
  const { count } = await tx.integrationLink.updateMany({
    where: {
      id: params.linkId,
      companyId: context.companyId,
      integrationType: params.integrationType,
      sourceEntityType: params.source.entityType,
      sourceEntityId: params.source.id,
      status: "ACTIVE",
    },
    data: { status: "CANCELLED" },
  });
  return count > 0;
}
