# Notification templates

Presentation lives with the event definition, not in business services: each registry entry has `title(payload)` and optional `body(payload)`. Payloads carry ids and minimal labels (record name, actor name, due date), never whole records.

## Two renderings

| Surface | Source | Rule |
|---|---|---|
| In-app Notification Center | the stored `title`/`body` | Authenticated; full text. If the reader can no longer open the record, the text is withheld (`WITHDRAWN_TITLE`). |
| OS push (lock screen) | `renderPushText` at send time | By privacy class (below); the body of mentions and comments is never sent. |

## Privacy classes (`push.privacy.ts`)

| Class | What the OS shows | Applies to |
|---|---|---|
| PUBLIC_PREVIEW | the event title (and body, except mentions/comments) | tasks, meetings, calendar, HSE, daily logs, planning, announcements, documents, engineering, contractors, QA/QC |
| LIMITED_PREVIEW | a generic line for the kind of item ("An approval needs your attention"), no record name | approvals, procurement, sales, timesheets, organization |
| SENSITIVE | "You have a new notification" | HR, finance, legal/contracts, and any event starting `UNIT_CONTRACT`, `UNIT_PAYMENT`, `UNIT_INSTALLMENT`, `EMPLOYMENT_`, `EMPLOYEE_`, `QUALIFICATION_`, `LEAVE_`, `CONTRACT_` |

Every registered event resolves to a class (enforced by `tests/unit/notifications/push.test.ts`). Per-event overrides go in `SENSITIVE_PREFIXES` or by category.

## Localisation

The stored title is English text produced at dispatch. Template keys/parameters are not yet stored (PRD §138 wants localisation readiness): the registry functions are the single place to convert to keyed messages later; the push generic strings are constants in `push.privacy.ts`. Actor names come from the current person record at read time (`actorMemberId`), not from stored text.
