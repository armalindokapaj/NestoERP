# Notification preferences

Server-side, per person, following them across devices.

| Setting | Scope | Stored in |
|---|---|---|
| In-app, Email, Push per category | member (company) | `notification_preferences` (`inAppEnabled`, `emailEnabled`, `pushEnabled`) |
| Quiet hours (window, time zone, critical override) | user | `notification_quiet_hours` |
| Project level: All / Important only / Muted | member + project | `notification_project_preferences` |
| OS permission (enabled / denied / not requested / unavailable) | device | the OS; shown in Settings → Notifications → This device |

UI: Settings → Notifications. API: `GET/PATCH /api/notifications/preferences`, `GET/PUT /api/notifications/quiet-hours`, `GET/PATCH /api/notifications/project-preferences`.

## Final delivery = preference AND permission AND device

A push is sent only if the category push switch (or an exception below) allows it, the project level allows it, at least one of the person's devices is registered, enabled and in a live session, and the OS actually shows it. The first two are preferences; the last two are device state.

## Mandatory notifications (PRD §87)

- Categories containing a `mandatory` event have their in-app and push switches locked on server-side: currently `hse` (critical risk) and `announcements` (critical announcement). The UI shows a lock note; the server ignores a request to turn them off.
- **Why:** a critical safety alert or critical company notice that can be silenced is not a safety control.

## Exceptions to muting (PRD §90)

A muted or important-only project never suppresses: direct events (assigned to you, mentioned, approval requested, invited, review requested), mandatory events, critical priority. Muting silences the phone, not the inbox: the in-app notification is still created.

## Quiet hours (PRD §91-§94)

- In-app notifications are always created. Non-urgent push waits until the window ends.
- The window is minutes from local midnight in the person's stored IANA zone (defaults to the device's zone when switched on, else the company's, else UTC). It may cross midnight.
- Critical alerts pass through while "Let critical safety alerts through" is on (default on). The screen shows this line only while the override is on. The override exists for critical safety alerts only; no ordinary reminder uses it.
