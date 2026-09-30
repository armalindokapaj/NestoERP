# Native security (MOB-08 §53, §73, §78-§82, §90)

| Area | Decision |
| --- | --- |
| Origin | Hosted shell; `allowNavigation` = the NESTO host. Production/staging refuse localhost, private IPs, http. Android `allowMixedContent: false`; cleartext only in a development build. |
| CSP / headers | Unchanged. The document is the NESTO origin, so the nonce CSP, `frame-ancestors 'none'`, HSTS apply as in a browser. Permissions-Policy keeps camera/microphone/geolocation off for the *page*; native capture uses the OS camera plugin. |
| Auth | Same cookie session; nothing weakened (see `native-authentication.md`). |
| Secrets in the app | None. Only the public origin and `NEXT_PUBLIC_*` values. Signing keys, certificates, APNs/FCM credentials, Play/App Store keys live in CI secrets (`store-release` environment) and are git-ignored by pattern. |
| Local storage | No sensitive secret in `localStorage`. Secure storage holds the app-lock flag and push token only (Keychain / Keystore-backed). Logout clears it. |
| Files | Native picks are read by path and handed to the same `UploadService`; shares of documents go through a cache copy that is deleted after the share sheet closes. No public file URL is created for sharing. |
| Permissions | Camera, photo/files, notifications and biometrics — each requested at the action, never at first launch (`NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`, `NSFaceIDUsageDescription`; Android `POST_NOTIFICATIONS`, `USE_BIOMETRIC`). Denial leaves "Choose file" available (`CaptureError`). No location permission is requested; Mapbox does not need it. |
| Device and policy | Superseded in part by MOB-11: a durable Device, server-resolved mobile policy, compliance and NESTO Data Removal (`docs/security/mobile-security-model.md`). The platform floor below still applies. |
| Old binaries | `middleware.ts` answers `426 UPDATE_REQUIRED` to any non-GET request from a NESTO app whose version is below `NESTO_MIN_APP_VERSION`. The client shows a blocking Update screen. Raise the minimum only for a real compatibility or security reason. |
| Logging / analytics | The shell adds none. Error reporting already in the web app (PRD #30) runs in the WebView with app version in the user agent; do not add SDKs that capture record contents. Event names only, never values. |
| Screenshots / privacy cover | Done in MOB-11: iOS overlay in the app switcher, Android 13+ recents preview off, FLAG_SECURE on sensitive surfaces. See `docs/security/biometric-security.md`. |

## Verified by test

`tests/unit/native/mob08-native.test.ts`: origin rules, link classification, deep-link and push-path safety, version policy, capability parity. Security matrix and ownership gates include the new routes and model.
