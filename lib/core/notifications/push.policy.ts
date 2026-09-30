import type { NotificationPriority } from "./notification.events";

/**
 * Whether a notification may be pushed to a person's phone, and when (MOB-10
 * §17-§19, §44-§46, §88-§94). Pure, so every rule is a one-line test.
 *
 * In-app delivery is decided elsewhere and is not affected by anything here:
 * muting a project or entering quiet hours silences the phone, not the inbox.
 */
export type ProjectLevel = "ALL" | "IMPORTANT" | "MUTED";

export type PushDecision = { push: false; reason: string } | { push: true; urgent: boolean };

/**
 * Events addressed to one person by name. A project mute never hides them:
 * somebody assigned you, mentioned you or asked you to decide (MOB-10 §90).
 */
const DIRECT_EVENTS = new Set([
  "COMMENT_MENTIONED",
  "COMMENT_REPLY",
  "APPROVAL_REQUESTED",
  "PO_APPROVAL_REQUIRED",
  "MEETING_INVITED",
  "CALENDAR_PARTICIPANT_ADDED",
  "DOCUMENT_REVIEW_REQUESTED",
  "TIMESHEET_APPROVAL_ASSIGNED",
  "RFI_ASSIGNED",
]);

export function isDirectEvent(eventType: string): boolean {
  return DIRECT_EVENTS.has(eventType) || eventType.endsWith("_ASSIGNED");
}

export function decidePush(input: {
  eventType: string;
  priority: NotificationPriority;
  mandatory: boolean;
  categoryPushEnabled: boolean;
  projectLevel: ProjectLevel;
}): PushDecision {
  // A critical safety alert is the one thing a preference does not silence.
  const urgent = input.priority === "CRITICAL";
  if (urgent || input.mandatory) return { push: true, urgent };

  if (!input.categoryPushEnabled) return { push: false, reason: "CATEGORY_OFF" };
  // Low priority is for the inbox, never for a buzz.
  if (input.priority === "LOW") return { push: false, reason: "LOW_PRIORITY" };

  if (!isDirectEvent(input.eventType)) {
    if (input.projectLevel === "MUTED") return { push: false, reason: "PROJECT_MUTED" };
    if (input.projectLevel === "IMPORTANT" && input.priority !== "HIGH") return { push: false, reason: "PROJECT_IMPORTANT_ONLY" };
  }
  return { push: true, urgent: false };
}

/** Android channels: few and meaningful, because people can change each one in OS settings (MOB-10 §188). */
export type AndroidChannel = "general" | "tasks_mentions" | "approvals" | "critical_hse";

export function androidChannel(input: { category: string | null; priority: NotificationPriority }): AndroidChannel {
  if (input.category === "hse" && input.priority === "CRITICAL") return "critical_hse";
  if (input.category === "approvals") return "approvals";
  if (input.category === "tasks" || input.category === "mentions" || input.category === "comments") return "tasks_mentions";
  return "general";
}
