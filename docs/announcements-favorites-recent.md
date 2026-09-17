# Announcements, Favorites & Recent Work (PRD #45)

The shared productivity layer: intentional internal communication, personal
shortcuts, and a way back to what you were working on. None of it is another
business domain, and none of it opens a door.

```
Announcement = a published one-to-many notice      (≠ notification, ≠ chat, ≠ legal acceptance)
Favorite     = a personal shortcut                  (grants nothing; hidden once access is lost)
Recent Work  = records a member opened lately       (≠ browser history, ≠ audit, ≠ activity; prunable)
```

## Where things live

| Concern | Location |
| --- | --- |
| Types, safe rich text, validation | `lib/modules/announcements/announcement.{types,body,schema}.ts` |
| Audiences and grants | `lib/modules/announcements/announcement.permissions.ts` |
| Drafts, edits, feed, detail, read, acknowledge, metrics, shell and dashboard | `lib/modules/announcements/announcement.service.ts` |
| Publish, schedule, pin, archive; jobs `announcements.schedule` and `announcements.reminders` | `lib/modules/announcements/announcement.publish.ts` |
| Calendar | `lib/modules/announcements/announcement.calendar-provider.ts` |
| Navigable record registry | `lib/modules/productivity/navigable.registry.ts` |
| Favorites | `lib/modules/productivity/favorites.service.ts` |
| Recent work; job `recentwork.prune` | `lib/modules/productivity/recent-work.service.ts` |
| Company switches | `lib/modules/productivity/productivity.settings.ts` |
| API | `app/api/announcements/**`, `app/api/favorites/**`, `app/api/recent-work/**`, `app/api/productivity/{palette,settings}` |
| UI | `app/(nesto)/announcements/**`, `app/(nesto)/favorites`, `components/announcements/*`, `components/productivity/*`, the command palette, topbar and app shell |

## Data

- **Announcement** — title (≤ 180), body (≤ 50,000; safe rich text), status
  `DRAFT → SCHEDULED → PUBLISHED → EXPIRED`, `ARCHIVED` from any; priority
  `NORMAL`, `IMPORTANT`, `CRITICAL`; audience `COMPANY`, `DEPARTMENT`,
  `PROJECT`, `SELECTED_MEMBERS`; author and publisher; publish, published,
  expiry and expired times; pinned; acknowledgment required; event start and
  end; `editedAt` for corrections after publishing; `version`.
- **AnnouncementAudienceMember** — the people named on a selected-members notice.
- **AnnouncementRead** — first and last read per member. Never an audit event.
- **AnnouncementAcknowledgment** — "I have read this", per member.
- **AnnouncementTarget** — who was asked to acknowledge, captured at publication.
- **UserFavorite** / **RecentItem** — per company membership, keyed by a
  registered record type; recent items carry the last access and a count.
- **ProductivitySettings** (company) — announcements, favorites and recent work
  on; recent work kept 90 days; acknowledgment reminders every 3 days; ordinary
  announcements not notified.

## Safe rich text

`# ## ###` headings, paragraphs, `**bold**`, `*italic*`, `- ` and `1. ` lists,
`> ` callouts and `[links](https://…)`. The body is parsed into a tree and
rendered as React elements — markup is never inserted as HTML, and a link whose
target is not `http`, `https`, `mailto` or an in-app path is shown as text.

## Audiences and access

Visibility is a where-clause, applied in every query (feed, detail, search,
calendar, dashboard, registry):

| Audience | Readers |
| --- | --- |
| Company | Everyone with `announcement.view` |
| Department | Members of the department, and holders of `announcement.manage_department` |
| Project | People who can open the project (projects module, `project.view`, project scope) |
| Selected members | Exactly the people named |

Readers see published and expired announcements. Drafts, schedules, archived
announcements, metrics and the acknowledgment list belong to the author and to
the managers of that audience. An audience never grants access to the project
or department behind it.

| Role | Addresses |
| --- | --- |
| Owner | Company, department, project, selected members |
| CEO, HR | Company, department, selected members |
| Group IT | Company (technical notices) |
| Project Manager | Projects in their scope, selected members |
| Everyone else | Reads and acknowledges |

`announcement.create` writes a draft; `announcement.publish` publishes,
schedules and cancels a schedule; `announcement.pin` and
`announcement.archive` are separate grants.

## Rules

| Rule | Code |
| --- | --- |
| The audience is one this author may address, in this company — checked on save and again at publication | `ANNOUNCEMENT_AUDIENCE_FORBIDDEN`, `ANNOUNCEMENT_PROJECT_INVALID`, `ANNOUNCEMENT_DEPARTMENT_INVALID`, `ANNOUNCEMENT_MEMBERS_INVALID` |
| Expiry after publication; event end after start | `ANNOUNCEMENT_EXPIRY_INVALID`, schema |
| A schedule is in the future | `ANNOUNCEMENT_PUBLISH_AT_PAST` |
| Only one transition out of a draft or schedule succeeds | `ANNOUNCEMENT_STALE` |
| At most three pinned per audience (company, a project, a department) | `ANNOUNCEMENT_PIN_LIMIT` |
| A published announcement keeps its audience and its acknowledgment requirement | `ANNOUNCEMENT_AUDIENCE_LOCKED`, `ANNOUNCEMENT_ACK_LOCKED` |
| Content is corrected (marked "Updated") until someone acknowledges it | `ANNOUNCEMENT_ACKNOWLEDGED_LOCKED` |
| Expired and archived announcements are read-only | `ANNOUNCEMENT_READ_ONLY` |
| Acknowledgment only while live, only by someone in the audience, only for oneself | `ANNOUNCEMENT_NOT_LIVE`, `ANNOUNCEMENT_NOT_IN_AUDIENCE`, `ANNOUNCEMENT_ACK_NOT_REQUIRED` |
| A read is recorded when the detail has loaded, never from a card | — |

**Publishing** is one transaction: status and time, acknowledgment targets
(the audience at that moment, minus the author), the audit entry, activity and
the notification event. **The schedule worker** publishes due announcements
and expires past-expiry ones, each guarded by the status it leaves.

## Notifications, attention, jobs

| Event | When | To |
| --- | --- | --- |
| `ANNOUNCEMENT_CRITICAL` (mandatory in-app, email by default) | A critical announcement is published | The audience |
| `ANNOUNCEMENT_ACK_REQUIRED` | An announcement asking for acknowledgment is published | The targets |
| `ANNOUNCEMENT_PUBLISHED` | An important one — or an ordinary one when the company asks | The audience |
| `ANNOUNCEMENT_REMINDER` (job, one round every few days) | Still unacknowledged | Pending targets |

Attention `ANNOUNCEMENT_ACK_REQUIRED` — important and critical announcements,
for each target still to acknowledge; critical ones cannot be dismissed; an
acknowledgment resolves the member's item at once, expiry or archive resolves
all. Jobs: `announcements.schedule` (every minute), `announcements.reminders`
(hourly), `recentwork.prune` (daily).

## Favorites and recent work

One allowlist, `NAVIGABLE_TYPES`: project, milestone, task, meeting, daily log,
client, document, contract, purchase order, invoice. Each type resolves in one
query per request through its module's door and scope; anything the member
cannot open right now is left out — never shown as "restricted".

- **Favorites** — added only to a record the member can open (`FAVORITE_NOT_FOUND`),
  idempotent, at most 100 (`FAVORITES_LIMIT`), removed with one click. Stars sit
  on the project, task, client, document, meeting, contract, purchase order,
  invoice and daily log pages and in the milestone drawer.
- **Recent work** — written after the response of those pages (and when a
  milestone drawer opens), at most once per record per member every ten
  minutes, only for records the member can open. Cleared by the member; pruned
  past the company's retention and past the hundred newest.

Neither is audited, and nobody else — managers included — can see them.

## Experience

- `/announcements` — For Me, Pinned, Unread, To Acknowledge, History and, for
  writers, Manage (with the company switches for the company's authority).
  Hairline cards with scope, priority, author, date, excerpt, attachments and
  what the notice asks. Search, priority, scope and status filters.
- `/announcements/new`, `/announcements/:id/edit` — title, audience, priority,
  body with a small formatting toolbar and live preview, then expiry, event,
  pinning and acknowledgment; static starting points (general, project,
  training, office closure, policy update). "Announce" on a project starts a
  project announcement.
- `/announcements/:id` — editorial reading layout: scope, priority, a large
  title, author and date, the event, body, attachments, and "I have read this"
  (sticky on a phone) → "Acknowledged • date, time". Managers see publish,
  schedule, pin, duplicate and archive, the reach counts and who has or has not
  acknowledged.
- **Shell** — a megaphone beside the bell with a dot for unread announcements,
  and a single banner for the newest critical announcement still waiting —
  dismissible only when it asks for no acknowledgment.
- **Dashboard** — Announcements, Favorites and Recent Work widgets on every role.
- **Command palette** — Favorites and Recent above search results; results the
  member starred carry a star.
- `/favorites` — Favorites (search; recently favorited, A–Z or by type) and
  Recent Work (relative times, forget one, clear all).

## Also connected

- **Record registry** `announcement` — attachments through the canonical
  document pipeline, added by its managers while it is live; no discussion.
- **Calendar** — provider `announcements`: only announcements with an event date.
- **Search** — title, body, project and department of announcements in the
  reader's audience.
- **Audit** — created, updated (with whether it was material), scheduled,
  published, expired, archived, pinned, unpinned, acknowledgment requirement
  changed, settings.

## Seed

Company A: a pinned company announcement, an important Riverside notice with a
crane lift event, a Finance department timetable, an office closure scheduled
three days ahead, and an important site access policy asking the company to
acknowledge it — three have, some have read it. The Engineer and Project
Manager have favorites and recent records. Company B has one announcement.

## Tests

| Suite | Covers |
| --- | --- |
| `tests/unit/announcements` | Grants by role, audience where-clauses, safe rich text, validation, the navigable allowlist |
| `tests/api/announcements` | Drafts, publishing and races, audiences and isolation, read state, acknowledgment and targets, attention, reminders, schedule and expiry workers, pinning, edit locks, archive, critical notices and the banner, calendar, search, attachments |
| `tests/api/productivity` | Favorites (add, duplicate, lost access, archived, cross-company, limit, switch), recent work (debounce, order, access, prune, clear), batched resolution |
| `tests/e2e/modules/announcements.spec.ts` | Company announcement and read state; required acknowledgment with attention and metrics; project audience; scheduled publishing; favorites and access; recent work order |
| `tests/e2e/responsive/announcements-mobile.spec.ts` | Critical banner, sticky acknowledgment and attachment on a phone; favorite from the dashboard |
| `tests/perf/announcements.perf.test.ts` | 1,000 announcements, 20,000 read and acknowledgment rows, 100 favorites and recent items (`NESTO_PERF=1`) |
