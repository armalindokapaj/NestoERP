# Push notifications (MOB-08 §32-§36)

```
NESTO event → outbox → notification worker → DeviceRegistration lookup → provider (APNs / FCM) → device → tap → path → router
```

## Built in MOB-08

- `DeviceRegistration` (`device_registrations`): `userId`, `sessionId`, `platform`, `pushToken` (unique), `appVersion`, `appBuild`, `enabled`, `lastSeenAt`. One user, many devices; the token is never on `User`. No fingerprinting.
- `POST /api/me/devices` (register/refresh, re-parents a token that moves between people) and `DELETE /api/me/devices`. Both are the caller's own affairs (`group: "any"`).
- The registration is tied to the session that created it. Sign-out, expiry and revocation delete the session row, which cascades to the device. `pushableDevices(userIds)` additionally requires a live session.
- Permission is requested only from the **Push notifications** switch (Settings → Notifications → This device), never at launch. If already granted, launch silently refreshes the token.
- Tap handling: the notification payload carries `data.path`. `safePushPath` accepts only an in-app absolute path (no `//`, scheme, `/api`, `/_next`); the shell then navigates, and the normal session + permission checks decide what is shown.

## Delivery providers — not configured here

The provider step (APNs key, Firebase project, sender credentials) needs Apple/Google accounts and belongs with MOB-10 (Native Notifications & Communication), which also owns categories, collapse keys and quiet hours. The seam is `pushableDevices()`; the payload contract is `{ title, body, data: { path } }`. iOS tokens are APNs device tokens, Android tokens are FCM registration tokens. `google-services.json` / `GoogleService-Info.plist` are git-ignored.

Until a provider is wired, registration, revocation and tap-to-route are real and tested; a pushed message has not been sent end to end.
