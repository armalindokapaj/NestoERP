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
