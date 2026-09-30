import { writeFileSync } from "node:fs";

import { notificationEventDefinitions } from "../lib/core/notifications/notification.events";
import { decidePush, androidChannel, isDirectEvent } from "../lib/core/notifications/push.policy";
import { pushPrivacyClass } from "../lib/core/notifications/push.privacy";

/**
 * Regenerates docs/notifications/event-registry.md from the registry itself, so
 * the document cannot drift from the code (MOB-10 §11). Run: npx tsx scripts/notifications-registry-doc.ts
 */
const rows = notificationEventDefinitions()
  .map((definition) => {
    const push = decidePush({ eventType: definition.eventType, priority: definition.priority, mandatory: Boolean(definition.mandatory), categoryPushEnabled: true, projectLevel: "ALL" });
    return {
      eventType: definition.eventType,
      category: definition.category,
      priority: definition.priority,
      privacy: pushPrivacyClass(definition.eventType, definition.category),
      push: push.push ? (push.urgent ? "urgent" : "yes") : "no (inbox only)",
      channel: androidChannel({ category: definition.category, priority: definition.priority }),
      direct: isDirectEvent(definition.eventType) ? "direct" : "routine",
      mandatory: definition.mandatory ? "yes" : "",
      email: definition.email ? (definition.email.defaultOn ? "default on" : "opt-in") : "",
      discussion: definition.discussion ? "yes" : "",
    };
  })
  .sort((a, b) => a.category.localeCompare(b.category) || a.eventType.localeCompare(b.eventType));

const lines = [
  "# Notification event registry",
  "",
  "Generated from `lib/core/notifications/notification.events.ts` and the push policy by `scripts/notifications-registry-doc.ts`. Do not edit by hand.",
  "",
  `${rows.length} events. The definition for each event (recipient resolution, permission floor, title/body, dedupe key, email template) is the registry entry itself; this table is the delivery summary.`,
  "",
  "| Event | Category | Priority | Lock-screen privacy | Push | Android channel | Direct? | Mandatory | Email | Discussion |",
  "|---|---|---|---|---|---|---|---|---|---|",
  ...rows.map((r) => `| ${r.eventType} | ${r.category} | ${r.priority} | ${r.privacy} | ${r.push} | ${r.channel} | ${r.direct} | ${r.mandatory} | ${r.email} | ${r.discussion} |`),
  "",
  "## Reading the table",
  "",
  "- **Originating module, trigger, recipients, permission floor, title/body, dedupe key** — in the registry entry. Recipients are candidates: the dispatcher re-reads the event's record in each candidate's own context and writes a notification only for someone who could open it at that moment.",
  "- **Priority** — `LOW` is inbox only, never pushed. `NORMAL`/`HIGH` push. `CRITICAL` pushes urgently, bypasses category and project-mute preferences, and (unless the person turned the override off) quiet hours. Only critical safety and critical announcement events are critical.",
  "- **Push** — the decision with default preferences. A category switch, a muted project or quiet hours change it per person (see notification-preferences.md).",
  "- **Direct** — addressed to one person by name (assignment, mention, approval request, invitation). A project mute never hides these.",
  "- **Deep link** — every notification opens `/notifications/{id}/open`, which re-authorises the record and redirects to its canonical path.",
  "- **Grouping** — `threadKey` is `{entityType}:{entityId}`: one record, one lock-screen thread (APNs `thread-id`/collapse id, FCM collapse key and tag).",
  "",
];
writeFileSync("docs/notifications/event-registry.md", lines.join("\n"));
console.log(`wrote ${rows.length} events`);
