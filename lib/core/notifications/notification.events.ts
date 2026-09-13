import type { Prisma } from "@prisma/client";

import { isPermission, type Permission } from "@/config/permissions";
import type { MailTemplateKey } from "@/lib/mail/mail.types";

/**
 * What NESTO notifies about (PRD #25 §26-§40, PRD #38 §74, §75, §158).
 *
 * One definition per event type, in one place, because the halves of a
 * notification have to agree: the producer says an event happened, and this
 * says who hears about it, how urgently, under which preference, and whether
 * it may also be emailed.
 *
 * Every definition answers:
 *
 *   - category      the preference it is governed by (PRD #38 §78)
 *   - priority      how it sorts and how loudly it shows
 *   - recipients    candidate members, resolved on the server from the event
 *                   and the database — never from a list the browser sent
 *                   (PRD #38 §76)
 *   - permission    an optional extra floor, beyond reading the record
 *   - title / body  what the notification says
 *   - dedupe        the key that makes a replayed event produce nothing new
 *                   (PRD #38 §77)
 *   - email         whether, and with which template, it may be emailed
 *   - mandatory     critical safety events a preference cannot silence in-app
 *
 * The access floor for every event is the record itself: the dispatcher builds
 * each candidate's context and reads the event's record through the record
 * registry, exactly as a page would. A notification is written only for a
 * member who could open the record at that moment (PRD #38 §82).
 */

export type NotificationPriority = "LOW" | "NORMAL" | "HIGH" | "CRITICAL";

export const NOTIFICATION_CATEGORIES = [
  "tasks",
  "mentions",
  "comments",
  "approvals",
  "documents",
  "qa_qc",
  "hse",
  "hr",
  "contracts",
  "procurement",
  "calendar",
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

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

export type Payload = Record<string, unknown>;

export type NotificationEventDefinition = {
  eventType: string;
  category: NotificationCategory;
  priority: NotificationPriority;
  /** Candidate recipients, before access and preferences are re-checked. */
  recipients(tx: Prisma.TransactionClient, event: OutboxEvent, payload: Payload): Promise<string[]>;
  /** Permissions every recipient must hold (all of them) as well as reading the record. */
  permission?(event: OutboxEvent, payload: Payload): Permission | Permission[] | null;
  title(payload: Payload): string;
  body?(payload: Payload): string | null;
  dedupe(event: OutboxEvent, memberId: string, payload: Payload): string;
  email?: { templateKey: MailTemplateKey; variables(payload: Payload, link: string): Record<string, string>; defaultOn: boolean };
  /** Cannot be switched off in-app by a preference (PRD #38 §78, §149). */
  mandatory?: boolean;
};

/** Payload reader that never throws on a malformed row. */
export function text(payload: Payload, key: string, fallback = ""): string {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function ids(payload: Payload, key: string): string[] {
  const value = payload[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

/** The record's own label when the dispatcher resolved one, else the producer's noun. */
function recordName(payload: Payload, fallback: string): string {
  return text(payload, "recordName") || text(payload, "recordLabel", fallback);
}

const perEvent = (event: OutboxEvent, memberId: string) => `${event.eventType}:${event.id}:${memberId}`;

async function watchers(tx: Prisma.TransactionClient, event: OutboxEvent): Promise<string[]> {
  const rows = await tx.subscription.findMany({
    where: {
      companyId: event.companyId,
      active: true,
      thread: { companyId: event.companyId, parentType: event.entityType, parentId: event.entityId },
    },
    select: { memberId: true },
  });
  return rows.map((row) => row.memberId);
}

async function activeMembers(tx: Prisma.TransactionClient, companyId: string): Promise<string[]> {
  const rows = await tx.companyMember.findMany({ where: { companyId, status: "ACTIVE" }, select: { id: true } });
  return rows.map((row) => row.id);
}

/** Who may decide an approval in each module — the permission, not a list of names. */
const APPROVER_PERMISSION: Record<string, Permission> = {
  finance: "finance.approval.decide",
  procurement: "procurement.approval.decide",
  contracts: "legal.approval.decide",
  qaqc: "qaqc.approval.decide",
  hse: "hse.approval.decide",
  sales: "sales.proposal.approve",
  hr: "hr.leave.approve",
};

export const NotificationEvent = {
  TASK_ASSIGNED: "TASK_ASSIGNED",
  TASK_STATUS_CHANGED: "TASK_STATUS_CHANGED",
  TASK_BLOCKED: "TASK_BLOCKED",
  TASK_COMPLETED: "TASK_COMPLETED",
  TASK_OVERDUE: "TASK_OVERDUE",
  COMMENT_MENTIONED: "COMMENT_MENTIONED",
  COMMENT_REPLY: "COMMENT_REPLY",
  COMMENT_ADDED: "COMMENT_ADDED",
  APPROVAL_REQUESTED: "APPROVAL_REQUESTED",
  APPROVAL_DECIDED: "APPROVAL_DECIDED",
  DOCUMENT_REVIEW_REQUESTED: "DOCUMENT_REVIEW_REQUESTED",
  DOCUMENT_APPROVED: "DOCUMENT_APPROVED",
  DOCUMENT_REJECTED: "DOCUMENT_REJECTED",
  DOCUMENT_SUPERSEDED: "DOCUMENT_SUPERSEDED",
  PO_APPROVAL_REQUIRED: "PO_APPROVAL_REQUIRED",
  GOODS_RECEIPT_RECORDED: "GOODS_RECEIPT_RECORDED",
  QA_INSPECTION_REQUIRED: "QA_INSPECTION_REQUIRED",
  QA_ACTION_ASSIGNED: "QA_ACTION_ASSIGNED",
  HSE_CRITICAL_RISK: "HSE_CRITICAL_RISK",
  HSE_ACTION_ASSIGNED: "HSE_ACTION_ASSIGNED",
  CONTRACT_OBLIGATION_DUE: "CONTRACT_OBLIGATION_DUE",
  LEAVE_DECIDED: "LEAVE_DECIDED",
  CALENDAR_EVENT_CREATED: "CALENDAR_EVENT_CREATED",
  CALENDAR_EVENT_UPDATED: "CALENDAR_EVENT_UPDATED",
  CALENDAR_EVENT_CANCELLED: "CALENDAR_EVENT_CANCELLED",
  CALENDAR_PARTICIPANT_ADDED: "CALENDAR_PARTICIPANT_ADDED",
  CALENDAR_REMINDER: "CALENDAR_REMINDER",
} as const;

const DEFINITIONS: NotificationEventDefinition[] = [
  /* Tasks ----------------------------------------------------------------- */
  {
    eventType: NotificationEvent.TASK_ASSIGNED,
    category: "tasks",
    priority: "NORMAL",
    async recipients(_tx, _event, payload) {
      const assignee = text(payload, "assigneeMemberId");
      return assignee ? [assignee] : [];
    },
    title: (payload) => `You were assigned “${text(payload, "title", "a task")}”`,
    body: (payload) => (payload.projectName ? `On ${text(payload, "projectName")}` : null),
    // One per assignment: reassigning the same person later is a new assignment.
    dedupe: (event, memberId, payload) =>
      `TASK_ASSIGNED:${event.entityId}:${memberId}:${text(payload, "assignmentVersion", event.id)}`,
  },
  {
    eventType: NotificationEvent.TASK_STATUS_CHANGED,
    category: "tasks",
    priority: "LOW",
    async recipients(tx, event, payload) {
      return [text(payload, "creatorMemberId"), text(payload, "assigneeMemberId"), ...(await watchers(tx, event))];
    },
    title: (payload) => `“${text(payload, "title", "A task")}” moved to ${text(payload, "statusLabel", "a new status")}`,
    body: (payload) => (payload.actorName ? `By ${text(payload, "actorName")}` : null),
    dedupe: perEvent,
  },
  {
    eventType: NotificationEvent.TASK_BLOCKED,
    category: "tasks",
    priority: "HIGH",
    async recipients(tx, event, payload) {
      return [text(payload, "creatorMemberId"), text(payload, "assigneeMemberId"), text(payload, "projectManagerMemberId"), ...(await watchers(tx, event))];
    },
    title: (payload) => `“${text(payload, "title", "A task")}” is blocked`,
    body: (payload) => (payload.reason ? text(payload, "reason").slice(0, 200) : null),
    dedupe: perEvent,
  },
  {
    eventType: NotificationEvent.TASK_COMPLETED,
    category: "tasks",
    priority: "NORMAL",
    async recipients(tx, event, payload) {
      return [text(payload, "creatorMemberId"), text(payload, "assigneeMemberId"), ...(await watchers(tx, event))];
    },
    title: (payload) => `“${text(payload, "title", "A task")}” was completed`,
    body: (payload) => (payload.actorName ? `By ${text(payload, "actorName")}` : null),
    dedupe: perEvent,
  },
  {
    eventType: NotificationEvent.TASK_OVERDUE,
    category: "tasks",
    priority: "HIGH",
    async recipients(_tx, _event, payload) {
      return [text(payload, "assigneeMemberId")];
    },
    title: (payload) => `“${text(payload, "title", "A task")}” is overdue`,
    body: (payload) => (payload.dueDate ? `It was due ${text(payload, "dueDate")}` : null),
    // Once per due date: a reminder a day, not one per scheduler run.
    dedupe: (event, memberId, payload) => `TASK_OVERDUE:${event.entityId}:${memberId}:${text(payload, "dueDate")}`,
  },

  /* Collaboration --------------------------------------------------------- */
  {
    eventType: NotificationEvent.COMMENT_MENTIONED,
    category: "mentions",
    priority: "NORMAL",
    // Validated when the comment was written, and re-checked here: a member
    // who lost access in between hears nothing (PRD #38 §31).
    async recipients(_tx, _event, payload) {
      return ids(payload, "mentionedMemberIds");
    },
    title: (payload) => `${text(payload, "actorName", "Someone")} mentioned you on ${text(payload, "recordLabel", "a record")}`,
    body: (payload) => text(payload, "preview") || null,
    dedupe: (_event, memberId, payload) => `COMMENT_MENTIONED:${text(payload, "commentId")}:${memberId}`,
    email: {
      templateKey: "collaboration.mention",
      defaultOn: false,
      // The comment text stays in NESTO; the email carries only who and where (PRD #38 §162).
      variables: (payload, link) => ({
        actorName: text(payload, "actorName", "Someone"),
        recordLabel: text(payload, "recordLabel", "a record"),
        link,
      }),
    },
  },
  {
    eventType: NotificationEvent.COMMENT_REPLY,
    category: "comments",
    priority: "NORMAL",
    async recipients(_tx, _event, payload) {
      return [text(payload, "replyToAuthorMemberId")];
    },
    title: (payload) => `${text(payload, "actorName", "Someone")} replied to you on ${text(payload, "recordLabel", "a record")}`,
    body: (payload) => text(payload, "preview") || null,
    dedupe: (_event, memberId, payload) => `COMMENT_REPLY:${text(payload, "commentId")}:${memberId}`,
  },
  {
    eventType: NotificationEvent.COMMENT_ADDED,
    category: "comments",
    priority: "LOW",
    async recipients(tx, event, payload) {
      const excluded = new Set(ids(payload, "excludeMemberIds"));
      return (await watchers(tx, event)).filter((memberId) => !excluded.has(memberId));
    },
    title: (payload) => `${text(payload, "actorName", "Someone")} commented on ${text(payload, "recordLabel", "a record you watch")}`,
    body: (payload) => text(payload, "preview") || null,
    dedupe: (_event, memberId, payload) => `COMMENT_ADDED:${text(payload, "commentId")}:${memberId}`,
  },

  /* Approvals ------------------------------------------------------------- */
  {
    eventType: NotificationEvent.APPROVAL_REQUESTED,
    category: "approvals",
    priority: "HIGH",
    // Everybody is a candidate; the approver permission for the record's
    // module decides who is actually told.
    async recipients(tx, event) {
      return activeMembers(tx, event.companyId);
    },
    // The producer names what deciding this record type takes — the same
    // permissions its approval service checks. Without them, the module's
    // approver permission is the floor.
    permission: (event, payload) => {
      const exact = ids(payload, "approvePermissions").filter(isPermission);
      return exact.length > 0 ? exact : (APPROVER_PERMISSION[event.moduleKey] ?? null);
    },
    title: (payload) => `${recordName(payload, "A record")} needs your approval`,
    body: (payload) => (payload.submittedByName ? `Submitted by ${text(payload, "submittedByName")}` : null),
    dedupe: perEvent,
    email: {
      templateKey: "approval.requested",
      defaultOn: false,
      variables: (payload, link) => ({ title: `${recordName(payload, "A record")} needs your approval`, link }),
    },
  },
  {
    eventType: NotificationEvent.APPROVAL_DECIDED,
    category: "approvals",
    priority: "NORMAL",
    async recipients(_tx, _event, payload) {
      return [text(payload, "submittedByMemberId")];
    },
    title: (payload) => `${recordName(payload, "Your record")} was ${text(payload, "decision", "decided").toLowerCase()}`,
    body: (payload) => (payload.reason ? text(payload, "reason") : null),
    dedupe: perEvent,
  },

  /* Documents ------------------------------------------------------------- */
  {
    eventType: NotificationEvent.DOCUMENT_REVIEW_REQUESTED,
    category: "documents",
    priority: "HIGH",
    async recipients(_tx, _event, payload) {
      return [text(payload, "reviewerMemberId")];
    },
    title: (payload) => `${text(payload, "requesterName", "Someone")} asked you to review “${text(payload, "documentName", "a document")}”`,
    body: (payload) => (payload.versionNumber ? `Version ${String(payload.versionNumber)}` : null),
    dedupe: (_event, memberId, payload) => `DOCUMENT_REVIEW_REQUESTED:${text(payload, "reviewId")}:${memberId}`,
    email: {
      templateKey: "document.review_requested",
      defaultOn: false,
      variables: (payload, link) => ({
        requesterName: text(payload, "requesterName", "Someone"),
        documentName: text(payload, "documentName", "a document"),
        link,
      }),
    },
  },
  {
    eventType: NotificationEvent.DOCUMENT_APPROVED,
    category: "documents",
    priority: "NORMAL",
    async recipients(_tx, _event, payload) {
      return [text(payload, "requestedByMemberId"), text(payload, "uploadedByMemberId")];
    },
    title: (payload) => `“${text(payload, "documentName", "A document")}” was approved`,
    body: (payload) => (payload.reviewerName ? `By ${text(payload, "reviewerName")}` : null),
    dedupe: perEvent,
  },
  {
    eventType: NotificationEvent.DOCUMENT_REJECTED,
    category: "documents",
    priority: "HIGH",
    async recipients(_tx, _event, payload) {
      return [text(payload, "requestedByMemberId"), text(payload, "uploadedByMemberId")];
    },
    title: (payload) => `“${text(payload, "documentName", "A document")}” was rejected`,
    body: (payload) => (payload.note ? text(payload, "note").slice(0, 200) : null),
    dedupe: perEvent,
  },
  {
    eventType: NotificationEvent.DOCUMENT_SUPERSEDED,
    category: "documents",
    priority: "LOW",
    async recipients(tx, event) {
      return watchers(tx, event);
    },
    title: (payload) => `A newer approved version of “${text(payload, "documentName", "a document")}” replaced version ${String(payload.supersededVersionNumber ?? "")}`.trim(),
    dedupe: perEvent,
  },

  /* Procurement ----------------------------------------------------------- */
  {
    eventType: NotificationEvent.PO_APPROVAL_REQUIRED,
    category: "procurement",
    priority: "HIGH",
    async recipients(tx, event) {
      return activeMembers(tx, event.companyId);
    },
    permission: () => "procurement.order.approve",
    title: (payload) => `${recordName(payload, "A purchase order")} needs approval`,
    body: (payload) => (payload.submittedByName ? `Submitted by ${text(payload, "submittedByName")}` : null),
    dedupe: perEvent,
  },
  {
    eventType: NotificationEvent.GOODS_RECEIPT_RECORDED,
    category: "procurement",
    priority: "NORMAL",
    async recipients(_tx, _event, payload) {
      return [text(payload, "orderCreatedByMemberId"), text(payload, "requestOwnerMemberId"), text(payload, "requestedByMemberId")];
    },
    title: (payload) => `Goods received against ${text(payload, "poNumber", "a purchase order")}`,
    body: (payload) => (payload.receiptNumber ? `Receipt ${text(payload, "receiptNumber")}` : null),
    dedupe: perEvent,
  },

  /* QA/QC ----------------------------------------------------------------- */
  {
    eventType: NotificationEvent.QA_INSPECTION_REQUIRED,
    category: "qa_qc",
    priority: "HIGH",
    async recipients(_tx, _event, payload) {
      return [text(payload, "inspectorMemberId")];
    },
    title: (payload) => `Inspection ${text(payload, "inspectionNumber")} is assigned to you`,
    body: (payload) => (payload.scheduledDate ? `Scheduled for ${text(payload, "scheduledDate")}` : null),
    dedupe: (event, memberId) => `QA_INSPECTION_REQUIRED:${event.entityId}:${memberId}`,
  },
  {
    eventType: NotificationEvent.QA_ACTION_ASSIGNED,
    category: "qa_qc",
    priority: "NORMAL",
    async recipients(_tx, _event, payload) {
      return [text(payload, "assigneeMemberId")];
    },
    title: (payload) => `Corrective action ${text(payload, "actionNumber")} is assigned to you`,
    body: (payload) => text(payload, "title") || null,
    dedupe: (event, memberId) => `QA_ACTION_ASSIGNED:${event.entityId}:${memberId}`,
  },

  /* HSE ------------------------------------------------------------------- */
  {
    eventType: NotificationEvent.HSE_CRITICAL_RISK,
    category: "hse",
    priority: "CRITICAL",
    mandatory: true,
    // Everybody responsible for safety on it: HSE managers by permission, and
    // the project's manager. Each still has to be able to open the record.
    async recipients(tx, event, payload) {
      return [...(await activeMembers(tx, event.companyId)), text(payload, "projectManagerMemberId")];
    },
    permission: () => "hse.hazard.view",
    title: (payload) => `Critical safety alert: ${recordName(payload, "a new HSE record")}`,
    body: (payload) => (payload.projectName ? `On ${text(payload, "projectName")}` : null),
    dedupe: (event, memberId) => `HSE_CRITICAL_RISK:${event.entityType}:${event.entityId}:${memberId}`,
    email: {
      templateKey: "hse.critical",
      defaultOn: true,
      variables: (payload, link) => ({ title: text(payload, "recordLabel", "A critical HSE record"), link }),
    },
  },
  {
    eventType: NotificationEvent.HSE_ACTION_ASSIGNED,
    category: "hse",
    priority: "HIGH",
    async recipients(_tx, _event, payload) {
      return [text(payload, "assigneeMemberId")];
    },
    title: (payload) => `HSE action ${text(payload, "actionNumber")} is assigned to you`,
    body: (payload) => text(payload, "title") || null,
    dedupe: (event, memberId, payload) =>
      `HSE_ACTION_ASSIGNED:${event.entityId}:${memberId}:${text(payload, "assignmentVersion", event.id)}`,
  },

  /* Contracts ------------------------------------------------------------- */
  {
    eventType: NotificationEvent.CONTRACT_OBLIGATION_DUE,
    category: "contracts",
    priority: "HIGH",
    async recipients(_tx, _event, payload) {
      return [text(payload, "responsibleMemberId"), text(payload, "contractOwnerMemberId")];
    },
    title: (payload) => `Obligation due ${text(payload, "dueDate", "soon")}: ${text(payload, "title", "a contract obligation")}`,
    body: (payload) => text(payload, "contractLabel") || null,
    dedupe: (event, memberId, payload) => `CONTRACT_OBLIGATION_DUE:${event.entityId}:${memberId}:${text(payload, "dueDate")}`,
  },

  /* HR -------------------------------------------------------------------- */
  {
    eventType: NotificationEvent.LEAVE_DECIDED,
    category: "hr",
    priority: "NORMAL",
    async recipients(_tx, _event, payload) {
      return [text(payload, "memberId")];
    },
    title: (payload) => `Your leave request was ${text(payload, "decision", "decided").toLowerCase()}`,
    body: (payload) => (payload.reason ? text(payload, "reason") : null),
    dedupe: perEvent,
  },

  /* Calendar (PRD #39 §108) ----------------------------------------------- */
  {
    eventType: NotificationEvent.CALENDAR_EVENT_CREATED,
    category: "calendar",
    priority: "LOW",
    // Company holidays and closures are announced to the company; everything
    // else only to the people on it. Each recipient must still see the event.
    async recipients(tx, event, payload) {
      const announce = payload.announceToCompany === true;
      return announce ? activeMembers(tx, event.companyId) : ids(payload, "participantIds");
    },
    title: (payload) => `New on the calendar: ${recordName(payload, "an event")}`,
    body: (payload) => text(payload, "when") || null,
    dedupe: perEvent,
  },
  {
    eventType: NotificationEvent.CALENDAR_EVENT_UPDATED,
    category: "calendar",
    priority: "LOW",
    async recipients(_tx, _event, payload) {
      return ids(payload, "participantIds");
    },
    title: (payload) => `${recordName(payload, "An event")} was changed`,
    body: (payload) => text(payload, "when") || null,
    dedupe: perEvent,
  },
  {
    eventType: NotificationEvent.CALENDAR_EVENT_CANCELLED,
    category: "calendar",
    priority: "NORMAL",
    async recipients(_tx, _event, payload) {
      return ids(payload, "participantIds");
    },
    title: (payload) => `${recordName(payload, "An event")} was cancelled`,
    body: (payload) => text(payload, "when") || null,
    dedupe: perEvent,
  },
  {
    eventType: NotificationEvent.CALENDAR_PARTICIPANT_ADDED,
    category: "calendar",
    priority: "NORMAL",
    async recipients(_tx, _event, payload) {
      return ids(payload, "memberIds");
    },
    title: (payload) => `${text(payload, "actorName", "Someone")} added you to ${recordName(payload, "an event")}`,
    body: (payload) => text(payload, "when") || null,
    dedupe: (event, memberId) => `CALENDAR_PARTICIPANT_ADDED:${event.entityId}:${memberId}:${event.id}`,
  },
  {
    eventType: NotificationEvent.CALENDAR_REMINDER,
    category: "calendar",
    priority: "NORMAL",
    async recipients(_tx, _event, payload) {
      return [text(payload, "memberId")];
    },
    title: (payload) => `Reminder: ${recordName(payload, "an event")}`,
    body: (payload) => text(payload, "when") || null,
    // One per reminder per occurrence per person (PRD #39 §110).
    dedupe: (event, memberId, payload) =>
      `CALENDAR_REMINDER:${event.entityId}:${text(payload, "reminderId")}:${text(payload, "occurrenceStartsAt")}:${memberId}`,
    email: {
      templateKey: "calendar.reminder",
      defaultOn: false,
      variables: (payload, link) => ({ title: recordName(payload, "an event"), when: text(payload, "when", "soon"), link }),
    },
  },
];

function payload(event: OutboxEvent): Payload {
  return event.payloadJson && typeof event.payloadJson === "object" ? (event.payloadJson as Payload) : {};
}

const BY_TYPE = new Map<string, NotificationEventDefinition>();
for (const definition of DEFINITIONS) {
  if (BY_TYPE.has(definition.eventType)) throw new Error(`Duplicate notification event: ${definition.eventType}`);
  BY_TYPE.set(definition.eventType, definition);
}

export function findNotificationEvent(eventType: string): NotificationEventDefinition | undefined {
  return BY_TYPE.get(eventType);
}

export function notificationEventDefinitions(): NotificationEventDefinition[] {
  return [...DEFINITIONS];
}

export function readPayload(event: OutboxEvent): Payload {
  return payload(event);
}
