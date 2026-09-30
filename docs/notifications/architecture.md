# Notification architecture (MOB-10)

One system for Web, iOS and Android. MOB-10 extended the notification core built in PRD #25/#38/#51; it did not add a second one.

```
Business action ── (same transaction) ──► notification_event_outbox
                                               │  worker: notifications.dispatch (lease, retry, dedupe)
                                               ▼
                               recipients → record access → preferences
                                               │
                               Notification (canonical, in-app)  ──► Web / iOS / Android inbox
                                               │ after the row exists
                                               ▼
                         queuePush → push_deliveries (QUEUED, per device)
                                               │ same tick, separate stage
                                               ▼
                         sendDuePushDeliveries → PushProvider ──► APNs / FCM
```

## Rules

- Modules call `enqueueNotificationEvent(tx, …)` inside their own transaction. Nothing outside `lib/core/notifications/push.*` knows APNs or FCM exists (`PushProvider` is the seam).
- **The notification is the record; push is a courtesy.** Queueing push never fails the event (errors are logged and swallowed); sending push never touches the notification. A provider outage leaves `push_deliveries` rows in `QUEUED` with backoff and the in-app notification untouched.
- **A notification never grants access.** Every tap goes through `/notifications/{id}/open`, which re-reads the record in the reader's current context.
- **Devices belong to users, notifications to memberships.** The dispatcher maps member → user; the sender re-checks the device (enabled, same user, live session) at send time, so sign-out or an account switch stops delivery even for rows queued earlier.
- **`PROVIDER_ACCEPTED` is not read.** `readAt` is only ever set by the person opening or marking the notification.

## Pieces

| Concept in the PRD | Implementation |
|---|---|
| DomainEventService / outbox | `enqueueNotificationEvent`, `NotificationEventOutbox` |
| NotificationService / RecipientResolver / Template | `notification.dispatch.ts`, per-event `recipients()` and `title()`/`body()` in `notification.events.ts` |
| NotificationPreferenceService | `notification.preferences.ts`, `notification.settings.ts` |
| Deduplication | unique `(companyId, recipientMemberId, dedupeKey)` on `Notification`; `@@unique([notificationId, deviceRegistrationId])` on `PushDelivery` |
| PushService / PushProvider | `push.service.ts`, `push.provider.ts`, `push.apns.ts`, `push.fcm.ts` |
| Quiet hours / policy / privacy | `push.quiet-hours.ts`, `push.policy.ts`, `push.privacy.ts` |
| DeviceRegistrationService | `lib/auth/device.service.ts` (MOB-08) |
| NotificationScheduler | existing jobs (`calendar.reminders`, `notifications.due`, `approvals.overdue`, …) enqueue events; reminders are derived from current record state when they fire, so there is no stored schedule to cancel (see recipient-rules.md) |

## Data added by MOB-10

`push_deliveries`, `notification_quiet_hours`, `notification_project_preferences`; `notifications.archivedAt`, `notifications.threadKey`; `notification_preferences.pushEnabled`. All additive.

## Deviations and deferrals

- No separate Web Push (PRD §161 makes it optional).
- Web/native badge: the server sends the canonical unread count with each push (`aps.badge`, FCM `notification_count`). The app does not set the icon badge itself on resume — that needs a badge plugin that is not installed. Until it is, a badge can only be corrected by the next push.
- Digests, per-event micro-preferences and notification search are not built (PRD §100, §125).
