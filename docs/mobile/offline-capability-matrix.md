# Offline capability matrix

Derived from the repository (see the [audit](MOB-09-offline-readiness-audit.md)). "Queued" means the change becomes a `MutationQueue` entry and is replayed through the canonical service. Nothing is writable offline unless it has a row here and an adapter in `lib/core/sync/adapters`.

| Capability | Offline read | Offline create | Offline edit | Sync | Notes |
| --- | :-: | :-: | :-: | :-: | --- |
| Projects | ✓ downloaded | — | — | pull | Only projects the user marked Available Offline. |
| Project permission snapshot | ✓ | — | — | pull | Never authority; revalidated before replay. |
| Tasks | ✓ downloaded (assigned/relevant) | — | `start`, `complete` queued | push + pull | Through `startTask` / `completeTask` with `expectedVersion`. |
| Task claim | — | — | ✕ | — | Concurrency-sensitive: "Connect to the internet to claim this task." |
| Task block / reopen / archive / edit fields | ✓ | — | ✕ | — | Not queued; reason/permission checks need live state. |
| Task comments | ✓ downloaded | ✓ queued | — | push | `clientOperationId` makes a retry exact-once. |
| Daily log (Site Diary) | ✓ downloaded + local | ✓ queued | ✓ draft top-level fields | push + pull | Create is unique per project/day. Submit is queued ("Submission queued"). |
| Daily log section entries | ✓ | ✕ | ✕ | — | Deferred: one adapter per section. |
| HSE incident | ✓ own list | ✓ queued | ✕ | push | Shows "stored on this device, NOT reached the server". |
| Photos / evidence | ✓ local + synced | ✓ queued | — | push | Upload via existing 3-step flow, stable `Idempotency-Key`. |
| Documents | selected only | ✕ | ✕ | pull metadata | Stored version compared with current; `supersededAt` → SUPERSEDED. |
| Units | ✓ summary | ✕ | ✕ | pull | Status is a snapshot, marked stale. |
| Unit reservations / sales | ✕ | ✕ | ✕ | — | Online canonical validation only. |
| Approvals | cached view only | ✕ | ✕ | refresh | Approve/Reject need connectivity. |
| Finance | ✕ | ✕ | ✕ | — | Needs a separate security design. |
| HR (salary, contracts, sensitive) | ✕ | ✕ | ✕ | — | Online required. |
| Calendar / meetings | ✓ previously loaded | ✕ | ✕ | pull | Read-only. |
| Notifications | ✓ previously loaded | — | — | pull | Marked not-current when offline. |
| Search | downloaded tasks, units, documents | — | — | — | "Searching downloaded data only". |
| Dashboard / My Day | ✓ with "last synced" | — | — | — | Stale counters are labelled. |

## Mutation types

| Type | Canonical call | Depends on | Conflict rule |
| --- | --- | --- | --- |
| `SITE_DIARY_CREATE` | `createDailyLog` | — | existing day → same log returned, not a conflict |
| `SITE_DIARY_UPDATE_DRAFT` | `updateDailyLog` | create | version mismatch → Needs Review |
| `ATTACHMENT_CREATE` | upload flow + `setEvidenceMeta` | create, file | none (append-only) |
| `SITE_DIARY_SUBMIT` | `submitDailyLog` | create, update, attachments | status no longer draft → Needs Review |
| `TASK_COMMENT_CREATE` | `createComment` | — | none (append-only) |
| `TASK_ALLOWED_UPDATE` (`start`, `complete`) | `startTask` / `completeTask` | — | version mismatch → Needs Review |
| `HSE_CREATE` | `createIncident` | — | none |
