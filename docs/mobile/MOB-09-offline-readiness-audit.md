# MOB-09 offline readiness audit

Written before any offline code (PRD §5). Every claim is from the repository as of MOB-08 (`d5d61047`).

## 1. What exists today

| Area | Finding | Consequence for MOB-09 |
| --- | --- | --- |
| Native shell | **Hosted shell.** `capacitor.config.ts` sets `server.url` to the NESTO origin; `native/www` holds only `offline.html`, shown by `errorPath` when the origin cannot be reached. | The web app itself does not load without a network. Offline work needs a way to load an app shell offline (decision D1). |
| Service worker / PWA | None. `worker-src 'self'` is already allowed by the CSP (`lib/core/security/csp.ts`). No manifest (removed by `native:assets`). | A worker at `/sw.js` is permitted; it needs a middleware public path. |
| Browser storage | `localStorage` only for UI conveniences and the logout broadcast. No IndexedDB anywhere. Upload queue lives in module memory (`components/documents/upload-queue.tsx`). | A local database is new; nothing to migrate. |
| Native plugins installed | `@capacitor/filesystem`, `@capacitor/network`, `@capacitor/camera`, `@capacitor/app`, `@aparajita/capacitor-secure-storage` (Keychain / Keystore), `@capawesome/capacitor-file-picker`, push, biometrics. **No SQLite plugin.** | Key storage and durable files need no new plugin. A SQLite/SQLCipher plugin would be a binary change that cannot be verified here (decision D2). |
| Connectivity | Nothing consumes `@capacitor/network`; the web uses `navigator.onLine` nowhere. | `ConnectivityService` is new. |
| Session | Auth.js JWT cookie + server `Session` row, `SESSION_TTL_MS` = 8 h. `middleware.ts` checks only the cookie. `withContext` (`lib/api/respond.ts`) resolves the live user/company/permissions per request. Logout is `logout()` in `lib/auth/client-lifecycle.ts`, with an `onBeforeLogout` hook list. | A queued write is always authorised by a fresh `withContext` at sync time. The 8 h session can lapse while offline; the queue is identity-bound and resumes only after the **same** user signs in again (D3). |
| Workspace | Group workspace refuses every non-GET business call (`WORKSPACE_COMPANY_REQUIRED`); writes also carry a tab workspace check. | A queued operation records its company; the server refuses a mismatch. |
| Tasks | `Task.version` (AUD-02) with trigger; `mutateTask` takes `expectedVersion`; commands `start / block / complete / reopen / return_to_todo / archive / restore / claim`; conflicts come back as `CONFLICT` with reason. State machine `task.machine.ts`. | Optimistic concurrency exists. Queued task actions call `startTask` / `completeTask` — never the table. |
| Comments | `collaboration.createComment(context, parentType, parentId, {body})`; no idempotency key. | Needs a `clientOperationId` so an ambiguous retry cannot double-post. |
| Daily log (the Site Diary) | `createDailyLog` returns the existing log for `(project, date)` — already idempotent for create. `updateDailyLog` and `submitDailyLog` take `expectedVersion`. Evidence: a photo is a `Document` linked by `setEvidenceMeta`. Sections (weather, workforce, …) are entry rows. | Create is naturally safe. Update/submit carry the version. Section entries stay online-only in this delivery (§5). |
| HSE | `createIncident(context, input)`, permission `hse.incident.create`; no idempotency key. | Needs `clientOperationId`. |
| Documents | `Document.currentVersionId`, `latestVersionNumber`; `DocumentVersion.versionNumber`, `checksumSha256`, `sizeBytes`, `supersededAt`, `reviewState`. Preview/download resolve a signed URL per request (`/api/documents/:id/preview`, `/versions/:vid/download`). | Enough metadata to store `downloaded version` and compare to current; `supersededAt` gives the SUPERSEDED signal. |
| Uploads | Three steps (authorise signed URL → PUT → complete). `Idempotency-Key` header makes authorise repeatable (`DocumentUploadSession` unique on company+member+key). Single PUT, no resumable upload. | Replaying an offline photo is the existing flow with a stable key. Resume is unsupported; a restart is duplicate-safe (PRD §43 "otherwise safely restart"). |
| Approvals, Finance, HR, Sales | Live-state and permission sensitive. | Online only (matrix). |
| Compatibility | `/api/app/compatibility`, UA `NESTOApp/x.y.z`, middleware 426 for old binaries. | Extended with `minimumSyncProtocolVersion` (§109). |
| Observability | `lib/core/observability/metrics.ts` counters, structured logger. | Sync counters use the same registry; event names only. |
| Idempotency elsewhere | Job and mail idempotency exist; no API-level operation ledger. | New `SyncOperation` ledger. |

## 2. Decisions

**D1 — Loading the app with no network.** Keep one product. A service worker (`/sw.js`, origin root) precaches the immutable `/_next/static` assets it sees and a dedicated client-rendered **`/offline`** area (Sync Center, offline project workspace, offline Site Diary, task reading/comment, HSE capture). `/offline` reads only the local database, so it does not need the server to render. Android WebView supports this unchanged. **iOS WKWebView only runs a service worker for App-Bound Domains**, which is a binary change (`WKAppBoundDomains` + `limitsNavigationsToAppBoundDomains`) → a store release, recorded in `offline-architecture.md` and as an open item. Until then iOS has the durable queue and local DB while the app is open, and a cold launch with no network still lands on `offline.html`. This is the largest constraint and is reported as such.

**D2 — Local database.** IndexedDB, behind an `OfflineDatabase` interface, with one store per domain (server cache, mutations, pending files, sync metadata, workspace metadata — never one JSON blob). Why not SQLite now: it needs a native plugin (binary change), and no device is available to prove persistence, migration and encryption behaviour. The interface is the seam for a SQLCipher adapter later. Durability: `navigator.storage.persist()` is requested when the first offline work is saved. Photos on native go to the app's private `Directory.Data` via `@capacitor/filesystem`; in a browser they are Blobs in IndexedDB.

**D3 — Offline authorisation window.** The server returns an authorisation snapshot with `validatedAt` and `offlineAccessExpiresAt`. Window = `NESTO_OFFLINE_AUTH_HOURS`, default **72**, clamped 1–336; a product/security owner must confirm it (PRD §62). After expiry: cached protected data is **locked** (unreadable through the UI, key not released), pending work is **kept** and syncs after the same user re-authenticates.

**D4 — Encryption.** AES-GCM-256 per record payload (WebCrypto). The key: on native a random key in Keychain/Keystore via secure-storage; in a browser a non-extractable `CryptoKey` kept in IndexedDB (documented as weaker — no hardware backing). Identifiers and sync states needed for indexing stay in clear; business content is encrypted. The database name is scoped by user id, so two identities on one device never share a store. No key in JavaScript source.

**D5 — Sync API.** One `POST /api/sync` batch endpoint that authenticates through `withContext` and dispatches each operation to a **module adapter** that calls the canonical service (`createDailyLog`, `updateDailyLog`, `submitDailyLog`, `createComment`, `startTask`, `completeTask`, `createIncident`, evidence link). It never writes a status. Each operation is isolated: one failure does not affect the others. Results carry `operationId, result, canonicalEntityId, serverVersion, errorType`.

**D6 — Idempotency.** `SyncOperation` ledger, unique on `(memberId, operationId)`, stores the result of a successful operation and a hash of its payload. Crash window (service committed, ledger not): creates carry `clientOperationId` on the record (`Comment`, `HseIncident`; `DailyLog` is unique by day; uploads use `Idempotency-Key`), and state transitions treat "already in the target state, by this member" as success.

**D7 — Conflicts.** Optimistic concurrency with `expectedVersion`. Mismatch → `CONFLICT` → the operation moves to **Needs Review**. Comments and independent photo evidence are append-only and never conflict. No last-write-wins, no "overwrite server" action.

**D8 — Time.** Server timestamps are canonical. Device capture time is stored as `capturedAt` metadata and never trusted.

**D9 — Native parity.** Everything runs in the WebView and uses `getPlatformServices()` where it differs (secure storage, filesystem, network), so web and native share one implementation.

## 3. Safe-for-offline records

Derived in `offline-capability-matrix.md`. Summary: read — projects, tasks, units, daily logs, selected documents; write — daily log create/update/submit, task comment, task start/complete, HSE incident, photo evidence. Online only — claim, approvals, finance, HR, sales reservation, meetings, section entries.

## 4. Backend gaps to close

1. `SyncOperation` ledger + `Comment.clientOperationId`, `HseIncident.clientOperationId`.
2. `/api/sync` (batch), `/api/sync/authorization`, `/api/sync/projects/:id/package`, `/api/sync/changes`, `/api/sync/documents`.
3. Sync protocol version in the compatibility contract.
4. Sync counters.

## 5. Explicit scope limits of this delivery

- Daily-log **section entries** (weather, workforce, equipment, deliveries …) are not queued; only top-level fields, photos and submit are. They need a per-section adapter each and are listed as deferred.
- Project package does not include Units beyond the summary, nor any Finance/HR data.
- Real-iPhone and real-Android acceptance items (PRD §158, §159) cannot be run from this environment and stay open.
- SQLCipher adapter and iOS app-bound-domain service worker are store-release work.
