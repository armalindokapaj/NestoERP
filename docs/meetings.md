# Meetings

Per PRD #40. A meeting is a structured operational record — agenda, minutes,
decisions, actions — not a calendar appointment. The calendar shows it; the
meeting owns it.

```
Calendar = when      Meeting = the record      Minutes = the formal account
Decision = what was agreed      Action = what must happen      Task = the work
```

## Data

| Table | Holds |
|---|---|
| `meetings` | one meeting (or one occurrence of a series): type, status, times + zone, place, visibility, project/department, organizer, minutes status, `version` |
| `meeting_series` | a repeating meeting's template and rule; occurrences are real `meetings` rows |
| `meeting_participants` | members on a meeting: role, reply (`response`), required, actual `attendance`, name snapshot |
| `meeting_agenda_items` | ordered topics with presenter, planned minutes, discussed/skipped/deferred |
| `meeting_minutes_sections` | the minutes, section by section, plain text |
| `meeting_decisions` | D-01, D-02… per meeting; withdrawn decisions are archived and their number is never reused |
| `meeting_action_items` | commitments with owner, due date, status and at most one `linkedTaskId` (unique) |
| `calendar_reminders.meetingId` | meeting reminders reuse the calendar's reminder table and delivery rows (a CHECK keeps exactly one of `eventId`/`meetingId`) |

Documents and discussion use the shared record registry type `meeting`
(`lib/core/records/record.registry.ts`): files need `document.view` +
`meeting.document.view` (upload: `document.create` + `meeting.document.create`)
and the meeting itself; comments need the meeting.

## Lifecycle

```
DRAFT ──schedule──► SCHEDULED ──start──► IN_PROGRESS ──complete──► COMPLETED
  └──────cancel──────┴──────────cancel────────┘
Minutes: DRAFT ──finalize (meeting COMPLETED)──► FINAL ──reopen (reason, audited)──► DRAFT
```

Every transition is a conditional write on the current status, so a double
click is a 409, not a second transition. Edits carry `version`; a stale version
is `409` with `details.code = "STALE_VERSION"` and the form offers "Reload latest".
A cancelled meeting is never reactivated — duplicate it.

## Who may do what

`lib/modules/meetings/meeting.permissions.ts`. A permission is necessary, never
sufficient: it is combined with the reader's part in the meeting and its state.

| Visibility | Who can open it |
|---|---|
| `PARTICIPANTS` | the organizer and the people on it |
| `PROJECT` | also everyone who can open the project |
| `DEPARTMENT` | also that department's members (and `meeting.manage` holders) |
| `COMPANY` | also every member with `meeting.view` |

A draft is visible only to its organizer. Being on a meeting shows it and nothing
else; a project an invitee cannot open is not named to them. Free/busy never opens
a meeting.

| Action | Needs |
|---|---|
| edit, schedule, cancel | organizer + `meeting.edit`/`meeting.cancel`, or `meeting.manage`; after completion only `meeting.manage`, and only while minutes are a draft |
| start, complete | organizer or chair + `meeting.edit`, or `meeting.manage` |
| participants, organizer transfer | organizer + `meeting.manage_participants`, or `meeting.manage` |
| agenda | organizer/chair/secretary + `meeting.agenda.manage` |
| minutes | organizer/secretary + `meeting.minutes.edit`; finalize needs `meeting.minutes.finalize`; reopen needs `meeting.minutes.reopen` (MANAGE ladder) |
| decisions, new actions | organizer/chair/secretary + the permission, while the meeting is under way or held and minutes are a draft |
| action status | `meeting.action.manage` (organizer/chair/secretary), or the action's own owner; a linked action follows its task |
| action → task | `meeting.action.convert_to_task` + `task.create`, then the Task service's own assignee and project rules |
| reply | any participant except the organizer, even read-only |

## Series

A repeating meeting creates concrete occurrences up to 90 days ahead (at most
100 at once). The `meetings.series` job (scheduled group, every 6 h) tops each
open series up to the horizon, copying people, agenda and reminders from the
latest occurrence; occurrences are keyed `(seriesId, occurrenceIndex)`, so
reruns create nothing twice. One invitation announces a series; generated
occurrences notify nobody. Edits and cancellations apply to *this meeting* or
*this and later meetings*; moving later meetings to another day is refused —
change one meeting, or end the series and start another.

## Actions and tasks

`convertActionToTask` calls `createTaskFromContext` (parent `meeting`, grant
`meeting.action.convert_to_task`), then claims the link with a conditional write
on `linkedTaskId IS NULL` plus the unique index. A task created by the losing
side of a race is archived at once. The Task service calls
`syncActionFromTask` inside its own transaction: completed → DONE (organizer is
told), reopened → OPEN, in progress/blocked → IN_PROGRESS, reassigned → new
owner. An overdue unlinked action raises the `MEETING_ACTION_OVERDUE` attention
item for its owner; linked ones are left to the task's own overdue item.

## Notifications (category `meetings`)

`MEETING_INVITED` (new participants; email template `meeting.invitation`,
off by default) · `MEETING_UPDATED` (time, place, link or project changed) ·
`MEETING_CANCELLED` · `MEETING_REMINDER` (calendar reminder job, default 30 min)
· `MEETING_RESPONSE_CHANGED` (organizer) · `MEETING_MINUTES_FINALIZED`
(participants) · `MEETING_ACTION_ASSIGNED` (owner; skipped when a task is created
with it) · `MEETING_ACTION_COMPLETED` (organizer). The dispatcher re-reads the
meeting as each recipient before delivering.

## Audit and privacy

`MEETING_CREATED/UPDATED/SCHEDULED/STARTED/COMPLETED/CANCELLED`,
`MEETING_PARTICIPANT_ADDED/REMOVED`, `MEETING_ORGANIZER_CHANGED` (required),
`MEETING_MINUTES_FINALIZED/REOPENED` (required), `MEETING_DECISION_CREATED`,
`MEETING_ACTION_CREATED`, `MEETING_ACTION_TASK_CREATED` — ids, counts and field
names only. Minutes, agenda text and comments never reach audit or logs, and
global search indexes titles, types, dates and projects only. Minutes are plain
text rendered as text nodes; online links must be `https:` without credentials.

## Routes

UI: `/meetings` (Upcoming), `/meetings/mine`, `/meetings/past`,
`/meetings/actions`, `/meetings/new[?projectId&date&time]`, `/meetings/[id]`
(`?tab=agenda|minutes|actions|documents|activity`), `/meetings/[id]/edit`,
`/meetings/[id]/print`, `/meetings/[id]/documents`,
`/projects/[id]/meetings`; dashboard widgets `upcomingMeetings`,
`myMeetingActions`.

API: `GET|POST /api/meetings`, `GET /api/meetings/actions`,
`GET /api/meetings/options[?q]`, `GET|PATCH /api/meetings/:id`,
`POST /api/meetings/:id/{schedule,start,complete,cancel,duplicate,respond,organizer}`,
`POST /api/meetings/:id/participants`, `PATCH|DELETE …/participants/:memberId[?scope=FUTURE]`,
`POST …/agenda`, `PATCH|DELETE …/agenda/:itemId`, `POST …/agenda/{reorder,template}`,
`POST …/minutes/sections`, `PATCH|DELETE …/minutes/sections/:sectionId`,
`POST …/minutes/{finalize,reopen}`, `POST …/decisions`, `PATCH|DELETE …/decisions/:id`,
`POST …/actions`, `PATCH …/actions/:id`, `POST …/actions/:id/{create-task,complete}`,
`GET …/activity`. Availability for the form: `GET /api/calendar/availability?…&excludeMeetingId=`.

## Operations

* Meetings is a switchable module: existing companies get it through
  Settings → Modules (the seed enables it for demo companies). Run
  `tsx scripts/access-sync.ts` after deploying.
* Metrics: `meeting_create_success_count`, `meeting_create_failure_count`,
  `meeting_rsvp_count`, `meeting_minutes_finalize_count`,
  `meeting_action_task_create_count`, `meeting_series_occurrences_generated_total`;
  provider time is `calendar_provider_duration_ms_total{provider="meetings"}`.
* Tests: `tests/api/meetings/meetings-service.test.ts`,
  `tests/e2e/modules/meetings.spec.ts`, `tests/e2e/responsive/meetings-mobile.spec.ts`.
