# Calendar

Per PRD #39. The calendar is a permission-aware lens over NESTO's dates, not a
second copy of them.

## Architecture

```
module data ──► CalendarProvider (module's own permission + scope, range-bounded query)
                      │
               calendarProviders registry  (lib/modules/calendar/calendar.providers.ts)
                      │
               getCalendar()  bounded concurrency (5), 2.5 s per provider, failure isolation
                      │
               GET /api/calendar/events?from&to   (≤ 93 days)   ──► /calendar UI
```

* Calendar-owned records: `calendar_events`, `calendar_event_participants`,
  `calendar_reminders`, `calendar_reminder_deliveries`. Nothing else is stored:
  tasks, contracts, inspections, permits and leave stay with their modules.
* A provider never returns what its module would not show the reader. A disabled
  module's provider is not called. A provider failing for an ordinary reason is
  named in `meta.partialFailureProviders`; an authorisation error is not swallowed.
* A module keeps its provider in its own folder and is listed in the registry:
  meetings (#40) live in `lib/modules/meetings/meeting.calendar-provider.ts`.
  Project milestones (#44) follow the same pattern.

## Providers and the indexes they use

| Provider | Source | Dates | Index |
|---|---|---|---|
| `calendar` | `calendar_events` | start/end, recurrence expanded in range | `(companyId, startsAt)`, `(companyId, projectId, startsAt)`, `(companyId, departmentId, startsAt)`, `(companyId, visibility, startsAt)`, `(companyId, recurrenceEndsAt)` |
| `tasks` | tasks | due date (start date when no due date) | `tasks(companyId, dueDate)`, `(projectId)` |
| `hr` | approved leave | start–end | `leave_requests(companyId, status)`, `(startDate)`, `(endDate)` |
| `finance` | invoices (approved/sent, outstanding) | due date | `invoices(companyId, status)`, `(dueDate)` |
| `legal` | contracts, obligations, amendments | effective, expiry, termination, due, effective | `contracts(companyId, status)`, `contract_obligations(contractId)` |
| `procurement` | requests, RFQs, orders | required, responses due, delivery expected | `(companyId, status)` on each |
| `qaqc` | inspections, corrective actions, NCRs | inspection date, due dates | `(companyId, status)`, `(projectId)` |
| `hse` | inspections, toolbox talks, permits, risk assessments, actions | scheduled, talk date, valid until, review date, due | `(companyId, status)`, `(projectId)` |
| `documents` | pending reviews with a due date | review due | `document_reviews(companyId, status, dueAt)` |
| `hr-credentials` | employee documents and qualifications that run out (E-02 §92, §93): the reader's own, and HR's people | expiry date; named by kind, never by title | `employee_document_links(companyId, expiryDate)`, `person_qualifications(parentGroupId, personProfileId)`, `(companyId, expiryDate)` |
| `meetings` | meetings the reader can open (not cancelled) | start–end | `meetings(companyId, startsAt)`, `(companyId, projectId, startsAt)` |

Business dates are stored at midday UTC; providers query a range widened by a day
and keep only dates whose local day overlaps the request.

## Visibility of Calendar-owned events

| Visibility | Who sees it |
|---|---|
| `PRIVATE` | the creator, and anyone explicitly added |
| `SELECTED_MEMBERS` | the creator and the people chosen |
| `PROJECT` | everyone who can open the project (project scope) |
| `DEPARTMENT` | members of that department |
| `COMPANY` | everyone in the company |

Being added to an event grants sight of that event only — not its project, not
edit rights. A project the reader cannot open is not named on an event they were
invited to.

## Privacy

* **Busy-only** (`privacyMode: "BUSY_ONLY"`): a name and a time, "Unavailable";
  no title, project, module, status, participants or link.
* **HR leave**: the leave type is shown to the member themselves and to those who
  decide leave (HR with department/company scope, the Owner). The CEO, and a
  project manager for people on their projects, see "Unavailable". Everyone else
  sees nothing.
* **Availability** (`GET /api/calendar/availability`) returns merged busy intervals
  only, for readers holding `calendar.availability.view`.

## Role defaults (PRD #39 §129-§144)

| Role | Calendar access | What they see besides company events |
|---|---|---|
| Owner | Manage — company events and holidays | everything their modules allow |
| Group IT | Contribute | technical/shared events; no business-data escalation |
| HR | Manage | leave with types, holidays, company events |
| CEO / Director | Contribute | broad planning through module permissions; leave as "Unavailable" |
| Project Manager | Contribute | their projects' tasks, QA/QC, HSE, deliveries, contract dates; team absences as "Unavailable" |
| Architect, Engineer | Contribute | assigned project schedule and field events |
| Finance | Contribute | invoice due dates |
| Legal | Contribute | contract dates and obligations |
| Sales | Contribute | shared and project calendars |
| Procurement | Contribute | request, RFQ and delivery dates |
| Inventory | Contribute | delivery dates where Procurement is visible to them |
| QA/QC | Contribute | inspections, NCR and corrective-action deadlines |
| HSE | Contribute | inspections, permits, risk reviews, toolbox talks, HSE actions |
| Viewer | View — read-only | visible events; no Calendar-owned mutation |

Contribute holds `calendar.event.create/edit/archive`, `calendar.private_event.manage`,
`calendar.reminder.manage` and `calendar.availability.view`; Manage adds
`calendar.company_event.manage` (company events, holidays, closures, and editing
company-wide events created by others).

## Time

* UTC in the database, the company's IANA zone (`company_settings.timezone`) for
  display and for interpreting a submitted date and time. A series repeats in local
  wall-clock time in the zone it was planned in, so 09:00 stays 09:00 across DST.
* Working day and week: `company_settings.workingDayStart`, `workingDayEnd`,
  `workingDays` (ISO weekdays), defaulting to 08:00–17:00, Monday–Friday.

## V0.1 boundaries

* Recurrence: DAILY, WEEKLY (with days), MONTHLY, YEARLY; UNTIL or COUNT (≤ 730).
  **Edits apply to the entire series** — no single-occurrence exceptions yet, and a
  single occurrence of a series is not dragged.
* Drag and resize: Calendar-owned, timed, non-recurring events the reader may edit.
  Source-owned events are never moved from the calendar.
* Reminders are in-app; email copies follow the member's notification preferences
  for the Calendar category. A reminder never creates an attention item.
* Not in V0.1: external calendar sync, external guests, video conferencing, room,
  vehicle, equipment or crew booking, CPM, resource levelling, ICS export.
