import type { Prisma } from "@prisma/client";

import type { UserContext } from "@/lib/context/types";
import type { RecordType } from "@/lib/core/records/record.types";
import { NotificationEvent } from "./notification.events";
import { enqueueNotificationEvent } from "./notification.service";

/**
 * Critical safety alerts (PRD #38 §74, §78, §149).
 *
 * Raised when a record reaches the level that must interrupt people: a
 * critical hazard, a critical incident, a stop-work order. The event is
 * mandatory — a preference cannot silence it in-app — and, like every event,
 * reaches only members who can open the record.
 */
export async function notifyCriticalSafety(
  tx: Prisma.TransactionClient,
  context: UserContext,
  record: { recordType: RecordType; recordId: string; projectId: string | null; noun: string },
): Promise<void> {
  const project = record.projectId
    ? await tx.project.findFirst({
        where: { id: record.projectId, companyId: context.companyId },
        select: { name: true, projectManagerMemberId: true },
      })
    : null;

  await enqueueNotificationEvent(tx, {
    companyId: context.companyId,
    eventType: NotificationEvent.HSE_CRITICAL_RISK,
    moduleKey: "hse",
    entityType: record.recordType,
    entityId: record.recordId,
    actorMemberId: context.membershipId,
    projectId: record.projectId,
    payload: {
      recordLabel: record.noun,
      projectName: project?.name ?? null,
      projectManagerMemberId: project?.projectManagerMemberId ?? null,
    },
  });
}
