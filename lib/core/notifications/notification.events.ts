import type { Prisma } from "@prisma/client";

import type { Permission } from "@/config/permissions";
import type { ModuleKey } from "@/config/modules";

/**
 * What NESTO notifies about (PRD #25 §26-§40, §180-§200).
 *
 * One definition per event type, in one place, because the two halves of a
 * notification have to agree: the producer says an event happened, and this
 * says who hears about it and what they must hold to be told. Splitting those
 * across modules is how a recipient list quietly outgrows the permission that
 * justified it.
 *
 * Each definition answers four questions:
 *
 *   - which module it belongs to, so a disabled module notifies nobody;
 *   - which permission a recipient must hold, re-checked at delivery;
 *   - who the candidate recipients are;
 *   - what the message says.
 *
 * The permission is a floor, not the whole rule. The dispatcher also drops the
 * actor — nobody needs telling about their own action (§39) — and re-checks
 * membership, so a person suspended between the event and its delivery hears
 * nothing.
 */

export type NotificationPriority = "LOW" | "NORMAL" | "HIGH" | "CRITICAL";

export type OutboxEvent = {
  id: string;
  companyId: string;
  eventType: string;
  moduleKey: string;
  entityType: string;
  entityId: string;
  actorMemberId: string | null;
  projectId: string | null;
  payloadJson: unknown;
};

export type NotificationEventDefinition = {
  eventType: string;
  moduleKey: ModuleKey;
  /** Every recipient must hold this before a row is written (PRD #25 §49). */
  permission: Permission;
  priority: NotificationPriority;
  /** Candidate recipients, before permission and membership are re-checked. */
  recipients(
    tx: Prisma.TransactionClient,
    event: OutboxEvent,
    payload: Record<string, unknown>,
  ): Promise<string[]>;
  title(payload: Record<string, unknown>): string;
  body?(payload: Record<string, unknown>): string | null;
};

/** Payload reader that never throws on a malformed row. */
function text(payload: Record<string, unknown>, key: string, fallback = ""): string {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

export const NotificationEvent = {
  TASK_ASSIGNED: "TASK_ASSIGNED",
  APPROVAL_REQUESTED: "APPROVAL_REQUESTED",
  APPROVAL_DECIDED: "APPROVAL_DECIDED",
  LEAVE_DECIDED: "LEAVE_DECIDED",
} as const;

const DEFINITIONS: NotificationEventDefinition[] = [
  /**
   * Somebody was given work (PRD #25 §30).
   *
   * One recipient: the assignee. `task.view` is the floor, and the dispatcher
   * drops the actor, so assigning a task to yourself notifies nobody.
   */
  {
    eventType: NotificationEvent.TASK_ASSIGNED,
    moduleKey: "tasks",
    permission: "task.view",
    priority: "NORMAL",
    async recipients(_tx, _event, payload) {
      const assignee = text(payload, "assigneeMemberId");
      return assignee ? [assignee] : [];
    },
    title: (payload) => `You were assigned “${text(payload, "title", "a task")}”`,
    body: (payload) => (payload.projectName ? `On ${text(payload, "projectName")}` : null),
  },

  /**
   * Something is waiting for a decision (PRD #25 §31).
   *
   * The candidates are everybody who could decide it. The dispatcher narrows
   * that to those who actually hold the approval permission for the module, so
   * a widening of this list cannot outrun the permission check.
   */
  {
    eventType: NotificationEvent.APPROVAL_REQUESTED,
    moduleKey: "finance",
    permission: "finance.approval.decide",
    priority: "HIGH",
    async recipients(tx, event) {
      const members = await tx.companyMember.findMany({
        where: { companyId: event.companyId, status: "ACTIVE" },
        select: { id: true },
      });
      return members.map((member) => member.id);
    },
    title: (payload) =>
      `${text(payload, "recordLabel", "A record")} needs your approval`,
    body: (payload) =>
      payload.submittedByName ? `Submitted by ${text(payload, "submittedByName")}` : null,
  },

  /**
   * A decision was made on something somebody submitted (PRD #25 §32).
   *
   * Back to the submitter alone. They are the person waiting, and they already
   * had access to submit it.
   */
  {
    eventType: NotificationEvent.APPROVAL_DECIDED,
    moduleKey: "finance",
    permission: "finance.dashboard.view",
    priority: "NORMAL",
    async recipients(_tx, _event, payload) {
      const submitter = text(payload, "submittedByMemberId");
      return submitter ? [submitter] : [];
    },
    title: (payload) =>
      `${text(payload, "recordLabel", "Your record")} was ${text(payload, "decision", "decided").toLowerCase()}`,
    body: (payload) => (payload.reason ? text(payload, "reason") : null),
  },

  /**
   * A leave request was approved or rejected (PRD #25 §33).
   *
   * The employee only. `hr.leave.view` is the floor: everybody who can hold a
   * leave request at all holds it, and scope — not this permission — is what
   * keeps one person's request out of another's list.
   */
  {
    eventType: NotificationEvent.LEAVE_DECIDED,
    moduleKey: "hr",
    permission: "hr.leave.view",
    priority: "NORMAL",
    async recipients(_tx, _event, payload) {
      const member = text(payload, "memberId");
      return member ? [member] : [];
    },
    title: (payload) => `Your leave request was ${text(payload, "decision", "decided").toLowerCase()}`,
    body: (payload) => (payload.reason ? text(payload, "reason") : null),
  },
];

const BY_TYPE = new Map(DEFINITIONS.map((definition) => [definition.eventType, definition]));

export function findNotificationEvent(eventType: string): NotificationEventDefinition | undefined {
  return BY_TYPE.get(eventType);
}

export function notificationEventDefinitions(): NotificationEventDefinition[] {
  return [...DEFINITIONS];
}
