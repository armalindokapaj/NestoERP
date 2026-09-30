# Conflict resolution (MOB-09 §74-§82)

A conflict exists when the device's pending work and the server's state cannot safely be reconciled automatically. The server decides; the device never "wins".

## Detection

- **Optimistic concurrency.** Changes that state a version send `expectedVersion`. Tasks use `Task.version` (AUD-02); daily logs use `DailyLog.version`. A mismatch is a `CONFLICT` result carrying `current {status, version}`.
- **Own versus foreign.** Between its own changes the device carries the version forward. Each own change moves it by exactly one, so a larger jump means someone else changed the record; later versioned changes on it are not sent and go to Needs Review (`CHANGED_WHILE_OFFLINE`).
- **State, not just version.** The canonical service still applies: a log that is no longer a draft, an archived task, a locked record refuse the change as `CONFLICT`/`VALIDATION`.

## What resolves by itself (no conflict screen)

| Change | Why it is safe |
| --- | --- |
| Task comment | append-only; coexists with any number of newer comments |
| Diary section row (work, workforce) | append-only |
| Photo evidence | independent documents; linking is idempotent |
| Starting the day's diary | one log per project/day; the existing one is returned |
| A retry of something already applied | the ledger returns the stored result |

## What needs a person

| Situation | Result |
| --- | --- |
| Complete/Start a task whose version or state moved | `NEEDS_REVIEW` |
| Edit or submit a diary that someone else changed | `NEEDS_REVIEW` |
| Submit a diary that is locked, or has nothing to submit, or no reviewer | `CONFLICT` / `VALIDATION` with the service's own words |

## The screen

Sync Center → **Review** opens *Sync conflict*: which record, the server's status and version, and the action that is pending. Two choices: **Discard pending action** (removes it and what depends on it), or **Review record**, which opens the record as it stands (online only). There is no "overwrite server" and no latest-timestamp-wins anywhere in the code.

Field-level comparison for edited drafts is not built: the dialog names the pending action and the server's state, and the person reads the record before re-entering anything. This is listed under known limitations.

## Tests

`tests/unit/offline/engine.test.ts` (conflict, foreign change, blocked followers) and `tests/api/sync/sync.test.ts` (stale version, archived task, locked diary, empty diary) against the real services.
