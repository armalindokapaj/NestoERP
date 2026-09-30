# MOB-08 — Native readiness audit

Audit date 2026-09-30, against `main` at c32f097e. Nothing native was installed before this was written (PRD §6).

## 1. Findings

| Area | Finding | Consequence for the native shell |
| --- | --- | --- |
| Framework | Next.js 15.5 App Router, React 19, Turbopack. Server components, server actions (`lib/actions/*`), route handlers under `app/api/*`. | Cannot be statically exported. A bundled web directory would drop every server action and page that reads the database. |
| Middleware | `middleware.ts` runs Auth.js (edge half), mints a per-request CSP nonce, redirects unauthenticated users to `/login?callbackUrl=`, answers API calls 401, sets `Cache-Control: private, no-store` on protected routes. | Must run in front of every page; only works when the shell loads the real origin. |
| Authentication | Auth.js v5, Credentials provider (username + password), **JWT session cookie** (`maxAge` 8 h, `SESSION_TTL_MS`) plus a server `Session` row (`sessionId` in the token). Revocation = ending the row; `requireModule()` reads live permissions. A `nesto.signed-out` cookie suppresses a stale JWT. | Cookie auth is first-party when the WebView's top-level document is the NESTO origin, so it works unchanged and revocation keeps working. A bundled app on `capacitor://localhost` would make every call cross-origin and need a second token system (forbidden by §20). |
| CSP | Nonce-based `script-src 'self' 'nonce-…' 'strict-dynamic'`, `connect-src 'self'` + storage/Mapbox origins, `frame-ancestors 'none'`, `upgrade-insecure-requests`, `form-action 'self'`. | Compatible with a hosted shell (the document *is* the NESTO origin). Incompatible with a bundled shell (`'self'` would be the capacitor origin). |
| Permissions-Policy | `camera=(), microphone=(), geolocation=()` | Blocks `getUserMedia` in the page. The web capture adapter uses `<input type=file capture>`, so it is unaffected; the native adapter uses the Capacitor camera plugin. Keep as is: no location/microphone. |
| CORS | No cross-origin API consumers; same-origin only. | Nothing to loosen. Do not add CORS for the app. |
| Uploads | Signed-URL `PUT` straight to the object store (Supabase/S3 origin in `connect-src`); MOB-07 `CaptureService`/upload queue. | Works from the WebView. Native adapter only feeds `File`s into the same queue. |
| Downloads / previews | `POST /api/documents/:id/preview` returns a short-lived signed URL, framed or fetched. | Needs a native open/save/share path (`FileService`), same permission check. |
| Redirects | `/legal → /contracts`; login `callbackUrl`. | `callbackUrl` must stay same-origin — already the case. |
| Service workers / PWA | None except `public/sw-3d-cache.js` (3D asset cache). No web manifest. | No PWA conflict. The worker is registered only by the 3D viewer; it must be validated in the native runtime (service workers are supported in WKWebView only for app-bound domains — see §4). |
| Environment | `DATABASE_URL`, `AUTH_SECRET`, `AUTH_TRUST_HOST`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_MAPBOX_TOKEN`, storage vars. `NEXT_PUBLIC_*` are already public. | Native config carries only the origin per environment. No secret goes into the app. |
| Mapbox | `mapbox-gl` 3.x, token `NEXT_PUBLIC_MAPBOX_TOKEN`, CSP adds Mapbox hosts when set. | Needs a device check (workers as `blob:` are allowed). No location permission is requested by the app. |
| Three.js / Rozaris | three 0.185, Draco/Meshopt WASM (`'wasm-unsafe-eval'`), `blob:` workers, WebGL renderer with fallback. | WebGL works in WKWebView/Android WebView; WebGPU availability varies — the existing fallback renderer is the path. Needs real-device validation. |
| PDF | `pdfjs-dist` 5, worker served from the origin. | Shared viewer stays. |
| Sessions in UI | Demo user switch = logout + login (C-01), development/demo only. | Switching must clear the WebView cookie state and any native device registration. |
| Notifications | `Notification`, `NotificationPreference`, `NotificationEventOutbox` + worker exist (PRD #38/#51). No device/push model. | Push needs a new `DeviceRegistration` model and a push provider step in the outbox worker. Full native notifications are MOB-10; MOB-08 builds the registration, the provider seam and the deep-link tap path. |
| Native projects | None. Node 24, Xcode 27 present. **No JDK / Android SDK on this machine.** | iOS can be built here. Android Gradle build needs JDK 17+ and the SDK (CI or developer machine). |

## 2. Decision — runtime architecture

**Option B — hosted application shell.** The native app's WebView loads the canonical NESTO origin for its environment (`server.url`).

Why:

1. Static export is impossible (server components, actions, middleware, nonce CSP).
2. Cookie auth and live permission checks keep working with zero new auth code (§20, §21).
3. A web deploy reaches iOS, Android and browser at once, so "build once" (§4) is literal.
4. CSP stays strict and unchanged.

Costs, accepted:

- The app needs the network to show anything. That is MOB-09's problem; MOB-08 ships a native offline screen instead of a white WebView error page.
- Store review (Apple 4.2 "minimum functionality") is answered by real native capability: camera, push, biometric lock, share, deep links.
- Navigation must be restricted to an origin allowlist (§53), enforced in the shell config (`allowNavigation`) and again in JS.

Option A (bundled) rejected: breaks the server. Option C (hybrid) is reserved for MOB-09 (bundled offline shell), not needed now.

## 3. Native vs web update classification (§65)

| Change | Ships by |
| --- | --- |
| Any page, component, server action, API, query, copy, style | Web deploy (all three platforms) |
| Shared UI calling an already-shipped native plugin | Web deploy |
| New/updated Capacitor plugin, permission string, entitlement, icon/splash, `capacitor.config`, allowed origins, deep-link domain, native SDK | Store release |
| Server needs a newer native capability than installed binaries have | Raise `minimumSupportedAppVersion` (forced update) |

## 4. Authentication design for the shell

- Session = the existing Auth.js cookie in the WebView's persistent cookie store. Closing/reopening keeps it until the 8 h TTL or revocation; no new token, no `MobileSession`.
- **Biometrics are an app lock, not a credential.** Secure-storage holds only an "app lock enabled" flag and (optionally) a last-active timestamp. After a configurable background period the shell shows a native lock screen; success reveals the existing session, failure/unavailable falls back to canonical login. No password is stored. (A stored-password biometric login is deliberately not built: it would make the device a second credential store.)
- Logout (`endSessionAction`) additionally calls the device-unregister API and clears WebView storage.
- Unauthorized deep link: the route goes through middleware and `requireModule()` like any navigation; nothing is cached by the shell.
- Decision needing the owner: sessions longer than 8 h on a phone (a site worker who opens the app on day two must sign in again). Left at 8 h; changing it is a server policy, not a native change.

## 5. Gaps this PRD cannot close from this machine

- iOS signing, TestFlight, APNs key: Apple Developer account.
- Android signing, Play internal testing, FCM: Google Play account, Firebase project.
- Universal Links / App Links: need the Apple Team ID and the Android release-certificate SHA-256 in the two well-known files; the files and routes are built, the values are configuration.
- Real-device, VoiceOver/TalkBack, mid-range performance and memory testing.
- Android Gradle build: no JDK here.

These are listed as open in the implementation report, not claimed.

## 6. Open product decisions

1. Bundle/application id: proposed `com.nesto.erp` (permanent once published).
2. Production deep-link origin: proposed `https://www.rozaris.com` (current prod domain).
3. Staging origin: none exists today; the shell reads it from config, the value is yours to provide.
