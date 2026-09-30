# MOB-11 — Mobile security audit (Phase A)

Audited 2026-10-01 against `main` after MOB-10 (05664a61). Sources read: `lib/auth/*`, `lib/context/build-context.ts`, `lib/device/*`, `lib/offline/{security,keys,crypto}.ts`, `middleware.ts`, `capacitor.config.ts`, `android/`, `ios/`, `app/api/me/*`, `app/api/sync/*`, `docs/session-security.md`, `docs/mobile/{native-security,native-authentication,offline-security}.md`, `docs/notifications/push-security.md`.

Severity: CRITICAL / HIGH / MEDIUM / LOW / INFORMATIONAL. **Status** is what MOB-11 did about it.

## What already holds (verified, not re-built)

| Area | State |
| --- | --- |
| Session model | Server-side `Session` row; the Auth.js JWT carries only user id, username and session id. Deleting the row ends access on the next request. Fixed 8 h expiry (`SESSION_TTL_MS`), checked on every request with server time. |
| Revocation fan-out | `revokeSessions()` (one transaction with its `AuthEvent`s): password change keeps only the current session, admin reset ends all, member deactivation/suspension ends or relocates, company/group suspension refuses on the next request. |
| Account recovery | Native uses the canonical recovery flow (`lib/auth/password-recovery.ts`); there is no mobile-only reset. |
| Login throttling | Server-side, per account and per address (`lib/core/security/throttle.ts`). |
| Token storage | The Auth.js cookie lives in the WebView cookie jar (HttpOnly, first-party). Nothing long-lived is in `localStorage`; secure storage holds the app-lock flag, the push token and per-user offline keys (Keychain / Keystore-backed). |
| Offline store | AES-GCM-256 per record, one key and one database per user, key in secure storage, authorisation snapshot with a window that cannot be wound back by the device clock, server re-authorises every queued change live. |
| WebView | `allowNavigation` is the NESTO host only; production refuses http, localhost and private IPs; Android `allowMixedContent: false`. |
| Deep links / push | Only an in-app absolute path is followed; the route authenticates and authorises; payloads carry no record data. |
| Secrets | None in the app bundle; signing and push credentials are CI/server secrets. |
| Logs | `lib/core/observability/logger.ts` redacts every context object; push tokens and payloads are never logged. |
| Permissions | Camera/photo/notifications/biometrics asked at the action; no location, contacts or SMS permission exists. |

## Findings

| ID | Sev | Finding | Status |
| --- | --- | --- | --- |
| H-01 | HIGH | **No persistent device identity.** `DeviceRegistration` is a push token bound 1:1 to a session with `onDelete: Cascade`: ending the session erases the device. There is no device inventory, no revoked/lost state, nothing an administrator can look at, and nothing to tell a returning device that it was revoked. | Fixed — device is now a durable row (`installId`, status, compliance, revocation, data-removal state); sessions point at it, it no longer dies with them. |
| H-02 | HIGH | **Android `allowBackup="true"`.** The WebView cookie store, IndexedDB (sealed offline database) and the Keystore-wrapped preferences are eligible for cloud backup and `adb backup`, and could be restored onto another device. | Fixed — `allowBackup="false"` plus explicit `dataExtractionRules` / `fullBackupContent` that exclude everything. |
| H-03 | HIGH | **No enterprise policy layer.** App-lock timeout is a constant (60 s), the offline window and minimum version are process environment variables. An administrator cannot require app lock, shorten the offline window for a Company, or block a build. | Fixed — server-computed `EffectiveMobilePolicy` (Platform → Group → Company, strictest wins). |
| H-04 | HIGH | **App-switcher exposure.** No privacy cover; Finance/HR/Legal/Client content can be captured in the OS recents preview (listed as a follow-up in `native-security.md`). | Fixed in web layer + native project (see `biometric-security.md`); hardware verification is an open gate. |
| H-05 | HIGH | **Revocation on an offline device is invisible to the device.** A revoked session answers 401, but the app cannot tell "signed out" from "revoked", keeps the sealed cache, and has no instruction to remove it. | Fixed — unauthenticated `device-state` probe, NESTO Data Removal command (cache-only for revoke, full for lost/blocked). |
| M-01 | MEDIUM | **No recent-authentication concept.** Device/session revocation, policy changes and HR/salary surfaces rely on a live session only; a stolen unlocked session can revoke the owner's other devices. | Fixed — `Session.recentAuthAt` set by the server at sign-in and by a password check; sensitive actions require it inside a window. |
| M-02 | MEDIUM | **Version gate is env-only and incomplete.** Middleware blocks non-GET only; obsolete apps can still read; no blocked-build list; no OS floor; nothing per Group/Company. | Fixed — compliance engine; device-bound enforcement in the context resolver; middleware keeps the platform floor. |
| M-03 | MEDIUM | **Session inventory shows the raw IP address and has no device link or last-active time.** | Fixed — inventory shows device name, client, last active, no IP. |
| M-04 | MEDIUM | **`lastSeenAt` is written only at registration.** Staleness and "active now" cannot be known. | Fixed — heartbeat, throttled (≥ 5 min per device/session). |
| M-05 | MEDIUM | **App lock is a UI gate, not key protection.** The lock flag sits in secure storage; Keychain/Keystore items are not bound to biometric enrolment, so an enrolment change is not detected. | Mitigated — biometry-type fingerprint stored; a change, removal or unavailability forces NESTO re-authentication. Key-level binding (CryptoObject / `.biometryCurrentSet`) documented as not done; it would make sealed offline data unrecoverable after an enrolment change. |
| M-06 | MEDIUM | **Sign-in does not know which install it is.** A revoked install could sign in again and only be caught (if at all) by the next heartbeat. | Fixed — the shell sets a `nesto-install` cookie before sign-in; the session is bound to the device row at creation and the resolver refuses a revoked/blocked device. |
| L-01 | LOW | Fixed 8 h session with no refresh: the stolen-token window is bounded by design; no change. | Accepted |
| L-02 | LOW | iOS keychain accessibility of `@aparajita/capacitor-secure-storage` items (this-device-only or not) and iCloud Keychain sync could not be confirmed from the plugin sources in `node_modules` alone. | Open — confirm on hardware (`mobile-security-testing.md` iOS-K1). |
| L-03 | LOW | `Permissions-Policy` keeps camera off for the page; native capture uses the OS camera plugin. Acceptable. | Accepted |
| I-01 | INFO | Certificate pinning: **not adopted.** The hybrid WebView loads the NESTO origin, Android/iOS pinning for WebView traffic needs native interception, and a wrong pin locks every installed app out until a store release. Revisit only with an operational rotation plan. | Decision recorded |
| I-02 | INFO | Demo impersonation exists only where `isDevMode`; a switch is logout + login, per-user offline database — no cross-user exposure (verified in MOB-09). | Verified |
| I-03 | INFO | Root/jailbreak detection cannot be done with the current plugin set and any JS check is trivially bypassed. The contract accepts a client-reported risk signal, treats it as a hint, and never as proof. | Contract only; no detector shipped |

No CRITICAL finding.

## Not in scope of MOB-11 (and why)

- **MDM / managed app configuration**: readiness only (`mdm-readiness.md`); no MDM server.
- **SSO**: the device/session/reauth design does not assume a password (`recentAuthAt` is set by whatever authenticated the person).
- **Screenshot blocking on iOS**: the OS offers no prevention; detection only. Android `FLAG_SECURE` is available and used for sensitive surfaces (see `biometric-security.md`).
