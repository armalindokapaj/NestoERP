# iOS push

Path: outbox → `PushDelivery` → `createApnsProvider` (HTTP/2, token auth, ES256 JWT cached 40 min) → APNs → device → tap → `pushNotificationActionPerformed` → `safePushPath` → router.

## Done in the repository

- `App.entitlements`: `aps-environment` (development) and associated domains.
- `AppDelegate.swift`: forwards `didRegisterForRemoteNotificationsWithDeviceToken` / failure to Capacitor (required for the plugin to receive a token).
- `lib/core/notifications/push.apns.ts`: payload (`aps.alert`, `badge`, `thread-id`, `interruption-level`), headers (`apns-topic`, `apns-priority` 10 urgent / 5 otherwise, `apns-collapse-id`), error classification (410/BadDeviceToken/Unregistered → token invalid; 429/5xx/ExpiredProviderToken → retry). Unit-tested with injected transports and a real ES256 signature check.
- Permission asked only from Settings → Notifications → This device (MOB-08); foreground pushes show no OS banner (no `presentationOptions`), and `pushNotificationReceived` refreshes the bell.

## Needed from you (not possible here)

1. Apple Developer: enable Push Notifications for the App ID; create an APNs Auth Key (.p8).
2. Set `APNS_*` and `PUSH_PROVIDER=live` on the server. Use `APNS_ENVIRONMENT=sandbox` for Xcode/debug builds; change `aps-environment` to `production` for TestFlight/App Store builds.
3. Real-device QA (PRD §186): permission, denied, later enabled, foreground, background, terminated, badge, deep links, grouping, quiet hours, sign-out, sensitive preview, TestFlight build. **Not run.**

## Known gap

Icon badge is updated by the push's `aps.badge` only; no client badge plugin is installed to correct it on resume.
