# Sync engine (MOB-09 §67-§73, §85-§89, §142-§148)

One engine for every module. Modules define *what* a change is (an adapter); the engine owns queueing, ordering, retry, error classes, and the pull. Nothing else has a retry loop.

## A pass (`SyncEngine.runOnce`)

```
0  offline? → stop ("offline")
1  GET /api/sync/authorization
     401 → paused-auth · 426 or protocol too old → paused-update
     snapshot.user ≠ database owner → identity-mismatch (nothing is sent)
     store snapshot + refreshed-at
2  rounds (≤ 25):   ready = selectReady(queue)   for the active company only
     server changes → POST /api/sync  (≤ 50 per request, in order)
     photos         → upload flow, one at a time
     apply each result
3  pull: POST /api/sync/projects/:id/package with the known tokens, for every offline project
     then document version checks
4  lastSyncAt recorded when nothing failed or conflicted
```

Concurrent triggers share one pass. The Sync Center's **Sync now** always runs; automatic triggers respect the Auto sync setting.

## Triggers

Connection restored (`ConnectivityService`), app resume/foreground, a change was queued (600 ms debounce), a project was downloaded, manual. There is no timer. `ConnectivityService` probes `/api/health/live` only while the answer is in doubt, with back-off 5 → 15 → 30 → 60 s, and not while the page is hidden.

## Ordering and identity

- A change waits for its `dependsOn` (a dependency that is no longer in the queue has been applied).
- A record made offline is `local:<kind>:<uuid>` until the server names it; the engine resolves the id when it sends, and records `local → server` in `idmap`.
- Versioned changes (`SITE_DIARY_UPDATE_DRAFT`, `SITE_DIARY_SUBMIT`, `TASK_ALLOWED_UPDATE`) never share a round with another change to the same record; they wait for earlier pending changes on it. The version they send is the one the device last saw or produced.
- Each own change moves a version by exactly one. A jump larger than that means someone else changed the record: it is marked `foreign`, and later versioned changes go to Needs Review instead of being sent.

## Error classes (§85, §86)

| Class | Source | Queue behaviour |
| --- | --- | --- |
| `NETWORK` | fetch threw | back to PENDING, back-off, no retry count; stop the pass |
| `SERVER_TEMPORARY` | 5xx, 429, `TEMPORARILY_UNAVAILABLE` | retry with back-off (2 s doubling to 5 min, ±25 %), FAILED after 8 |
| `AUTH` | 401, wrong workspace | PENDING, engine paused, sign in again |
| `PERMISSION` | 403/404, permission removed, record gone | FAILED — needs attention |
| `VALIDATION` | 422/428, service rule | FAILED — needs editing |
| `CONFLICT` | version or state moved | NEEDS_REVIEW |
| `FILE_ERROR` | upload refused (type, size, scan, locked log) | FAILED, photo kept |
| `UNSUPPORTED_VERSION` | 426, protocol below the server minimum | paused, nothing replayed |

## Server side

`POST /api/sync` (`lib/core/sync/sync.service.ts`): per operation — validate envelope → claimed company must equal the session's → version present where required → ledger lookup (same id + same hash → `DUPLICATE` with the stored result; same id + different hash → refused) → adapter → record success. Results: `APPLIED | DUPLICATE | CONFLICT | REJECTED | RETRY`, with `errorType`, `canonicalEntityId`, `serverVersion`, and on conflict `current {status, version}`. Counters: `sync_operation_count{type,outcome}`, `sync_batch_count` — never content.

## Diagnostics (§88)

Sync Center → Diagnostics: last successful sync, pending/failed/needs-review counts, database version, app version, sync engine version, protocol version, platform. No payloads.
