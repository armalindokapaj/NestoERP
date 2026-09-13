import type { Prisma } from "@prisma/client";

import type { ModuleKey } from "@/config/modules";
import type { Permission } from "@/config/permissions";
import type { UserContext } from "@/lib/context/types";
import type { RecordType } from "@/lib/core/records/record.types";
import { NotificationEvent } from "./notification.events";
import { enqueueNotificationEvent } from "./notification.service";

/**
 * Approval notifications for every module (PRD #38 §74).
 *
 * Each approval service opens and decides its own cycles; this is the one way
 * they announce it, so a request and its decision read the same whichever
 * module they come from. Enqueued on the caller's transaction — a submission
 * that rolls back tells nobody.
 */

type ApprovalRecord = {
  moduleKey: ModuleKey;
  /** The record registry's type, so each recipient's access can be re-read. */
  recordType: RecordType;
  recordId: string;
  /** "Purchase order", used when the record's own label cannot be resolved. */
  noun: string;
};

export async function notifyApprovalRequested(
  tx: Prisma.TransactionClient,
  context: UserContext,
  record: ApprovalRecord & {
    /** What deciding takes — the same permissions the approval service checks. */
    approvePermissions: Permission[];
    eventType?: typeof NotificationEvent.APPROVAL_REQUESTED | typeof NotificationEvent.PO_APPROVAL_REQUIRED;
  },
): Promise<void> {
  await enqueueNotificationEvent(tx, {
    companyId: context.companyId,
    eventType: record.eventType ?? NotificationEvent.APPROVAL_REQUESTED,
    moduleKey: record.moduleKey,
    entityType: record.recordType,
    entityId: record.recordId,
    actorMemberId: context.membershipId,
    payload: {
      recordLabel: record.noun,
      submittedByName: context.fullName,
      submittedByMemberId: context.membershipId,
      approvePermissions: record.approvePermissions,
    },
  });
}

export async function notifyApprovalDecided(
  tx: Prisma.TransactionClient,
  context: UserContext,
  record: ApprovalRecord & { decision: "APPROVED" | "REJECTED"; note: string | null; submittedByMemberId: string },
): Promise<void> {
  await enqueueNotificationEvent(tx, {
    companyId: context.companyId,
    eventType: NotificationEvent.APPROVAL_DECIDED,
    moduleKey: record.moduleKey,
    entityType: record.recordType,
    entityId: record.recordId,
    actorMemberId: context.membershipId,
    payload: {
      recordLabel: record.noun,
      decision: record.decision,
      reason: record.note,
      submittedByMemberId: record.submittedByMemberId,
    },
  });

  // The decision ends the condition for every approver at once (PRD #38 §85).
  await tx.attentionItem.updateMany({
    where: {
      companyId: context.companyId,
      conditionKey: { in: ["PENDING_APPROVAL", "PROCUREMENT_ACTION_REQUIRED"] },
      entityType: record.recordType,
      entityId: record.recordId,
      status: "ACTIVE",
    },
    data: { status: "RESOLVED", resolvedAt: new Date() },
  });
}
