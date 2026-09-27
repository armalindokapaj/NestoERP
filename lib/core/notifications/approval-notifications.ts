import type { Prisma } from "@prisma/client";

import type { ModuleKey } from "@/config/modules";
import type { Permission } from "@/config/permissions";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import type { RecordType } from "@/lib/core/records/record.types";
import { resolveAttentionFor } from "./attention.service";
import { NotificationEvent } from "./notification.events";
import { enqueueNotificationEvent } from "./notification.service";

/**
 * Approval announcements for every module (PRD #38 §74, PRD #41 §40, §56).
 *
 * Each approval service opens and decides its own cycles; this is the one way
 * they announce it, so a request and its outcome read the same whichever
 * module they come from. Everything is written on the caller's transaction — a
 * submission that rolls back tells nobody, and a decision whose audit cannot
 * be written does not happen (PRD #41 §248).
 */

type ApprovalRecord = {
  moduleKey: ModuleKey;
  /** The record registry's type, so each recipient's access can be re-read. */
  recordType: RecordType;
  recordId: string;
  /** "Purchase order", used when the record's own label cannot be resolved. */
  noun: string;
  /** The module's approval row — the cycle (PRD #41 §52). */
  approvalId?: string;
  /**
   * The Approvals Center source that owns the cycle, where the module alone does
   * not say: Projects decides both a unit's publishing ("projects") and its sale
   * ("unit_sales") on the same record type (AUD-10 §4, A7).
   */
  providerKey?: string;
};

/** The Approvals Center provider that presents a module's approvals. */
const PROVIDER_FOR_MODULE: Partial<Record<ModuleKey, string>> = { contracts: "legal" };

function providerKeyFor(record: Pick<ApprovalRecord, "moduleKey" | "providerKey">): string {
  return record.providerKey ?? PROVIDER_FOR_MODULE[record.moduleKey] ?? record.moduleKey;
}

/** Conditions an open approval raises; a decision ends all of them at once (PRD #41 §227). */
const APPROVAL_CONDITIONS = ["PENDING_APPROVAL", "PROCUREMENT_ACTION_REQUIRED", "APPROVAL_OVERDUE"];

export async function resolveApprovalAttention(
  tx: Prisma.TransactionClient,
  companyId: string,
  record: { recordType: RecordType; recordId: string },
): Promise<void> {
  await resolveAttentionFor(tx, { companyId, conditionKeys: APPROVAL_CONDITIONS, entityType: record.recordType, entityId: record.recordId });
}

export async function notifyApprovalRequested(
  tx: Prisma.TransactionClient,
  context: UserContext,
  record: ApprovalRecord & {
    /** What deciding takes — the same permissions the approval service checks. */
    approvePermissions: Permission[];
    eventType?: typeof NotificationEvent.APPROVAL_REQUESTED | typeof NotificationEvent.PO_APPROVAL_REQUIRED;
    /** In a chain, the step now waiting (PRD #41 §21). */
    step?: { number: number; total: number; label: string };
    /** A step that belongs to named people rather than a permission. */
    recipientMemberIds?: string[];
    /** Never asked: the requester, and anybody who decided an earlier step. */
    excludeMemberIds?: string[];
    /** The original requester, when a later step is asked by whoever approved the one before. */
    submittedBy?: { memberId: string; name: string };
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
      submittedByName: record.submittedBy?.name ?? context.fullName,
      submittedByMemberId: record.submittedBy?.memberId ?? context.membershipId,
      approvePermissions: record.approvePermissions,
      ...(record.step ? { stepLabel: record.step.label, stepNumber: record.step.number, totalSteps: record.step.total } : {}),
      ...(record.recipientMemberIds?.length ? { recipientMemberIds: record.recipientMemberIds } : {}),
      ...(record.excludeMemberIds?.length ? { excludeMemberIds: record.excludeMemberIds } : {}),
      // Which Center source the link opens, where the record type alone is ambiguous (AUD-10 A7).
      ...(record.providerKey ? { providerKey: record.providerKey } : {}),
    },
  });

  if (!record.approvalId) return;
  const later = record.step && record.step.number > 1;
  await recordUserAction(
    context,
    {
      actionKey: later ? AuditAction.APPROVAL_STEP_ASSIGNED : AuditAction.APPROVAL_REQUEST_CREATED,
      entity: { type: record.recordType, id: record.recordId, label: record.noun },
      after: {
        approvalId: record.approvalId,
        providerKey: providerKeyFor(record),
        sourceType: record.recordType,
        ...(later ? { step: record.step!.number, stepLabel: record.step!.label } : { steps: record.step?.total ?? 1 }),
      },
    },
    { tx },
  );
}

const OUTCOME_EVENT = {
  APPROVED: NotificationEvent.APPROVAL_APPROVED,
  REJECTED: NotificationEvent.APPROVAL_REJECTED,
  RETURNED: NotificationEvent.APPROVAL_RETURNED,
} as const;

const OUTCOME_AUDIT = {
  APPROVED: AuditAction.APPROVAL_APPROVED,
  REJECTED: AuditAction.APPROVAL_REJECTED,
  RETURNED: AuditAction.APPROVAL_RETURNED,
} as const;

export async function notifyApprovalDecided(
  tx: Prisma.TransactionClient,
  context: UserContext,
  record: ApprovalRecord & {
    decision: "APPROVED" | "REJECTED" | "RETURNED";
    note: string | null;
    submittedByMemberId: string;
    step?: number;
    onBehalfOfMemberId?: string | null;
  },
): Promise<void> {
  await enqueueNotificationEvent(tx, {
    companyId: context.companyId,
    eventType: OUTCOME_EVENT[record.decision],
    moduleKey: record.moduleKey,
    entityType: record.recordType,
    entityId: record.recordId,
    actorMemberId: context.membershipId,
    payload: {
      recordLabel: record.noun,
      decision: record.decision,
      reason: record.note,
      actorName: context.fullName,
      submittedByMemberId: record.submittedByMemberId,
    },
  });

  // The decision ends the condition for every approver at once (PRD #38 §85).
  await resolveApprovalAttention(tx, context.companyId, record);

  await recordUserAction(
    context,
    {
      actionKey: OUTCOME_AUDIT[record.decision],
      entity: { type: record.recordType, id: record.recordId, label: record.noun },
      after: {
        approvalId: record.approvalId ?? null,
        providerKey: providerKeyFor(record),
        sourceType: record.recordType,
        decision: record.decision,
        hasNote: Boolean(record.note?.trim()),
        ...(record.step ? { step: record.step } : {}),
        ...(record.onBehalfOfMemberId ? { onBehalfOfMemberId: record.onBehalfOfMemberId } : {}),
      },
      reason: record.decision === "APPROVED" ? null : record.note,
    },
    { tx },
  );
}

/** One step of a chain approved; the cycle carries on (PRD #41 §21, §53). */
export async function recordApprovalStepApproved(
  tx: Prisma.TransactionClient,
  context: UserContext,
  record: ApprovalRecord & { step: number; stepLabel: string; note: string | null; onBehalfOfMemberId: string | null },
): Promise<void> {
  await resolveApprovalAttention(tx, context.companyId, record);
  await recordUserAction(
    context,
    {
      actionKey: AuditAction.APPROVAL_STEP_APPROVED,
      entity: { type: record.recordType, id: record.recordId, label: record.noun },
      after: {
        approvalId: record.approvalId ?? null,
        providerKey: providerKeyFor(record),
        sourceType: record.recordType,
        step: record.step,
        stepLabel: record.stepLabel,
        hasNote: Boolean(record.note?.trim()),
        ...(record.onBehalfOfMemberId ? { onBehalfOfMemberId: record.onBehalfOfMemberId } : {}),
      },
    },
    { tx },
  );
}

/** A pending cycle withdrawn with its record (PRD #41 §50, §231). */
export async function recordApprovalCancelled(
  tx: Prisma.TransactionClient,
  context: UserContext,
  record: ApprovalRecord & { count: number },
): Promise<void> {
  if (record.count === 0) return;
  await resolveApprovalAttention(tx, context.companyId, record);
  await recordUserAction(
    context,
    {
      actionKey: AuditAction.APPROVAL_CANCELLED,
      entity: { type: record.recordType, id: record.recordId, label: record.noun },
      after: { providerKey: providerKeyFor(record), sourceType: record.recordType, count: record.count },
    },
    { tx },
  );
}
