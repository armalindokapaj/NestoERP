import type { NotificationPreviewPolicy } from "@/lib/core/security/mobile-policy.schema";
import type { NotificationCategory } from "./notification.events";

/**
 * What may appear outside the signed-in app (MOB-10 §41-§43).
 *
 * A locked phone is visible to whoever is next to it. Every event type has a
 * privacy class, derived from its category and overridable per event, and the
 * class — not the event's in-app title — decides the text the OS shows:
 *
 *   PUBLIC_PREVIEW   the event's own title (“You were assigned “Facade Inspection””)
 *   LIMITED_PREVIEW  a generic line for the kind of thing; no record name
 *   SENSITIVE        no subject at all
 *
 * The in-app Notification Center is behind authentication and always shows the
 * full title; this only governs the push transport.
 *
 * The organization's mobile policy (MOB-11 §99) can only add to that: HIDDEN shows
 * nothing about any event, FULL lets the event's own title through for the
 * limited class too. It never relaxes SENSITIVE (people, contracts, money) and
 * never puts a comment's words outside the app.
 */
export type PushPrivacyClass = "PUBLIC_PREVIEW" | "LIMITED_PREVIEW" | "SENSITIVE";

const BY_CATEGORY: Record<NotificationCategory, PushPrivacyClass> = {
  tasks: "PUBLIC_PREVIEW",
  mentions: "PUBLIC_PREVIEW",
  comments: "PUBLIC_PREVIEW",
  approvals: "LIMITED_PREVIEW",
  documents: "PUBLIC_PREVIEW",
  qa_qc: "PUBLIC_PREVIEW",
  hse: "PUBLIC_PREVIEW",
  hr: "SENSITIVE",
  contracts: "SENSITIVE",
  procurement: "LIMITED_PREVIEW",
  calendar: "PUBLIC_PREVIEW",
  meetings: "PUBLIC_PREVIEW",
  timesheets: "LIMITED_PREVIEW",
  daily_logs: "PUBLIC_PREVIEW",
  project_planning: "PUBLIC_PREVIEW",
  announcements: "PUBLIC_PREVIEW",
  contractors: "PUBLIC_PREVIEW",
  engineering: "PUBLIC_PREVIEW",
  sales: "LIMITED_PREVIEW",
  finance: "SENSITIVE",
  organization: "LIMITED_PREVIEW",
};

/** Events stricter than their category: clients, contracts, money, people. */
const SENSITIVE_PREFIXES = ["UNIT_CONTRACT", "UNIT_PAYMENT", "UNIT_INSTALLMENT", "UNIT_FINANCIALLY", "EMPLOYMENT_", "EMPLOYEE_", "QUALIFICATION_", "LEAVE_", "CONTRACT_"];

export function pushPrivacyClass(eventType: string, category: string | null): PushPrivacyClass {
  if (SENSITIVE_PREFIXES.some((prefix) => eventType.startsWith(prefix))) return "SENSITIVE";
  return (category && BY_CATEGORY[category as NotificationCategory]) || "LIMITED_PREVIEW";
}

const LIMITED_TITLE: Partial<Record<string, string>> = {
  approvals: "An approval needs your attention",
  procurement: "A procurement item needs your attention",
  timesheets: "A timesheet needs your attention",
  sales: "A sales item needs your attention",
  organization: "Your place in the organization changed",
};

export type PushText = { title: string; body: string | null };

/** The OS-visible text for one notification. Never reads the body for anything but PUBLIC_PREVIEW. */
export function renderPushText(input: { eventType: string; category: string | null; title: string; body: string | null }, preview: NotificationPreviewPolicy = "LIMITED"): PushText {
  const cls = pushPrivacyClass(input.eventType, input.category);
  if (preview === "HIDDEN") return { title: "You have a new notification", body: "Open NESTO to see it." };
  // FULL: the limited class shows its own title too. Sensitive stays sensitive.
  if (preview === "FULL" && cls === "LIMITED_PREVIEW") return { title: input.title.slice(0, 120), body: null };
  switch (cls) {
    case "PUBLIC_PREVIEW":
      // A comment's own words stay in the app: who and where is enough outside it (§60).
      if (input.category === "mentions" || input.category === "comments") return { title: input.title.slice(0, 120), body: null };
      return { title: input.title.slice(0, 120), body: input.body ? input.body.slice(0, 160) : null };
    case "LIMITED_PREVIEW":
      return { title: (input.category && LIMITED_TITLE[input.category]) || "Something needs your attention", body: "Open NESTO to see details." };
    case "SENSITIVE":
      return { title: "You have a new notification", body: "Open NESTO to see it." };
  }
}
