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
  "meetings",
  "timesheets",
  "daily_logs",
  "project_planning",
  "announcements",
  "contractors",
  "engineering",
  // Unit reservations and sales (E-05E §52).
  "sales",
  // Collecting a unit's sale: installments, payments, completion (E-05F §94).
  "finance",
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
  /**
   * A message out of a record's discussion. Reading the record is not enough to
   * hear it: the recipient must be able to take part in that discussion — the
   * registry's `collaboration.requires` for the record type — exactly as the
   * thread itself would let them in (PRD #38 §28, §30, PRD #47 §78).
   */
  discussion?: boolean;
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
  /** Superseded by the three outcome events below; kept so rows already in the outbox still dispatch. */
  APPROVAL_DECIDED: "APPROVAL_DECIDED",
  APPROVAL_APPROVED: "APPROVAL_APPROVED",
  APPROVAL_REJECTED: "APPROVAL_REJECTED",
  APPROVAL_RETURNED: "APPROVAL_RETURNED",
  APPROVAL_REASSIGNED: "APPROVAL_REASSIGNED",
  APPROVAL_DELEGATED: "APPROVAL_DELEGATED",
  APPROVAL_OVERDUE: "APPROVAL_OVERDUE",
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
  MEETING_INVITED: "MEETING_INVITED",
  MEETING_UPDATED: "MEETING_UPDATED",
  MEETING_CANCELLED: "MEETING_CANCELLED",
  MEETING_REMINDER: "MEETING_REMINDER",
  MEETING_RESPONSE_CHANGED: "MEETING_RESPONSE_CHANGED",
  MEETING_MINUTES_FINALIZED: "MEETING_MINUTES_FINALIZED",
  MEETING_ACTION_ASSIGNED: "MEETING_ACTION_ASSIGNED",
  MEETING_ACTION_COMPLETED: "MEETING_ACTION_COMPLETED",
  TIMESHEET_SUBMITTED: "TIMESHEET_SUBMITTED",
  TIMESHEET_APPROVAL_ASSIGNED: "TIMESHEET_APPROVAL_ASSIGNED",
  TIMESHEET_APPROVED: "TIMESHEET_APPROVED",
  TIMESHEET_RETURNED: "TIMESHEET_RETURNED",
  TIMESHEET_REJECTED: "TIMESHEET_REJECTED",
  TIMESHEET_REMINDER: "TIMESHEET_REMINDER",
  // Daily logs (PRD #43 §110, §111)
  DAILY_LOG_SUBMITTED: "DAILY_LOG_SUBMITTED",
  DAILY_LOG_RETURNED: "DAILY_LOG_RETURNED",
  DAILY_LOG_REVIEWED: "DAILY_LOG_REVIEWED",
  DAILY_LOG_LOCKED: "DAILY_LOG_LOCKED",
  DAILY_LOG_CORRECTION_ADDED: "DAILY_LOG_CORRECTION_ADDED",
  DAILY_LOG_MISSING_REMINDER: "DAILY_LOG_MISSING_REMINDER",
  // Project planning (PRD #44 §70, §164-§167, §250-§253)
  MILESTONE_ASSIGNED: "MILESTONE_ASSIGNED",
  MILESTONE_UPDATED: "MILESTONE_UPDATED",
  MILESTONE_DUE_SOON: "MILESTONE_DUE_SOON",
  MILESTONE_OVERDUE: "MILESTONE_OVERDUE",
  MILESTONE_COMPLETED: "MILESTONE_COMPLETED",
  MILESTONE_BLOCKER_ASSIGNED: "MILESTONE_BLOCKER_ASSIGNED",
  MILESTONE_BLOCKER_RESOLVED: "MILESTONE_BLOCKER_RESOLVED",
  BASELINE_CHANGED: "BASELINE_CHANGED",
  // Announcements (PRD #45 §44-§46, §249)
  ANNOUNCEMENT_PUBLISHED: "ANNOUNCEMENT_PUBLISHED",
  ANNOUNCEMENT_CRITICAL: "ANNOUNCEMENT_CRITICAL",
  ANNOUNCEMENT_ACK_REQUIRED: "ANNOUNCEMENT_ACK_REQUIRED",
  ANNOUNCEMENT_REMINDER: "ANNOUNCEMENT_REMINDER",
  // Contractors and engineering (PRD #46 §94, §106, §194-§196)
  CONTRACTOR_ASSIGNED_TO_PROJECT: "CONTRACTOR_ASSIGNED_TO_PROJECT",
  CONTRACTOR_STATUS_CHANGED: "CONTRACTOR_STATUS_CHANGED",
  CONTRACTOR_COMPLIANCE_EXPIRING: "CONTRACTOR_COMPLIANCE_EXPIRING",
  CONTRACTOR_COMPLIANCE_EXPIRED: "CONTRACTOR_COMPLIANCE_EXPIRED",
  UNIT_RESERVATION_EXPIRING: "UNIT_RESERVATION_EXPIRING",
  UNIT_RESERVATION_EXPIRED: "UNIT_RESERVATION_EXPIRED",
  UNIT_RESERVATION_RELEASED: "UNIT_RESERVATION_RELEASED",
  UNIT_MARKED_SOLD: "UNIT_MARKED_SOLD",
  UNIT_CONTRACT_REQUESTED: "UNIT_CONTRACT_REQUESTED",
  UNIT_CONTRACT_REQUEST_DECLINED: "UNIT_CONTRACT_REQUEST_DECLINED",
  UNIT_CONTRACT_SIGNED: "UNIT_CONTRACT_SIGNED",
  UNIT_CONTRACT_CANCELLED: "UNIT_CONTRACT_CANCELLED",
  UNIT_INSTALLMENT_DUE_SOON: "UNIT_INSTALLMENT_DUE_SOON",
  UNIT_INSTALLMENT_OVERDUE: "UNIT_INSTALLMENT_OVERDUE",
  UNIT_PAYMENT_RECEIVED: "UNIT_PAYMENT_RECEIVED",
  UNIT_FINANCIALLY_COMPLETE: "UNIT_FINANCIALLY_COMPLETE",
  RFI_OPENED: "RFI_OPENED",
  RFI_ASSIGNED: "RFI_ASSIGNED",
  RFI_DUE_SOON: "RFI_DUE_SOON",
  RFI_OVERDUE: "RFI_OVERDUE",
  RFI_ANSWERED: "RFI_ANSWERED",
  RFI_CLARIFICATION_REQUIRED: "RFI_CLARIFICATION_REQUIRED",
  RFI_CLOSED: "RFI_CLOSED",
  SUBMITTAL_SUBMITTED: "SUBMITTAL_SUBMITTED",
  SUBMITTAL_REVIEW_ASSIGNED: "SUBMITTAL_REVIEW_ASSIGNED",
  SUBMITTAL_DUE_SOON: "SUBMITTAL_DUE_SOON",
  SUBMITTAL_OVERDUE: "SUBMITTAL_OVERDUE",
  SUBMITTAL_APPROVED: "SUBMITTAL_APPROVED",
  SUBMITTAL_REVISION_REQUIRED: "SUBMITTAL_REVISION_REQUIRED",
  SUBMITTAL_REJECTED: "SUBMITTAL_REJECTED",
  ENGINEERING_DOCUMENT_SUBMITTED: "ENGINEERING_DOCUMENT_SUBMITTED",
  ENGINEERING_DOCUMENT_APPROVED: "ENGINEERING_DOCUMENT_APPROVED",
  ENGINEERING_DOCUMENT_REVISION_REQUIRED: "ENGINEERING_DOCUMENT_REVISION_REQUIRED",
  TRANSMITTAL_ISSUED: "TRANSMITTAL_ISSUED",
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
    discussion: true,
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
    discussion: true,
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
    discussion: true,
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
    // A chain step that belongs to a role or a person names its approvers;
    // otherwise everybody is a candidate and the approver permission for the
    // record's module decides who is actually told. The requester and anybody
    // who already decided a step of the cycle are never asked (PRD #41 §41).
    async recipients(tx, event, payload) {
      const excluded = new Set(ids(payload, "excludeMemberIds"));
      const named = ids(payload, "recipientMemberIds");
      const candidates = named.length > 0 ? named : await activeMembers(tx, event.companyId);
      return candidates.filter((memberId) => !excluded.has(memberId));
    },
    // The producer names what deciding this record type takes — the same
    // permissions its approval service checks. Without them, the module's
    // approver permission is the floor.
    permission: (event, payload) => {
      const exact = ids(payload, "approvePermissions").filter(isPermission);
      if (exact.length > 0) return exact;
      if (ids(payload, "recipientMemberIds").length > 0) return null;
      return APPROVER_PERMISSION[event.moduleKey] ?? null;
    },
    title: (payload) =>
      payload.stepLabel
        ? `${recordName(payload, "A record")} needs your ${text(payload, "stepLabel")} approval`
        : `${recordName(payload, "A record")} needs your approval`,
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
  // The outcome goes back to whoever asked (PRD #41 §40, §41).
  {
    eventType: NotificationEvent.APPROVAL_APPROVED,
    category: "approvals",
    priority: "NORMAL",
    async recipients(_tx, _event, payload) {
      return [text(payload, "submittedByMemberId")];
    },
    title: (payload) => `${recordName(payload, "Your request")} was approved`,
    body: (payload) => (payload.actorName ? `By ${text(payload, "actorName")}` : null),
    dedupe: perEvent,
  },
  {
    eventType: NotificationEvent.APPROVAL_REJECTED,
    category: "approvals",
    priority: "HIGH",
    async recipients(_tx, _event, payload) {
      return [text(payload, "submittedByMemberId")];
    },
    title: (payload) => `${recordName(payload, "Your request")} was rejected`,
    body: (payload) => (payload.reason ? text(payload, "reason").slice(0, 300) : null),
    dedupe: perEvent,
  },
  {
    eventType: NotificationEvent.APPROVAL_RETURNED,
    category: "approvals",
    priority: "HIGH",
    async recipients(_tx, _event, payload) {
      return [text(payload, "submittedByMemberId")];
    },
    title: (payload) => `${recordName(payload, "Your request")} was returned for revision`,
    body: (payload) => (payload.reason ? text(payload, "reason").slice(0, 300) : null),
    dedupe: perEvent,
  },
  {
    eventType: NotificationEvent.APPROVAL_REASSIGNED,
    category: "approvals",
    priority: "HIGH",
    // The new approver has something to decide; the old one no longer does (PRD #41 §237).
    async recipients(_tx, _event, payload) {
      return [text(payload, "toMemberId"), text(payload, "fromMemberId")];
    },
    title: (payload) => `${recordName(payload, "An approval")} was reassigned`,
    body: (payload) => (payload.toName ? `Now with ${text(payload, "toName")}` : null),
    dedupe: perEvent,
  },
  {
    eventType: NotificationEvent.APPROVAL_DELEGATED,
    category: "approvals",
    priority: "NORMAL",
    // The delegate is told; the delegator gets the confirmation when somebody
    // else set it up for them (PRD #41 §170).
    async recipients(_tx, _event, payload) {
      return [text(payload, "toMemberId"), text(payload, "fromMemberId")];
    },
    title: (payload) => `${text(payload, "fromName", "A colleague")} delegated approvals to ${text(payload, "toName", "a colleague")}`,
    body: (payload) => (payload.window ? text(payload, "window") : null),
    dedupe: perEvent,
  },
  {
    eventType: NotificationEvent.APPROVAL_OVERDUE,
    category: "approvals",
    priority: "HIGH",
    async recipients(tx, event, payload) {
      const excluded = new Set(ids(payload, "excludeMemberIds"));
      const named = ids(payload, "approverMemberIds");
      return (named.length > 0 ? named : await activeMembers(tx, event.companyId)).filter((memberId) => !excluded.has(memberId));
    },
    permission: (_event, payload) => {
      const exact = ids(payload, "approvePermissions").filter(isPermission);
      return exact.length > 0 ? exact : null;
    },
    title: (payload) => `${recordName(payload, "An approval")} is overdue for a decision`,
    body: (payload) => (payload.dueDate ? `It was due ${text(payload, "dueDate")}` : null),
    // Once a day per approval, not once per scheduler run.
    dedupe: (event, memberId, payload) => `APPROVAL_OVERDUE:${text(payload, "approvalKey", event.entityId)}:${memberId}:${text(payload, "day", text(payload, "dueDate"))}`,
  },

  /* Timesheets (PRD #42 §104-§106) --------------------------------------- */
  {
    eventType: NotificationEvent.TIMESHEET_SUBMITTED,
    category: "timesheets",
    priority: "NORMAL",
    async recipients(_tx, _event, payload) {
      return [text(payload, "approverMemberId")];
    },
    permission: () => "timesheet.approve",
    title: (payload) => `${text(payload, "memberName", "A colleague")} submitted their timesheet for ${text(payload, "weekLabel", "the week")}`,
    body: (payload) => (payload.totalLabel ? `${text(payload, "totalLabel")} logged` : null),
    dedupe: (event, memberId, payload) => `TIMESHEET_SUBMITTED:${event.entityId}:${text(payload, "submissionVersion")}:${memberId}`,
  },
  {
    eventType: NotificationEvent.TIMESHEET_APPROVAL_ASSIGNED,
    category: "timesheets",
    priority: "NORMAL",
    async recipients(_tx, _event, payload) {
      return [text(payload, "approverMemberId")];
    },
    permission: () => "timesheet.approve",
    title: () => "A timesheet was passed to you to approve",
    dedupe: perEvent,
  },
  {
    eventType: NotificationEvent.TIMESHEET_APPROVED,
    category: "timesheets",
    priority: "NORMAL",
    async recipients(_tx, _event, payload) {
      return [text(payload, "memberId")];
    },
    title: (payload) => `Your timesheet for ${text(payload, "weekLabel", "the week")} was approved`,
    body: (payload) => (payload.actorName ? `By ${text(payload, "actorName")}` : null),
    dedupe: perEvent,
  },
  {
    eventType: NotificationEvent.TIMESHEET_RETURNED,
    category: "timesheets",
    priority: "HIGH",
    async recipients(_tx, _event, payload) {
      return [text(payload, "memberId")];
    },
    title: (payload) =>
      payload.reopened
        ? `Your approved timesheet for ${text(payload, "weekLabel", "the week")} was reopened`
        : `Your timesheet for ${text(payload, "weekLabel", "the week")} was returned`,
    body: (payload) => (payload.reason ? text(payload, "reason").slice(0, 300) : null),
    dedupe: perEvent,
  },
  {
    eventType: NotificationEvent.TIMESHEET_REJECTED,
    category: "timesheets",
    priority: "HIGH",
    async recipients(_tx, _event, payload) {
      return [text(payload, "memberId")];
    },
    title: (payload) => `Your timesheet for ${text(payload, "weekLabel", "the week")} was rejected`,
    body: (payload) => (payload.reason ? text(payload, "reason").slice(0, 300) : null),
    dedupe: perEvent,
  },
  {
    eventType: NotificationEvent.TIMESHEET_REMINDER,
    category: "timesheets",
    priority: "NORMAL",
    async recipients(_tx, _event, payload) {
      return [text(payload, "memberId")];
    },
    title: (payload) => `Your timesheet for ${text(payload, "weekLabel", "last week")} is due`,
    body: (payload) => (payload.deadlineLabel ? `Due ${text(payload, "deadlineLabel")}` : null),
    // Once per week per person, however often the scheduler runs (§216).
    dedupe: (event, memberId) => `TIMESHEET_REMINDER:${event.entityId}:${memberId}`,
  },

  /* Daily logs ------------------------------------------------------------ */
  {
    eventType: NotificationEvent.DAILY_LOG_SUBMITTED,
    category: "daily_logs",
    priority: "NORMAL",
    async recipients(_tx, _event, payload) {
      return [text(payload, "reviewerMemberId")];
    },
    permission: () => "daily_log.review",
    title: (payload) => `${text(payload, "actorName", "Someone")} submitted the daily log for ${text(payload, "projectName", "a project")}, ${text(payload, "dateLabel", "a site day")}`,
    body: () => "Waiting for your review",
    dedupe: (event, memberId, payload) => `DAILY_LOG_SUBMITTED:${event.entityId}:${text(payload, "submissionCount")}:${memberId}`,
  },
  {
    eventType: NotificationEvent.DAILY_LOG_RETURNED,
    category: "daily_logs",
    priority: "HIGH",
    async recipients(_tx, _event, payload) {
      return ids(payload, "memberIds");
    },
    title: (payload) => `The daily log for ${text(payload, "projectName", "a project")}, ${text(payload, "dateLabel", "a site day")} needs correcting`,
    body: (payload) => (payload.reason ? text(payload, "reason").slice(0, 300) : null),
    dedupe: perEvent,
  },
  {
    eventType: NotificationEvent.DAILY_LOG_REVIEWED,
    category: "daily_logs",
    priority: "NORMAL",
    async recipients(_tx, _event, payload) {
      return ids(payload, "memberIds");
    },
    title: (payload) => `The daily log for ${text(payload, "projectName", "a project")}, ${text(payload, "dateLabel", "a site day")} was reviewed`,
    body: (payload) => (payload.actorName ? `By ${text(payload, "actorName")}` : null),
    dedupe: perEvent,
  },
  {
    eventType: NotificationEvent.DAILY_LOG_LOCKED,
    category: "daily_logs",
    priority: "LOW",
    async recipients(_tx, _event, payload) {
      return ids(payload, "memberIds");
    },
    title: (payload) => `The daily log for ${text(payload, "projectName", "a project")}, ${text(payload, "dateLabel", "a site day")} is locked as the record`,
    dedupe: perEvent,
  },
  {
    eventType: NotificationEvent.DAILY_LOG_CORRECTION_ADDED,
    category: "daily_logs",
    priority: "NORMAL",
    async recipients(_tx, _event, payload) {
      return ids(payload, "memberIds");
    },
    title: (payload) => `An official correction was added to the daily log for ${text(payload, "projectName", "a project")}, ${text(payload, "dateLabel", "a site day")}`,
    body: (payload) => (payload.reason ? text(payload, "reason").slice(0, 300) : null),
    dedupe: perEvent,
  },
  {
    // About the project: there is no log yet to point at.
    eventType: NotificationEvent.DAILY_LOG_MISSING_REMINDER,
    category: "daily_logs",
    priority: "NORMAL",
    async recipients(_tx, _event, payload) {
      return ids(payload, "memberIds");
    },
    permission: () => "daily_log.create",
    title: (payload) => `No daily log yet for ${text(payload, "projectName", "a project")}, ${text(payload, "dateLabel", "the last working day")}`,
    body: () => "Logs are required for this project's working days.",
    dedupe: (event, memberId, payload) => `DAILY_LOG_MISSING_REMINDER:${event.entityId}:${text(payload, "workDate")}:${memberId}`,
  },

  /* Project planning ------------------------------------------------------ */
  {
    eventType: NotificationEvent.MILESTONE_ASSIGNED,
    category: "project_planning",
    priority: "NORMAL",
    async recipients(_tx, _event, payload) {
      return ids(payload, "memberIds");
    },
    permission: () => "project_planning.view",
    title: (payload) => `You own the milestone “${text(payload, "milestoneName", "a milestone")}”`,
    body: (payload) => `On ${text(payload, "projectName", "a project")}`,
    // One per assignment: being given the same milestone again later is a new assignment.
    dedupe: (event, memberId, payload) => `MILESTONE_ASSIGNED:${event.entityId}:${memberId}:${text(payload, "assignment", event.id)}`,
  },
  {
    // A moved forecast, or a milestone now at risk, delayed, on hold, cancelled or reopened — never a progress nudge (§210).
    eventType: NotificationEvent.MILESTONE_UPDATED,
    category: "project_planning",
    priority: "LOW",
    async recipients(_tx, _event, payload) {
      return ids(payload, "memberIds");
    },
    permission: () => "project_planning.view",
    title: (payload) => `“${text(payload, "milestoneName", "A milestone")}” on ${text(payload, "projectName", "a project")} changed`,
    body: (payload) => [text(payload, "change"), payload.actorName ? `by ${text(payload, "actorName")}` : ""].filter(Boolean).join(" ") || null,
    dedupe: perEvent,
  },
  {
    eventType: NotificationEvent.MILESTONE_DUE_SOON,
    category: "project_planning",
    priority: "NORMAL",
    async recipients(_tx, _event, payload) {
      return ids(payload, "memberIds");
    },
    permission: () => "project_planning.view",
    title: (payload) => `“${text(payload, "milestoneName", "A milestone")}” is due ${text(payload, "dateLabel", "soon")}`,
    body: (payload) => `On ${text(payload, "projectName", "a project")}`,
    dedupe: (event, memberId, payload) => `MILESTONE_DUE_SOON:${event.entityId}:${text(payload, "targetDate")}:${memberId}`,
  },
  {
    eventType: NotificationEvent.MILESTONE_OVERDUE,
    category: "project_planning",
    priority: "HIGH",
    async recipients(_tx, _event, payload) {
      return ids(payload, "memberIds");
    },
    permission: () => "project_planning.view",
    title: (payload) => `“${text(payload, "milestoneName", "A milestone")}” is overdue`,
    body: (payload) => `Due ${text(payload, "dateLabel", "earlier")} on ${text(payload, "projectName", "a project")}`,
    dedupe: (event, memberId, payload) => `MILESTONE_OVERDUE:${event.entityId}:${text(payload, "targetDate")}:${memberId}`,
  },
  {
    eventType: NotificationEvent.MILESTONE_COMPLETED,
    category: "project_planning",
    priority: "NORMAL",
    async recipients(_tx, _event, payload) {
      return ids(payload, "memberIds");
    },
    permission: () => "project_planning.view",
    title: (payload) => `“${text(payload, "milestoneName", "A milestone")}” was completed`,
    body: (payload) => `On ${text(payload, "projectName", "a project")}, ${text(payload, "dateLabel", "today")}`,
    dedupe: perEvent,
  },
  {
    eventType: NotificationEvent.MILESTONE_BLOCKER_ASSIGNED,
    category: "project_planning",
    priority: "HIGH",
    async recipients(_tx, _event, payload) {
      return ids(payload, "memberIds");
    },
    permission: () => "project_planning.view",
    title: (payload) => `You own a blocker on “${text(payload, "milestoneName", "a milestone")}”`,
    body: (payload) => text(payload, "blockerTitle").slice(0, 200) || null,
    dedupe: (event, memberId, payload) => `MILESTONE_BLOCKER_ASSIGNED:${text(payload, "blockerId", event.id)}:${memberId}:${event.id}`,
  },
  {
    eventType: NotificationEvent.MILESTONE_BLOCKER_RESOLVED,
    category: "project_planning",
    priority: "LOW",
    async recipients(_tx, _event, payload) {
      return ids(payload, "memberIds");
    },
    permission: () => "project_planning.view",
    title: (payload) => `A blocker on “${text(payload, "milestoneName", "a milestone")}” was resolved`,
    body: (payload) => text(payload, "blockerTitle").slice(0, 200) || null,
    dedupe: perEvent,
  },
  {
    eventType: NotificationEvent.BASELINE_CHANGED,
    category: "project_planning",
    priority: "NORMAL",
    async recipients(_tx, _event, payload) {
      return ids(payload, "memberIds");
    },
    permission: () => "project_planning.view",
    title: (payload) => `The baseline of “${text(payload, "milestoneName", "a milestone")}” on ${text(payload, "projectName", "a project")} moved`,
    body: (payload) => [text(payload, "change"), text(payload, "reason").slice(0, 200)].filter(Boolean).join(" — ") || null,
    dedupe: perEvent,
  },

  /* Announcements --------------------------------------------------------- */
  {
    // An important announcement — or an ordinary one when the company asks for it (§45).
    eventType: NotificationEvent.ANNOUNCEMENT_PUBLISHED,
    category: "announcements",
    priority: "NORMAL",
    async recipients(_tx, _event, payload) {
      return ids(payload, "memberIds");
    },
    title: (payload) => `Announcement: ${text(payload, "title", "a new announcement")}`,
    body: (payload) => text(payload, "excerpt") || null,
    dedupe: (event, memberId) => `ANNOUNCEMENT_PUBLISHED:${event.entityId}:${memberId}`,
  },
  {
    // Critical notices reach everyone addressed in-app whatever their preferences, and by email by company policy (§27, §45, §249).
    eventType: NotificationEvent.ANNOUNCEMENT_CRITICAL,
    category: "announcements",
    priority: "CRITICAL",
    mandatory: true,
    async recipients(_tx, _event, payload) {
      return ids(payload, "memberIds");
    },
    title: (payload) => `Critical announcement: ${text(payload, "title", "read now")}`,
    body: (payload) => (payload.requiresAcknowledgment ? "Please read it and confirm you have." : text(payload, "excerpt") || null),
    dedupe: (event, memberId) => `ANNOUNCEMENT_CRITICAL:${event.entityId}:${memberId}`,
    email: {
      templateKey: "announcement.critical",
      defaultOn: true,
      variables: (payload, link) => ({ title: text(payload, "title", "A critical announcement"), link }),
    },
  },
  {
    eventType: NotificationEvent.ANNOUNCEMENT_ACK_REQUIRED,
    category: "announcements",
    priority: "HIGH",
    async recipients(_tx, _event, payload) {
      return ids(payload, "memberIds");
    },
    title: (payload) => `Please read and acknowledge: ${text(payload, "title", "an announcement")}`,
    body: (payload) => text(payload, "excerpt") || null,
    dedupe: (event, memberId) => `ANNOUNCEMENT_ACK_REQUIRED:${event.entityId}:${memberId}`,
  },
  {
    // Throttled by the job: one reminder round every few days, to those who have not acknowledged (§46).
    eventType: NotificationEvent.ANNOUNCEMENT_REMINDER,
    category: "announcements",
    priority: "NORMAL",
    async recipients(_tx, _event, payload) {
      return ids(payload, "memberIds");
    },
    title: (payload) => `Reminder: acknowledge “${text(payload, "title", "an announcement")}”`,
    body: () => "It is still waiting for your confirmation.",
    dedupe: (event, memberId, payload) => `ANNOUNCEMENT_REMINDER:${event.entityId}:${text(payload, "round")}:${memberId}`,
  },

  /* Contractors and engineering (PRD #46 §94, §106, §194-§196) ------------- */
  {
    eventType: NotificationEvent.CONTRACTOR_ASSIGNED_TO_PROJECT,
    category: "contractors",
    priority: "NORMAL",
    async recipients(_tx, _event, payload) {
      return ids(payload, "memberIds");
    },
    permission: () => "project_contractor.view",
    title: (payload) => `${text(payload, "contractorName", "A contractor")} was assigned to ${text(payload, "projectName", "a project")}`,
    body: (payload) => text(payload, "scope") || null,
    dedupe: perEvent,
  },
  {
    eventType: NotificationEvent.CONTRACTOR_STATUS_CHANGED,
    category: "contractors",
    priority: "NORMAL",
    async recipients(_tx, _event, payload) {
      return ids(payload, "memberIds");
    },
    permission: () => "contractor.view",
    title: (payload) => `${text(payload, "contractorName", "A contractor")} is now ${text(payload, "statusLabel", "changed")}`,
    body: (payload) => text(payload, "reason") ? "A reason was recorded on the contractor." : null,
    dedupe: (event, memberId, payload) => `CONTRACTOR_STATUS_CHANGED:${event.entityId}:${text(payload, "status", event.id)}:${text(payload, "changedAt", event.id)}:${memberId}`,
  },
  {
    // One per item per expiry date: renewing the certificate starts a new one (§44, §196).
    eventType: NotificationEvent.CONTRACTOR_COMPLIANCE_EXPIRING,
    category: "contractors",
    priority: "HIGH",
    async recipients(_tx, _event, payload) {
      return ids(payload, "memberIds");
    },
    permission: () => "contractor_compliance.view",
    title: (payload) => `${text(payload, "title", "A compliance item")} for ${text(payload, "contractorName", "a contractor")} expires ${text(payload, "dateLabel", "soon")}`,
    body: (payload) => text(payload, "typeLabel") || null,
    dedupe: (event, memberId, payload) => `CONTRACTOR_COMPLIANCE_EXPIRING:${event.entityId}:${text(payload, "expiresAt", event.id)}:${memberId}`,
  },
  {
    eventType: NotificationEvent.CONTRACTOR_COMPLIANCE_EXPIRED,
    category: "contractors",
    priority: "HIGH",
    async recipients(_tx, _event, payload) {
      return ids(payload, "memberIds");
    },
    permission: () => "contractor_compliance.view",
    title: (payload) => `${text(payload, "title", "A compliance item")} for ${text(payload, "contractorName", "a contractor")} has expired`,
    body: (payload) => (payload.dateLabel ? `Expired ${text(payload, "dateLabel")}` : null),
    dedupe: (event, memberId, payload) => `CONTRACTOR_COMPLIANCE_EXPIRED:${event.entityId}:${text(payload, "expiresAt", event.id)}:${memberId}`,
  },
  {
    eventType: NotificationEvent.RFI_OPENED,
    category: "engineering",
    priority: "NORMAL",
    async recipients(_tx, _event, payload) {
      return ids(payload, "memberIds");
    },
    permission: () => "rfi.view",
    title: (payload) => `RFI ${text(payload, "number")} opened: ${text(payload, "subject", "a request for information")}`,
    body: (payload) => text(payload, "projectName") || null,
    dedupe: perEvent,
  },
  {
    eventType: NotificationEvent.RFI_ASSIGNED,
    category: "engineering",
    priority: "NORMAL",
    async recipients(_tx, _event, payload) {
      return ids(payload, "memberIds");
    },
    permission: () => "rfi.view",
    title: (payload) => `RFI ${text(payload, "number")} is waiting for your response`,
    body: (payload) => [text(payload, "subject"), payload.dateLabel ? `due ${text(payload, "dateLabel")}` : ""].filter(Boolean).join(" · ") || null,
    // One per assignment: being given the same RFI again later is a new assignment.
    dedupe: (event, memberId, payload) => `RFI_ASSIGNED:${event.entityId}:${text(payload, "assignment", event.id)}:${memberId}`,
  },
  {
    eventType: NotificationEvent.RFI_DUE_SOON,
    category: "engineering",
    priority: "NORMAL",
    async recipients(_tx, _event, payload) {
      return ids(payload, "memberIds");
    },
    permission: () => "rfi.view",
    title: (payload) => `RFI ${text(payload, "number")} is due ${text(payload, "dateLabel", "soon")}`,
    body: (payload) => text(payload, "subject") || null,
    dedupe: (event, memberId, payload) => `RFI_DUE_SOON:${event.entityId}:${text(payload, "dueDate", event.id)}:${memberId}`,
  },
  {
    eventType: NotificationEvent.RFI_OVERDUE,
    category: "engineering",
    priority: "HIGH",
    async recipients(_tx, _event, payload) {
      return ids(payload, "memberIds");
    },
    permission: () => "rfi.view",
    title: (payload) => `RFI ${text(payload, "number")} is overdue`,
    body: (payload) => [text(payload, "subject"), payload.dateLabel ? `was due ${text(payload, "dateLabel")}` : ""].filter(Boolean).join(" · ") || null,
    dedupe: (event, memberId, payload) => `RFI_OVERDUE:${event.entityId}:${text(payload, "dueDate", event.id)}:${memberId}`,
  },
  {
    eventType: NotificationEvent.RFI_ANSWERED,
    category: "engineering",
    priority: "NORMAL",
    async recipients(_tx, _event, payload) {
      return ids(payload, "memberIds");
    },
    permission: () => "rfi.view",
    title: (payload) => `RFI ${text(payload, "number")} was answered`,
    body: (payload) => [text(payload, "subject"), payload.actorName ? `by ${text(payload, "actorName")}` : ""].filter(Boolean).join(" · ") || null,
    dedupe: perEvent,
  },
  {
    eventType: NotificationEvent.RFI_CLARIFICATION_REQUIRED,
    category: "engineering",
    priority: "NORMAL",
    async recipients(_tx, _event, payload) {
      return ids(payload, "memberIds");
    },
    permission: () => "rfi.view",
    title: (payload) => `RFI ${text(payload, "number")} needs clarification`,
    body: (payload) => text(payload, "subject") || null,
    dedupe: perEvent,
  },
  {
    eventType: NotificationEvent.RFI_CLOSED,
    category: "engineering",
    priority: "LOW",
    async recipients(_tx, _event, payload) {
      return ids(payload, "memberIds");
    },
    permission: () => "rfi.view",
    title: (payload) => `RFI ${text(payload, "number")} was closed`,
    body: (payload) => text(payload, "subject") || null,
    dedupe: perEvent,
  },
  {
    eventType: NotificationEvent.SUBMITTAL_SUBMITTED,
    category: "engineering",
    priority: "NORMAL",
    async recipients(_tx, _event, payload) {
      return ids(payload, "memberIds");
    },
    permission: () => "submittal.view",
    title: (payload) => `Submittal ${text(payload, "number")} Rev ${text(payload, "revisionCode")} was submitted for review`,
    body: (payload) => [text(payload, "title"), payload.dateLabel ? `review due ${text(payload, "dateLabel")}` : ""].filter(Boolean).join(" · ") || null,
    dedupe: perEvent,
  },
  {
    eventType: NotificationEvent.SUBMITTAL_REVIEW_ASSIGNED,
    category: "engineering",
    priority: "NORMAL",
    async recipients(_tx, _event, payload) {
      return ids(payload, "memberIds");
    },
    permission: () => "submittal.view",
    title: (payload) => `You are reviewing submittal ${text(payload, "number")}`,
    body: (payload) => text(payload, "title") || null,
    dedupe: (event, memberId, payload) => `SUBMITTAL_REVIEW_ASSIGNED:${event.entityId}:${text(payload, "assignment", event.id)}:${memberId}`,
  },
  {
    eventType: NotificationEvent.SUBMITTAL_DUE_SOON,
    category: "engineering",
    priority: "NORMAL",
    async recipients(_tx, _event, payload) {
      return ids(payload, "memberIds");
    },
    permission: () => "submittal.view",
    title: (payload) => `Review of submittal ${text(payload, "number")} is due ${text(payload, "dateLabel", "soon")}`,
    body: (payload) => text(payload, "title") || null,
    dedupe: (event, memberId, payload) => `SUBMITTAL_DUE_SOON:${event.entityId}:${text(payload, "dueDate", event.id)}:${memberId}`,
  },
  {
    eventType: NotificationEvent.SUBMITTAL_OVERDUE,
    category: "engineering",
    priority: "HIGH",
    async recipients(_tx, _event, payload) {
      return ids(payload, "memberIds");
    },
    permission: () => "submittal.view",
    title: (payload) => `Review of submittal ${text(payload, "number")} is overdue`,
    body: (payload) => [text(payload, "title"), payload.dateLabel ? `was due ${text(payload, "dateLabel")}` : ""].filter(Boolean).join(" · ") || null,
    dedupe: (event, memberId, payload) => `SUBMITTAL_OVERDUE:${event.entityId}:${text(payload, "dueDate", event.id)}:${memberId}`,
  },
  {
    eventType: NotificationEvent.SUBMITTAL_APPROVED,
    category: "engineering",
    priority: "NORMAL",
    async recipients(_tx, _event, payload) {
      return ids(payload, "memberIds");
    },
    permission: () => "submittal.view",
    title: (payload) => `Submittal ${text(payload, "number")} Rev ${text(payload, "revisionCode")}: ${text(payload, "decisionLabel", "approved")}`,
    body: (payload) => text(payload, "title") || null,
    dedupe: perEvent,
  },
  {
    eventType: NotificationEvent.SUBMITTAL_REVISION_REQUIRED,
    category: "engineering",
    priority: "HIGH",
    async recipients(_tx, _event, payload) {
      return ids(payload, "memberIds");
    },
    permission: () => "submittal.view",
    title: (payload) => `Submittal ${text(payload, "number")} Rev ${text(payload, "revisionCode")} needs a new revision`,
    body: (payload) => text(payload, "title") || null,
    dedupe: perEvent,
  },
  {
    eventType: NotificationEvent.SUBMITTAL_REJECTED,
    category: "engineering",
    priority: "HIGH",
    async recipients(_tx, _event, payload) {
      return ids(payload, "memberIds");
    },
    permission: () => "submittal.view",
    title: (payload) => `Submittal ${text(payload, "number")} Rev ${text(payload, "revisionCode")} was rejected`,
    body: (payload) => text(payload, "title") || null,
    dedupe: perEvent,
  },
  {
    eventType: NotificationEvent.ENGINEERING_DOCUMENT_SUBMITTED,
    category: "engineering",
    priority: "NORMAL",
    async recipients(_tx, _event, payload) {
      return ids(payload, "memberIds");
    },
    permission: () => "engineering_document.view",
    title: (payload) => `${text(payload, "number", "A document")} Rev ${text(payload, "revisionCode")} is ready for review`,
    body: (payload) => [text(payload, "title"), payload.dateLabel ? `review due ${text(payload, "dateLabel")}` : ""].filter(Boolean).join(" · ") || null,
    dedupe: perEvent,
  },
  {
    eventType: NotificationEvent.ENGINEERING_DOCUMENT_APPROVED,
    category: "engineering",
    priority: "NORMAL",
    async recipients(_tx, _event, payload) {
      return ids(payload, "memberIds");
    },
    permission: () => "engineering_document.view",
    title: (payload) => `${text(payload, "number", "A document")} Rev ${text(payload, "revisionCode")}: ${text(payload, "decisionLabel", "approved")}`,
    body: (payload) => text(payload, "title") || null,
    dedupe: perEvent,
  },
  {
    eventType: NotificationEvent.ENGINEERING_DOCUMENT_REVISION_REQUIRED,
    category: "engineering",
    priority: "HIGH",
    async recipients(_tx, _event, payload) {
      return ids(payload, "memberIds");
    },
    permission: () => "engineering_document.view",
    title: (payload) => `${text(payload, "number", "A document")} Rev ${text(payload, "revisionCode")}: ${text(payload, "decisionLabel", "revision required")}`,
    body: (payload) => text(payload, "title") || null,
    dedupe: perEvent,
  },
  {
    eventType: NotificationEvent.TRANSMITTAL_ISSUED,
    category: "engineering",
    priority: "LOW",
    async recipients(_tx, _event, payload) {
      return ids(payload, "memberIds");
    },
    permission: () => "transmittal.view",
    title: (payload) => `Transmittal ${text(payload, "number")} was issued`,
    body: (payload) => [text(payload, "purposeLabel"), payload.count ? `${String(payload.count)} documents` : ""].filter(Boolean).join(" · ") || null,
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

  /* Meetings (PRD #40 §73-§78, §185, §251) ------------------------------- */
  {
    eventType: NotificationEvent.MEETING_INVITED,
    category: "meetings",
    priority: "NORMAL",
    async recipients(_tx, _event, payload) {
      return ids(payload, "memberIds");
    },
    title: (payload) => `${text(payload, "actorName", "Someone")} invited you to ${recordName(payload, "a meeting")}`,
    body: (payload) => [text(payload, "when"), text(payload, "series")].filter(Boolean).join(" · ") || null,
    dedupe: (event, memberId) => `MEETING_INVITED:${event.entityId}:${memberId}:${event.id}`,
    email: {
      templateKey: "meeting.invitation",
      defaultOn: false,
      variables: (payload, link) => ({ title: recordName(payload, "a meeting"), when: text(payload, "when", "soon"), link }),
    },
  },
  {
    eventType: NotificationEvent.MEETING_UPDATED,
    category: "meetings",
    priority: "NORMAL",
    async recipients(_tx, _event, payload) {
      return ids(payload, "participantIds");
    },
    title: (payload) => `${recordName(payload, "A meeting")} was rescheduled or moved`,
    body: (payload) => text(payload, "when") || null,
    dedupe: perEvent,
  },
  {
    eventType: NotificationEvent.MEETING_CANCELLED,
    category: "meetings",
    priority: "HIGH",
    async recipients(_tx, _event, payload) {
      return ids(payload, "participantIds");
    },
    title: (payload) => `${recordName(payload, "A meeting")} was cancelled`,
    body: (payload) => text(payload, "reason") || text(payload, "when") || null,
    dedupe: perEvent,
  },
  {
    eventType: NotificationEvent.MEETING_REMINDER,
    category: "meetings",
    priority: "NORMAL",
    async recipients(_tx, _event, payload) {
      return [text(payload, "memberId")];
    },
    title: (payload) => `Coming up: ${recordName(payload, "a meeting")}`,
    body: (payload) => text(payload, "when") || null,
    dedupe: (event, memberId, payload) =>
      `MEETING_REMINDER:${event.entityId}:${text(payload, "reminderId")}:${text(payload, "occurrenceStartsAt")}:${memberId}`,
  },
  {
    eventType: NotificationEvent.MEETING_RESPONSE_CHANGED,
    category: "meetings",
    priority: "LOW",
    async recipients(_tx, _event, payload) {
      return [text(payload, "organizerMemberId")];
    },
    title: (payload) => `${text(payload, "responderName", "Someone")} ${text(payload, "verb", "replied to")} ${recordName(payload, "your meeting")}`,
    dedupe: perEvent,
  },
  {
    eventType: NotificationEvent.MEETING_MINUTES_FINALIZED,
    category: "meetings",
    priority: "NORMAL",
    async recipients(_tx, _event, payload) {
      return ids(payload, "participantIds");
    },
    title: (payload) => `Minutes finalized — ${recordName(payload, "a meeting")}`,
    body: () => "Review the meeting record.",
    dedupe: perEvent,
  },
  {
    eventType: NotificationEvent.MEETING_ACTION_ASSIGNED,
    category: "meetings",
    priority: "NORMAL",
    async recipients(_tx, _event, payload) {
      return [text(payload, "ownerMemberId")];
    },
    title: (payload) => `New action for you: ${text(payload, "actionTitle", "an action item")}`,
    body: (payload) => recordName(payload, "") || null,
    dedupe: (event, memberId, payload) => `MEETING_ACTION_ASSIGNED:${text(payload, "actionId")}:${memberId}:${event.id}`,
  },
  {
    eventType: NotificationEvent.MEETING_ACTION_COMPLETED,
    category: "meetings",
    priority: "LOW",
    async recipients(_tx, _event, payload) {
      return [text(payload, "organizerMemberId")];
    },
    title: (payload) => `Action done: ${text(payload, "actionTitle", "an action item")}`,
    body: (payload) => recordName(payload, "") || null,
    dedupe: perEvent,
  },
  /* Unit sales (E-05E §52) ---------------------------------------------------
   * To the salesperson who reserved the unit and the deal's owner, never to every
   * holder of a sales grant: the people who have to act, without noise. The
   * floor is reading the unit's commercial side. Names of clients stay out of
   * titles; the unit code is enough to open it.
   */
  {
    // Once per reservation per expiry date: an extension earns a new warning.
    eventType: NotificationEvent.UNIT_RESERVATION_EXPIRING,
    category: "sales",
    priority: "HIGH",
    async recipients(_tx, _event, payload) {
      return ids(payload, "memberIds");
    },
    permission: () => "project.unit.sales.view",
    title: (payload) => `The reservation of ${text(payload, "unitCode", "a unit")} expires ${text(payload, "whenLabel", "within 24 hours")}`,
    body: (payload) => text(payload, "projectName") || null,
    dedupe: (event, memberId, payload) => `UNIT_RESERVATION_EXPIRING:${event.entityId}:${text(payload, "expiresAt", event.id)}:${memberId}`,
  },
  {
    eventType: NotificationEvent.UNIT_RESERVATION_EXPIRED,
    category: "sales",
    priority: "HIGH",
    async recipients(_tx, _event, payload) {
      return ids(payload, "memberIds");
    },
    permission: () => "project.unit.sales.view",
    title: (payload) => `The reservation of ${text(payload, "unitCode", "a unit")} expired; the unit is for sale again`,
    body: (payload) => text(payload, "projectName") || null,
    dedupe: (event, memberId, payload) => `UNIT_RESERVATION_EXPIRED:${text(payload, "reservationId", event.id)}:${memberId}`,
  },
  {
    eventType: NotificationEvent.UNIT_RESERVATION_RELEASED,
    category: "sales",
    priority: "NORMAL",
    async recipients(_tx, _event, payload) {
      return ids(payload, "memberIds");
    },
    permission: () => "project.unit.sales.view",
    title: (payload) => `The reservation of ${text(payload, "unitCode", "a unit")} was released`,
    body: (payload) => text(payload, "projectName") || null,
    dedupe: (event, memberId, payload) => `UNIT_RESERVATION_RELEASED:${text(payload, "reservationId", event.id)}:${memberId}`,
  },
  {
    eventType: NotificationEvent.UNIT_MARKED_SOLD,
    category: "sales",
    priority: "NORMAL",
    async recipients(_tx, _event, payload) {
      return ids(payload, "memberIds");
    },
    permission: () => "project.unit.sales.view",
    title: (payload) => `${text(payload, "unitCode", "A unit")} was marked Sold`,
    body: (payload) => text(payload, "projectName") || null,
    dedupe: (event, memberId, payload) => `UNIT_MARKED_SOLD:${text(payload, "reservationId", event.id)}:${memberId}`,
  },
  /* A unit's contract and its collection (E-05F §94) ---------------------------
   * Sales' request goes to whoever may draft a unit's contract — Legal's queue,
   * not a person. Everything after it goes to the people who act on it: the
   * salesperson and the deal owner, the contract's owner, and whoever put the
   * schedule in force. The floor is reading the unit's legal or finance side,
   * and no title names a client or an amount owed by one.
   */
  {
    eventType: NotificationEvent.UNIT_CONTRACT_REQUESTED,
    category: "contracts",
    priority: "NORMAL",
    async recipients(tx, event, payload) {
      const excluded = new Set(ids(payload, "excludeMemberIds"));
      return (await activeMembers(tx, event.companyId)).filter((memberId) => !excluded.has(memberId));
    },
    permission: () => ["project.unit.legal.view", "project.unit.contract.create"],
    title: (payload) => `A contract is requested for ${text(payload, "unitCode", "a unit")}`,
    body: (payload) => text(payload, "projectName") || null,
    dedupe: (event, memberId, payload) => `UNIT_CONTRACT_REQUESTED:${text(payload, "requestId", event.id)}:${memberId}`,
  },
  {
    eventType: NotificationEvent.UNIT_CONTRACT_REQUEST_DECLINED,
    category: "contracts",
    priority: "NORMAL",
    async recipients(_tx, _event, payload) {
      return ids(payload, "memberIds");
    },
    permission: () => "project.unit.legal.view",
    title: (payload) => `Legal declined the contract request for ${text(payload, "unitCode", "a unit")}`,
    body: () => "The reason is on the unit's Legal section.",
    dedupe: (event, memberId, payload) => `UNIT_CONTRACT_REQUEST_DECLINED:${text(payload, "requestId", event.id)}:${memberId}`,
  },
  {
    eventType: NotificationEvent.UNIT_CONTRACT_SIGNED,
    category: "contracts",
    priority: "HIGH",
    async recipients(_tx, _event, payload) {
      return ids(payload, "memberIds");
    },
    permission: () => "project.unit.legal.view",
    title: (payload) => `Contract ${text(payload, "contractNumber", "")} for ${text(payload, "unitCode", "a unit")} was signed`.replace("  ", " "),
    body: (payload) => text(payload, "projectName") || null,
    dedupe: (event, memberId, payload) => `UNIT_CONTRACT_SIGNED:${text(payload, "contractId", event.id)}:${memberId}`,
  },
  {
    eventType: NotificationEvent.UNIT_CONTRACT_CANCELLED,
    category: "contracts",
    priority: "HIGH",
    async recipients(_tx, _event, payload) {
      return ids(payload, "memberIds");
    },
    permission: () => "project.unit.legal.view",
    title: (payload) => `Contract ${text(payload, "contractNumber", "")} for ${text(payload, "unitCode", "a unit")} was ${text(payload, "verb", "cancelled")}`.replace("  ", " "),
    body: (payload) => text(payload, "projectName") || null,
    dedupe: (event, memberId, payload) => `UNIT_CONTRACT_CANCELLED:${text(payload, "contractId", event.id)}:${memberId}`,
  },
  {
    // Once per installment per due date: a new schedule's installment earns its own.
    eventType: NotificationEvent.UNIT_INSTALLMENT_DUE_SOON,
    category: "finance",
    priority: "NORMAL",
    async recipients(_tx, _event, payload) {
      return ids(payload, "memberIds");
    },
    permission: () => "project.unit.finance.view",
    title: (payload) => `${text(payload, "installmentLabel", "An installment")} for ${text(payload, "unitCode", "a unit")} is due ${text(payload, "dueLabel", "soon")}`,
    body: (payload) => (text(payload, "contractNumber") ? `Contract ${text(payload, "contractNumber")}` : null),
    dedupe: (event, memberId, payload) => `UNIT_INSTALLMENT_DUE_SOON:${text(payload, "installmentId", event.id)}:${text(payload, "dueDate")}:${memberId}`,
  },
  {
    eventType: NotificationEvent.UNIT_INSTALLMENT_OVERDUE,
    category: "finance",
    priority: "HIGH",
    async recipients(_tx, _event, payload) {
      return ids(payload, "memberIds");
    },
    permission: () => "project.unit.finance.view",
    title: (payload) => `${text(payload, "installmentLabel", "An installment")} for ${text(payload, "unitCode", "a unit")} is overdue`,
    body: (payload) => (text(payload, "contractNumber") ? `Contract ${text(payload, "contractNumber")}, due ${text(payload, "dueDate")}` : null),
    dedupe: (event, memberId, payload) => `UNIT_INSTALLMENT_OVERDUE:${text(payload, "installmentId", event.id)}:${memberId}`,
  },
  {
    eventType: NotificationEvent.UNIT_PAYMENT_RECEIVED,
    category: "finance",
    priority: "NORMAL",
    async recipients(_tx, _event, payload) {
      return ids(payload, "memberIds");
    },
    permission: () => "project.unit.finance.view",
    title: (payload) => `A payment was received on contract ${text(payload, "contractNumber", "")} for ${text(payload, "unitCode", "a unit")}`.replace("  ", " "),
    body: (payload) => text(payload, "amountLabel") || null,
    dedupe: (event, memberId, payload) => `UNIT_PAYMENT_RECEIVED:${text(payload, "paymentId", event.id)}:${memberId}`,
  },
  {
    eventType: NotificationEvent.UNIT_FINANCIALLY_COMPLETE,
    category: "finance",
    priority: "NORMAL",
    async recipients(_tx, _event, payload) {
      return ids(payload, "memberIds");
    },
    permission: () => "project.unit.finance.view",
    title: (payload) => `Contract ${text(payload, "contractNumber", "")} for ${text(payload, "unitCode", "a unit")} is paid in full`.replace("  ", " "),
    body: () => "It can be completed once Legal's conditions are met.",
    dedupe: (event, memberId, payload) => `UNIT_FINANCIALLY_COMPLETE:${text(payload, "contractId", event.id)}:${memberId}`,
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
