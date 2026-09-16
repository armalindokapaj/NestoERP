import type { Prisma, PrismaClient } from "@prisma/client";

import type { ModuleKey } from "@/config/modules";
import type { UserContext } from "@/lib/context/types";

/**
 * Business activity (PRD #8 §45, PRD #10 §153).
 *
 * Every meaningful mutation records who did it. There are no anonymous business
 * changes (PRD #10 §238). Activity is written inside the same transaction as
 * the change it describes, so a rolled-back write leaves no orphan entry
 * (PRD #8 §92).
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
    },
  });
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
    },
  });
}

/** Describes a field change for activity metadata, e.g. a status transition. */
export function changeMetadata(
  changes: Record<string, { from: unknown; to: unknown }>,
): Prisma.InputJsonValue {
  return { changes } as Prisma.InputJsonValue;
}
