# Offline field work (MOB-09 §36-§55)

What a person can do with no connection, and what the screen says while it waits.

| Work | Offline | Says |
| --- | --- | --- |
| Read downloaded tasks, units, diaries, documents, comments | yes | "Offline · last synced 14:32", "Based on the last sync…" |
| Search | downloaded tasks and units only | "Searching downloaded data only" |
| **Site Diary**: start the day, notes, work completed, workforce, photos, submit | yes | "Saved on this device", "Waiting to sync", **"Submission queued"** — never "Submitted" until the server confirms |
| **Photos** | camera/library → sealed on the device, then uploaded | *Waiting to upload · Uploading 40 % · Upload failed [Retry]* |
| **Task comment** | yes | comment with *Waiting to sync* |
| **Task start / complete** | yes, through the task's own commands | "Completion waiting to sync" |
| **Task claim** | no | "Connect to the internet to claim this task." |
| **HSE report** | yes | "This report is stored on this device and has NOT reached the server yet." (stronger for high/critical: nobody responsible has been notified) |
| Approvals, Finance, HR, Unit reservations and sales, Meetings | no | need a connection |

## Site Diary details

- One diary per project and day. Starting a day that already has a diary — on the server or on this device — opens that one.
- A server draft the person downloaded can be edited (only *their own drafts*; other logs are read-only summaries).
- Editing unsynced notes replaces the pending edit. Rows and photos not yet sent can be removed; ones already on the server are edited online.
- Submit is queued behind everything the diary still has to send. The server applies the normal submission rules (something recorded, a reviewer, headcounts). If it refuses, the diary stays on the device with the reason and **Review**; nothing is lost.
- The server decides the reviewer and records server time; the device's capture time is carried as a time of day on the photo, never trusted as time.

## Photos

`addDiaryPhoto` returns only after the bytes are stored, so what is confirmed on screen survives closing the app. Each photo has one upload key for its whole life: a retry after a drop, a kill or a lost answer is the same upload, and the server answers with the document it already made. The upload is a single PUT; an interrupted one restarts safely. A failed photo is retryable on its own and does not hide the others; the diary's submission waits for it.

## HSE

Validation mirrors the service (type, severity, title, description, a time not in the future, immediate action for HIGH/CRITICAL). Serious reports raise their alerts when the server first holds them, never before.

## Not in this delivery

Daily-log sections other than Work and Workforce (weather, equipment, deliveries, visitors, delays, instructions) are supported by the server adapter (`SITE_DIARY_ADD_ENTRY` takes any section) but have no offline form yet. Editing an HSE incident, task fields, meeting changes and approvals are online only.
