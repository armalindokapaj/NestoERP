# Local database (MOB-09 §19-§21, §106-§108)

`OfflineDatabase` (`lib/offline/database.ts`) — one IndexedDB per signed-in person, named `nesto-offline:<userId>`. Two people on one device share nothing, and no query has to remember to filter by user.

## Stores

| Store | Concern | Key | Plain (indexed) fields | Sealed |
| --- | --- | --- | --- | --- |
| `cache` | Server cache | `[projectId, kind, id]` | company, kind, content token, `syncState`, last sync | the record |
| `mutations` | Pending mutations | operation id | company, project, type, target, dependencies, state, retry count, next attempt, error class | label, payload, expected version, error message, conflict detail |
| `files` | Pending files | file id | mutation, project, state, size, progress, upload key | name, type, caption, bytes (sealed separately) |
| `projects` | Offline project registry | project id | status, size, last sync | name, code, content tokens, revoked flag |
| `documents` | Downloaded documents | `[projectId, documentId]` | version id/number, size, downloaded-at | name, file name, type; bytes sealed separately |
| `idmap` | Local → server identity and version tracking | local or server id | server id, version, foreign flag | — |
| `meta` | Sync metadata and workspace metadata | key | — | value (authorisation snapshot, last sync, document checks, clock high-water) |

`CacheKind` is `tasks | units | dailyLogs | dailyLogDrafts | documents | comments`. Sync states are `SYNCED, LOCAL_ONLY, PENDING, SYNCING, FAILED, CONFLICT, STALE` — synchronisation states only, never business statuses.

## Schema versioning

`OFFLINE_SCHEMA_VERSION = 1`. `MIGRATIONS[n]` produces version `n`; an open of an older database runs each missing step in order. A step only adds; none may drop a store that holds mutations or files. If opening fails, the runtime reports the device as unsupported — it never deletes and recreates the database, because it may hold unsynced work (§108).

Adding version 2:

1. Add `MIGRATIONS[2]`, bump `OFFLINE_SCHEMA_VERSION`.
2. Extend `tests/unit/offline/database.test.ts` with a v1 database that has a pending mutation and a pending file, open it at v2, and assert both survive.

## Removal rules

`clearProjectCache` deletes synchronised or stale cache only. `removeProjectDownload` is refused while any mutation for the project exists (`UnsyncedWorkError`). Nothing evicts pending mutations, files or drafts automatically.

## Known limits

- IndexedDB in a WebView can be evicted under OS storage pressure. `navigator.storage.persist()` is requested as soon as there is unsynced work or a downloaded project; where it is refused, the Sync Center is the warning.
- Sealed sizes are what Offline & Storage reports.
- A SQLCipher adapter behind the same interface is the natural next step once a device test bed exists.
