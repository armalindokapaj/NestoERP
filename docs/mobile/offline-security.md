# Offline security (MOB-09 §56-§64, §97-§103, §124-§127)

## What is on the device

Only what an explicit **Available Offline** (or **Make Available Offline**) put there, for projects the person may open, read through the ordinary services in their own scope. Never: other companies' records, Finance, HR/salary/contracts, approvals decisions, people who are not relevant, or every project/document by default.

## Authorisation

- The server sends an **authorisation snapshot** (`GET /api/sync/authorization`): user, company, workspace, the permissions the offline screens use, `validatedAt`, `offlineAccessExpiresAt`, a fingerprint. It is refreshed at every pass.
- The snapshot decides what the device *shows*. It is never what lets a change in: every queued change is authorised again on the server, live, as the signed-in caller (`withContext`), then by the owning service.
- **Window.** `NESTO_OFFLINE_AUTH_HOURS` (default 72, clamped 1–336) — a product/security value that needs an owner's confirmation. After it passes the workspace **locks**: protected cached data is hidden, only counts are shown, and unsynced work is kept. The window is judged by a clock that cannot be wound back (the highest time ever seen is kept).
- **Access removed** while offline (a project, a role, a whole account): the next pull gets `403/404`; the project's cached data and downloaded documents are deleted from the device; unsynced work is kept and each change is refused by the server as `PERMISSION`, so the person sees "Your access to this project has changed — N unsynced items cannot be submitted. Contact your administrator."
- **Account disabled:** the session check answers 401, the existing session-lifecycle signs the person out; the local database stays sealed and is opened only by the same person signing in again.
- **Session expiry offline** does not destroy work: the queue is bound to the person, and resumes when that person signs in.

## Isolation

| Boundary | How |
| --- | --- |
| User | one database and one key per user id; an engine pass for a database whose owner is not the session user sends nothing (`identity-mismatch`) |
| Company | every change records its company; the server refuses a change whose claimed company is not the session's; changes for another company wait until that workspace is active; nothing is sent from the Group workspace |
| Project | a change is bound to its project when it is made and keeps it after the UI moves on |
| Demo impersonation | a switch is logout + login; the database is per user, so a new identity inherits nothing |

## Encryption

AES-GCM-256 per record (WebCrypto). Plain: ids, states, sizes, timestamps needed to index. Sealed: payloads, labels, names, captions, cached records, photo and document bytes, the authorisation snapshot. The key is never in source or bundle.

| Platform | Key |
| --- | --- |
| Native | 32 random bytes in Keychain / Keystore-backed secure storage (`@aparajita/capacitor-secure-storage`), imported as a non-extractable key. The shell's sign-out cleanup **keeps** `offline.key.*` so signing out never makes unsynced work unreadable. |
| Browser | a non-extractable `CryptoKey` in its own IndexedDB store. It cannot be read back, but it is not hardware-backed — a browser profile with an attacker's access to the running page is out of scope. |

`destroyKey` removes a person's key (their offline data becomes unreadable for good) — used only when they discard an account's offline data.

## Sign-out, switching, removal

- **Sign-out with unsynced work** (this account, or another account on the device): *"You have N unsynced items. Logging out may prevent these items from being submitted."* — **Cancel**, **Review pending**; a small **Sign out anyway** is available because the work stays on the device, sealed, and sends when the same person signs in again. A forced sign-out (expired session) never prompts.
- **Remove offline project**: refused while unsynced changes, photos or conflicts exist.
- **Uninstalling the app** removes local data; unsynced work cannot be recovered. The Sync Center says how much is waiting.

## Files

Downloaded documents and captured photos are sealed inside the app's database, not in a public folder. **Export** is a separate, explicit action with ordinary OS consequences; "Available Offline" is not export. Nothing is written to the service worker cache except `/offline` and content-hashed build files.

## Observability

Counters by type and outcome only (`sync_operation_count`, `sync_batch_count`); logs carry code and type, never payloads.

## Not covered here

Screenshot blocking (MOB-11: sensitive surfaces only, see `docs/security/biometric-security.md`), Finance and HR offline (need their own security design), and hardware-backed keys in the browser.

## MOB-11 additions

The offline window and whether offline access exists at all come from the effective mobile policy (`offlineAuthorizationHours`, `offlineAllowed`), judged by server time. A revoked, lost or blocked device receives a data-removal instruction (`docs/security/data-removal.md`); until removal completes, `status.securityLock` keeps the sealed database closed and unsynced work cannot be sent.
