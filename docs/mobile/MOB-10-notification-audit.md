# MOB-10 — Notification audit (Phase A)

Audit of what NESTO already has, written before any MOB-10 code. Conclusion: the
event-driven core the PRD describes **already exists** (PRD #25 / #38 / #51). MOB-10
is mostly the push half, plus the preference, privacy and grouping rules that sit
on top of it. No parallel notification system will be built.

## 1. What exists

| PRD concept | Existing implementation |
|---|---|
| Domain event + outbox | `NotificationEventOutbox` (`notification_event_outbox`), written by `enqueueNotificationEvent(tx, …)` in the producer's own transaction (`lib/core/notifications/notification.service.ts`). Lease-based claiming (`FOR UPDATE SKIP LOCKED`), attempt count at claim, jittered backoff 30 s → 1 h, `FAILED` after 5, `job_failures` history, manual retry, `schemaVersion`. |
| Event registry | `notification.events.ts`: ~114 event types, each with category, priority, recipients(), optional permission floor, `discussion`, title/body, dedupe key, email template, `mandatory`. Test: `tests/unit/notifications/notification-registry.test.ts`. |
| NotificationService / dispatcher | `notification.dispatch.ts` — builds each candidate's member context and reads the record through the record registry before writing a row (recipient authorization), applies preferences, writes `Notification`, sends email. |
| Canonical Notification | `Notification`: `(companyId, recipientMemberId)`, eventType, moduleKey, entityType/entityId, projectId, title/body (rendered text), priority `LOW/NORMAL/HIGH/CRITICAL`, `readState`/`readAt`, `dedupeKey` (unique per company+recipient), `category`, `emailedAt`, `actorMemberId`, `correlationId`, `metadataJson`. Indexed on recipient+readState+createdAt. **No `archivedAt`.** |
| Dedup / idempotency | `@@unique([companyId, recipientMemberId, dedupeKey])`; dedupe functions per event (e.g. `COMMENT_MENTIONED:{commentId}:{member}`). |
| In-app Notification Center | `components/notifications/notification-center.tsx`, `/notifications`, `GET /api/notifications` (cursor `before`), `unread-count`, `read-all`, `[id]/read`, `[id]/unread`, `[id]/open`. |
| Open = re-authorize | `openNotification` / `/notifications/[id]/open` re-reads the record in the reader's context; returns `{unavailable}` otherwise. `WITHDRAWN_TITLE` hides stored text for records the reader can no longer open. Group workspace: `*ForWorkspace` variants resolve the company. |
| Attention items | `AttentionItem` — conditions, not events; separate from notifications. Stays as is. |
| Preferences | `NotificationPreference` per `(company, member, category)`: `inAppEnabled`, `emailEnabled`; mandatory events lock in-app. UI: `components/settings/notification-preferences.tsx`, `GET/PUT /api/notifications/preferences`. **No push channel, no quiet hours, no project/company level.** |
| Scheduled events | Jobs registry: `notifications.dispatch`, `notifications.due`, `calendar.reminders`, `approvals.overdue`, `timesheets.reminders`, `dailylogs.missing`, `announcements.reminders`, … `MEETING_REMINDER` / `CALENDAR_REMINDER` events exist. |
| Observability | Metrics `notification_outbox_*`, worker heartbeats, `/api/health/ready`, alerts `NotificationOutboxBacklog` / `…FailedEvents`, runbook `docs/runbooks/notification-worker.md`. |
| Device registration (MOB-08) | `DeviceRegistration`: `userId`, `sessionId` (cascade delete), `platform IOS/ANDROID`, `pushToken` **unique**, `appVersion/appBuild`, `enabled`, `lastSeenAt`. `POST/DELETE /api/me/devices`; token re-parents between users; `pushableDevices(userIds)` requires a live session. Logout/expiry delete the session → device cascades. |
| Native client (MOB-08) | `lib/device/native`: Capacitor `PushNotifications` register/unregister, permission only from Settings → Notifications → This device (`native-device-card.tsx`), `onOpen` → `safePushPath` → router. Android project exists; `capacitor.config.ts`. |
| Deep links | MOB-08 `lib/device/links.ts`, `docs/mobile/native-deep-links.md`; push payload contract `{ title, body, data: { path } }`. |
| Offline (MOB-09) | `SyncOperation` (idempotent operation ids); synced work runs through the normal services, so their in-transaction `enqueueNotificationEvent` calls fire only when the server commits — the PRD's ordering requirement. To be proven by a test, not assumed. |
| Events for PRD modules | Tasks (`TASK_*`), mentions (`COMMENT_MENTIONED`), approvals (`APPROVAL_*`), meetings (`MEETING_*`, `CALENDAR_*`), HSE (`HSE_CRITICAL_RISK`, `HSE_ACTION_ASSIGNED`), site diary (`DAILY_LOG_*`), documents (`DOCUMENT_SUPERSEDED`, reviews), projects (`MILESTONE_*`), announcements (`ANNOUNCEMENT_*`), plus sales, finance, HR, contractors, engineering. |

## 2. Gaps against the MOB-10 PRD

1. **No push provider.** No APNs/FCM sender, no `PushProvider` abstraction, no push queue, no delivery-attempt records. `docs/mobile/native-push.md` says so explicitly. Needs Apple and Firebase credentials (server secrets, never in Git).
2. **Recipient identity split.** Notifications are per `(company, member)`; devices are per `userId`. The push step must map member → user and only push to devices of that user; a Group user with several memberships gets one push per notification row (grouped by thread/collapse key).
3. **Preferences** lack: push channel, quiet hours (+ time zone), project-level (All / Important / Muted), company-level scope, documented mandatory set, urgent override. `User` has no time zone (`ParentGroup.timezone` and `CompanySettings.timezone` exist). Quiet hours therefore store their own IANA zone per user, defaulting to the device's zone chosen in the UI, then the company's.
4. **Privacy class** (`PUBLIC_PREVIEW / LIMITED_PREVIEW / SENSITIVE`) does not exist per event. The in-app `title/body` are rendered English text; push needs a separate lock-screen rendering.
5. **Badge** — no canonical badge count in the push payload; `getUnreadCount` is per company context, the badge needs a person-level number across permitted companies. Reconciliation on launch/resume is not implemented.
6. **Archive/retention** — no `archivedAt` and no retention job for notifications (checked: `retention.run` exists; notification coverage to be confirmed).
7. **Grouping / coalescing** — no `threadId`/collapse key, no debounce for rapid meeting edits, no bulk aggregation rules.
8. **Mark-as-read from the OS**, categories/actions, Android channels (General, Tasks & Mentions, Approvals, Critical HSE) — not configured.
9. **Foreground handling** — `onOpen` only; no `pushNotificationReceived` handling (in-app toast vs. OS banner), no query invalidation.
10. **Mention/comment overlap** — `COMMENT_MENTIONED`, `COMMENT_REPLY` and `COMMENT_ADDED` exist as separate events; whether a mentioned user also receives `COMMENT_ADDED` for the same comment needs checking and a test.
11. **Drawing superseded / site diary recipients** — events exist; recipient rules must be reviewed against PRD §75-§76 (subscribed/assigned users only, no broadcast).
12. **Demo impersonation** — a demo switch is logout+login (C-01), so sessions and devices are already per-login; explicit guard against registering devices under demo sessions in production is still to be added.
13. **Delivery monitoring** — outbox metrics exist; push counters (attempted / accepted / failed / invalid token) and a platform-admin health view do not.
14. **Documentation** — `docs/notifications/` does not exist.
15. **Real-device QA** (iOS/TestFlight, Android internal build) cannot be done from this environment.

## 3. Decisions carried into the design

- **Reuse, don't duplicate.** The canonical store stays `Notification`; the outbox stays `NotificationEventOutbox`; the dispatcher gains a push step. The PRD's `DomainEventService` = `enqueueNotificationEvent`.
- **Push is a second stage, not part of the dispatch transaction.** New `PushDelivery` rows (notification, device, state `QUEUED/SENT/PROVIDER_ACCEPTED/FAILED/TOKEN_INVALID`, attempts, next attempt, provider result code — no message content) are created when a notification is written; a separate job sends them with retry/backoff, so a provider outage never fails or re-runs the notification write.
- **Provider seam** `PushProvider { send(device, payload) }` with APNs and FCM implementations behind env-configured credentials, and a no-op/log provider when unconfigured (development, CI).
- **Payload** `{ notificationId, eventType, path, badge, threadId }` plus OS title/body produced by a separate privacy-aware renderer; no record data for `SENSITIVE`.
- **Preferences** extended additively (push flags on `NotificationPreference`; new user-level quiet-hours row; new project-level preference row).

## 4. Migration and safety notes

- Additive migrations only, via the repo's safe path (diff into a throwaway DB, then `migrate deploy`); never `migrate dev`.
- Raw SQL `now()` must use `AT TIME ZONE 'UTC'` (Postgres is Europe/Tirane).
- A push to production only happens with server credentials set; nothing is committed, and per the working rules nothing is pushed or committed without an explicit request.
