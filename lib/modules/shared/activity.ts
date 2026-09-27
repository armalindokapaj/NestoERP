import { Prisma, type PrismaClient } from "@prisma/client";

import type { ModuleKey } from "@/config/modules";
import type { UserContext } from "@/lib/context/types";
import { DB_NOW } from "@/lib/database/clock";
import { currentRequestContext } from "@/lib/core/observability/request-context";

/**
 * Business activity (PRD #8 §45, PRD #10 §153).
 *
 * Every meaningful mutation records who did it. There are no anonymous business
 * changes (PRD #10 §238). Activity is written inside the same transaction as
 * the change it describes, so a rolled-back write leaves no orphan entry
 * (PRD #8 §92).
 *
 * Each row carries the request's correlation id, the same one its outbox event,
 * audit event, worker attempt and resulting notifications carry, so a command
 * can be followed end to end (AUD-10 §8, gap 9). Only the id: no names or
 * payloads reach a log or metric label through it.
 */
export type ActivityInput = {
  module: ModuleKey | string;
  entityType: string;
  entityId: string;
  action: string;
  message: string;
  metadata?: Prisma.InputJsonValue;
};

type TransactionClient = Prisma.TransactionClient | PrismaClient;

export async function recordActivity(
  tx: TransactionClient,
  context: UserContext,
  input: ActivityInput,
): Promise<void> {
  await tx.activity.create({
    data: {
      companyId: context.companyId,
      module: input.module,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      message: input.message,
      actorMemberId: context.membershipId,
      actorUserId: context.userId,
      metadata: input.metadata,
      correlationId: currentRequestContext()?.correlationId ?? null,
    },
  });
  await touchProjectActivity(tx, context.companyId, input);
}

/**
 * Activity for an actor who has no `UserContext` yet (PRD #48 §20).
 *
 * There is exactly one of these: somebody accepting an invitation becomes a
 * member in the same transaction that records their joining, so at the moment
 * of writing there is no resolved context to take the company and the actor
 * from. Everything else uses `recordActivity`, and the actor is never absent
 * — an anonymous business change is not one of the options (PRD #10 §238).
 */
export async function recordActorActivity(
  tx: TransactionClient,
  actor: { companyId: string; memberId: string; userId: string },
  input: ActivityInput,
): Promise<void> {
  await tx.activity.create({
    data: {
      companyId: actor.companyId,
      module: input.module,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      message: input.message,
      actorMemberId: actor.memberId,
      actorUserId: actor.userId,
      metadata: input.metadata,
      correlationId: currentRequestContext()?.correlationId ?? null,
    },
  });
  await touchProjectActivity(tx, actor.companyId, input);
}

/**
 * Moves the project's `lastActivityAt` when the activity is about a project
 * (E-05A §15).
 *
 * Every module that does meaningful work on a project already says so here —
 * a task, a document, a meeting, a log, a status change all carry the project
 * in their activity — so this one place keeps the Projects page's "recently
 * active" order without any module having to remember to.
 *
 * Three decisions keep it from costing the write it rides on:
 *
 * - **Raw SQL**, so the project's `updatedAt` stays put. That column is the
 *   edit form's concurrency token (PRD #10 §178); if adding a task moved it, a
 *   project manager saving the project would be told somebody else had edited it.
 * - **At most once a minute per project.** A burst of work on one project locks
 *   its row once, not once per row written. The ordering is minute-accurate,
 *   which is all "most recently active" needs.
 * - **SKIP LOCKED.** If another transaction holds the project row, this one
 *   does not wait for it — and cannot deadlock against it. The holder is itself
 *   working on the project and records its own activity; the marker is at most
 *   that transaction late.
 *
 * Projects owns the row; the `lastActivityAt` column is co-owned with this
 * recorder (docs/data-ownership.md). It is written nowhere else.
 */
async function touchProjectActivity(tx: TransactionClient, companyId: string, input: ActivityInput): Promise<void> {
  const projectId = projectOf(input);
  if (!projectId) return;
  await tx.$executeRaw(Prisma.sql`
    UPDATE "projects" SET "lastActivityAt" = ${DB_NOW}
    WHERE "id" = (
      SELECT "id" FROM "projects"
      WHERE "id" = ${projectId}
        AND "companyId" = ${companyId}
        AND "lastActivityAt" < ${DB_NOW} - INTERVAL '1 minute'
      FOR UPDATE SKIP LOCKED
    )
  `);
}

function projectOf(input: ActivityInput): string | null {
  if (input.entityType === "Project") return input.entityId;
  const metadata = input.metadata;
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    const value = (metadata as Record<string, unknown>).projectId;
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

/** Describes a field change for activity metadata, e.g. a status transition. */
export function changeMetadata(
  changes: Record<string, { from: unknown; to: unknown }>,
): Prisma.InputJsonValue {
  return { changes } as Prisma.InputJsonValue;
}
