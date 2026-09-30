# Offline architecture (MOB-09)

Offline NESTO is a temporary working state. The server is canonical, and the device is a secure layer that carries field work back to it. It never becomes a second database that competes with NESTO.

```
                         NESTO SERVER  (canonical)
                              │
      ┌───────────────────────┼────────────────────────┐
      │ /api/sync  (POST)     │ /api/sync/authorization │ /api/sync/projects/:id/package
      │ dispatch → module     │ snapshot + window       │ /api/sync/documents
      │ adapters → services   │                         │ (read through ordinary services)
      └───────────────────────┴────────────────────────┘
                              │
                         SyncEngine  (lib/offline/engine.ts)
                              │
        ┌──────────────┬──────┴───────┬───────────────┐
   MutationQueue   Server cache   Pending files   Sync metadata
        └──────────────┴── OfflineDatabase (IndexedDB, sealed) ──┘
```

## Decisions (from the [audit](MOB-09-offline-readiness-audit.md))

| # | Decision | Why |
| --- | --- | --- |
| D1 | One product. A service worker keeps `/offline` and the immutable build assets; a page load that cannot reach the server gets that workspace. | The native shell is hosted (MOB-08): with no network the web app does not load. No second UI, no second API. |
| D2 | IndexedDB behind `OfflineDatabase`. | Structured, indexed, transactional, versioned; works in the WebView and the browser. A SQLCipher adapter is a native plugin and needs a device to prove. |
| D3 | Offline authorisation window: `NESTO_OFFLINE_AUTH_HOURS`, default 72, clamped 1–336. | Product/security decision; the default needs an owner's confirmation. |
| D4 | AES-GCM-256 per record; key in Keychain/Keystore (native) or a non-extractable `CryptoKey` (browser). | [offline-security.md](offline-security.md). |
| D5 | One batch endpoint; each change dispatched to its module adapter, which calls the canonical service. | `/sync` is never a bypass of permissions or state machines. |
| D6 | Operation ledger (`SyncOperation`) + `clientOperationId` on records that have no natural key. | Exact-once replay, even when a response is lost. |
| D7 | Optimistic concurrency (`expectedVersion`); conflicts go to Needs Review; append-only changes never conflict. | No last-write-wins, no "overwrite server". |
| D8 | Server time is canonical; device time is metadata. | §73, §123. |

## Where things live

| Concern | File |
| --- | --- |
| Wire contract (types, error classes, mutation list) | `lib/core/sync/protocol.ts` |
| Dispatcher, ledger, error mapping | `lib/core/sync/sync.service.ts`, `sync.ledger.ts`, `sync.errors.ts` |
| Module adapters | `lib/core/sync/adapters/*` |
| Authorisation snapshot | `lib/core/sync/authorization.service.ts` |
| Project package + refresh | `lib/core/sync/package.service.ts` |
| Document version status | `lib/modules/documents/versions/offline.service.ts` |
| Local database, crypto, keys | `lib/offline/database.ts`, `crypto.ts`, `keys.ts`, `idb.ts` |
| Queue, engine, errors, uploader | `lib/offline/queue.ts`, `engine.ts`, `errors.ts`, `uploader.ts` |
| Connectivity | `lib/offline/connectivity.ts` |
| Runtime (triggers, state for the UI) | `lib/offline/runtime.ts` |
| Offline projects, documents, security, diagnostics | `lib/offline/projects.ts`, `documents.ts`, `security.ts`, `diagnostics.ts` |
| Field modules | `lib/offline/modules/{diary,tasks,hse}.ts` |
| Service worker | `public/sw.js`, `lib/offline/service-worker.ts` |
| UI | `components/offline/*`, `app/(offline)/offline` |

## The offline workspace

`/offline` is a client-rendered page that reads only the local database, so the service worker can keep one copy of it. It has a small router of its own (`?view=…`), so moving around never asks the server. A page the person asked for that cannot load (`/projects/:id`, `/tasks/:id`) redirects to `/offline?from=…` and opens the nearest thing the device holds.

Online, everything is the ordinary NESTO. The shell adds a compact status pill (nothing shown while online with nothing to send), a sign-out guard, **Available Offline** on the project page, **Make Available Offline** on a document, and Offline & Storage in Settings.

## Platforms

| | Service worker (offline app load) | Local DB | Key storage | Photos |
| --- | --- | --- | --- | --- |
| Browser | yes | IndexedDB | non-extractable `CryptoKey` in IndexedDB | sealed Blobs in IndexedDB |
| Android WebView | yes | IndexedDB | Keystore-backed secure storage | same |
| iOS WebView | **only with App-Bound Domains** (binary change, open item) | IndexedDB | Keychain | same |

On iOS today the durable queue, database and sync work while the app is open; a cold launch with no network still shows the bundled `offline.html`. To enable the offline workspace there, add `limitsNavigationsToAppBoundDomains` and `WKAppBoundDomains` for the NESTO host in a store release, and test that framed document previews and Mapbox still work (they may not — it is why this was not switched on blind).

## What the layer deliberately does not do

- It does not cache API responses, pages (other than `/offline`) or documents in the service worker. Business data lives only in the encrypted database.
- It does not poll. Triggers are: connection restored, app foreground/resume, a change was queued, the person pressed Sync now, a project was downloaded.
- It does not make every module offline-capable: see the [matrix](offline-capability-matrix.md).
