# Mutation queue (MOB-09 §29-§35, §93, §99, §101)

Every offline write is one record in the `mutations` store. It is never an HTTP request to replay: the server dispatches by type.

## Record

| Field | Meaning |
| --- | --- |
| `id` | the operation id (`op_<uuid>`) — the change's identity, sent on every attempt |
| `userId`, `companyId`, `projectId` | who and where it was made; never reassigned |
| `type` | one of the types below |
| `targetType`, `targetId` | the record acted on; `local:<kind>:<uuid>` until the server has made it |
| `dependsOn` | operation ids that must be applied first |
| `state` | `PENDING, SYNCING, APPLIED, FAILED, NEEDS_REVIEW` (`BLOCKED` is derived, not stored) |
| `retryCount`, `nextAttemptAt` | back-off |
| `errorType`, `errorCode` | class and service code |
| sealed | label, payload, expected version, error message, conflict detail |

## Types

| Type | Canonical call | Dependencies | Notes |
| --- | --- | --- | --- |
| `SITE_DIARY_CREATE` | `createDailyLog` | — | one log per project/day: a second device lands in the same log |
| `SITE_DIARY_UPDATE_DRAFT` | `updateDailyLog` | create | partial: only named fields; replaces a pending edit instead of stacking |
| `SITE_DIARY_ADD_ENTRY` | `addEntry` (any section) | create | append-only |
| `ATTACHMENT_CREATE` | upload flow + `setEvidenceMeta` | create | bytes in the `files` store; stable upload key |
| `SITE_DIARY_SUBMIT` | `submitDailyLog` | everything earlier on the diary | "Submission queued" until confirmed |
| `TASK_COMMENT_CREATE` | `createComment` | — | `clientOperationId` |
| `TASK_ALLOWED_UPDATE` | `startTask` / `completeTask` | — | `claim`, `block`, `reopen`, `archive`, edits are refused offline |
| `HSE_CREATE` | `createIncident` | — | `clientOperationId`; alerts fire when the server first holds it |

## Rules

- **Discard** removes a change and everything that depends on it, and its photo bytes. It is refused while a change is being sent.
- **Retry** puts a FAILED change back without waiting out its back-off.
- **Remove offline project** is refused while any change for the project exists; **logout** and **account switching** ask first; a pending change is bound to the person who made it and is only ever sent when that person is the signed-in session.
- **App killed mid-send**: `SYNCING` changes go back to `PENDING` on start; the operation id makes the repeat exact-once.
- **Photos**: bytes are stored *before* the change that points at them, and the UI confirms only after both are written. Orphan bytes (a crash between the two) are swept at start.
