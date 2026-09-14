import type { Prisma } from "@prisma/client";

import { enqueueNotificationEvent } from "@/lib/core/notifications/notification.service";
import { MODULE } from "./engineering.permissions";

/**
 * One way engineering records tell people (PRD #46 §194-§196). The event goes
 * in the outbox inside the change's transaction; the dispatcher re-reads the
 * record for each recipient, drops the actor, and applies preferences — so a
 * name here never grants anybody a look at the record.
 */
export async function notifyEngineering(
  tx: Prisma.TransactionClient,
  input: {
    companyId: string;
    eventType: string;
    entityType: string;
    entityId: string;
    projectId: string;
    actorMemberId: string | null;
    memberIds: Array<string | null | undefined>;
    payload: Record<string, unknown>;
  },
) {
  const memberIds = [...new Set(input.memberIds.filter((id): id is string => Boolean(id)))];
  if (!memberIds.length) return;
  await enqueueNotificationEvent(tx, {
    companyId: input.companyId,
    eventType: input.eventType,
    moduleKey: MODULE,
    entityType: input.entityType,
    entityId: input.entityId,
    actorMemberId: input.actorMemberId,
    projectId: input.projectId,
    payload: { ...input.payload, memberIds },
  });
}
