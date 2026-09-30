# Android push

Path: outbox → `PushDelivery` → `createFcmProvider` (HTTP v1, service-account OAuth, token cached) → FCM → device → tap → router.

## Done in the repository

- `AndroidManifest.xml`: `POST_NOTIFICATIONS`; `app/build.gradle` applies the Google services plugin only when `google-services.json` is present.
- Channels created on enabling push (`lib/device/native/index.ts`): `general`, `tasks_mentions`, `approvals`, `critical_hse` (importance 3/4/4/5). The server picks the channel (`androidChannel`): critical HSE → `critical_hse`, approvals → `approvals`, tasks/mentions/comments → `tasks_mentions`, else `general`. People may change each channel in system settings; the server does not assume otherwise.
- Message: `notification` (title/body) + string-only `data` (`path`, `notificationId`, `eventType`, `badge`), `android.priority` HIGH for urgent, `collapse_key` and `tag` = thread key, `notification_count` = badge.
- Error classification: UNREGISTERED/404/400-INVALID_ARGUMENT → token invalid; 429/5xx/UNAVAILABLE/INTERNAL/QUOTA → retry. Unit-tested with an injected fetch.

## Needed from you (not possible here)

1. Firebase project, Android app registered; put `google-services.json` in `android/app/` (git-ignored); create a service account with FCM permission and set `FCM_SERVICE_ACCOUNT` and `PUSH_PROVIDER=live`.
2. Real-device QA (PRD §187): permission (Android 13+), channels, foreground/background/terminated, deep links, grouping, battery restrictions, token refresh, sign-out, sensitive preview, internal-testing build. **Not run.**
