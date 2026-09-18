# ADR 0004 — E-03 reconciled onto HR's employment record

- **Status:** Accepted
- **Date:** 2026-09-18
- **Affected PRDs:** Enhancement E-03 (Employment & Organization History);
  PRD #16 (HR), E-01 (the person profile, ADR 0002), E-13 (departments, ADR
  0003), and the later E-04 (people without a login), E-09 (workforce
  contracts) and E-10 (recruitment)

## Context

E-03 asks that every employee's current placement — company, department,
title, manager, location, employment type, status — be a cache of an
effective-dated, immutable history, changed only through semantic actions
(promote, transfer, change manager, end, rehire, correct), with future-dated
changes applied by a worker, supporting documents referenced and never copied,
private reasons kept from everyone but HR, and reporting as of any date.

The code had:

- `EmployeeProfile` — HR's employment record, one per person per company, with
  the person (E-06), an optional login, a status machine
  (PLANNED/ACTIVE/ON_LEAVE/SUSPENDED/ENDED), dates, manager, a free-text work
  location, and **no history**: an edit overwrote the manager, dates, type and
  location, and a rehire overwrote the start date;
- department and job title on the **membership** (`CompanyMember`), edited by
  Team, and — since E-13 — moved by the Organization's department places, none
  of it historical;
- a PATCH of the employment record that changed organization fields directly,
  and separate status and rehire endpoints.

E-03's own model (User → CompanyMember → EmployeeProfile → EmploymentRecord →
OrganizationAssignment, a `LegalEntity`, a `JobPosition`) predates E-06 and E-01
and would duplicate records this codebase already has.

## Decisions

1. **The employment record is `EmployeeProfile`.** No `EmploymentRecord`, no
   second employee. A company is its legal entity (ADR 0002 decision 2), so a
   company transfer is the employment in one company ending and one in the
   other beginning — the same person, two records, both kept (§13, §98).
2. **E-03's `OrganizationAssignment` is `EmploymentAssignment`**, keyed by the
   employment, not the membership — so E-04's employees without a login are
   covered as they are (E-04 §85, §86). One row per period: department (a
   branch of the employment's company, by composite key), title, manager,
   location type and place, employment type, both dates inclusive `date`
   columns, the reason, source, an optional supporting document (by composite
   key to a document of the same company), HR's note, who recorded it, and
   correction markers. Department and manager names are snapshotted (§19). The
   name avoids a clash with E-06's `DepartmentAssignment` (positions and
   department places), which stays what it is.
3. **Status history is `EmploymentStatusHistory`** — status, dates, reason,
   the private reason (§23, §24). `EmploymentStatus` keeps its values: ENDED is
   E-03's TERMINATED, PLANNED stays. There is no `EmploymentPeriod` (§26-§28):
   a period is the run from an ACTIVE row whose reason is HIRE, REHIRE or
   LEGAL_ENTITY_TRANSFER, and a rehire reopens the same record (E-04 §108).
4. **Scheduled changes are `EmploymentChange`** (E-03's `OrganizationChange`),
   holding the typed change as its payload, applied once by the job
   `hr.employment-changes` (PRD #51) on its effective date. Immediate changes
   are not stored there; the history is their record (§32-§34, §153-§157).
5. **Rows are never edited.** A change closes the open row the day before it
   takes effect and opens the next; a change on the day the open row began
   supersedes it. A correction supersedes the rows it replaces and writes
   corrected ones naming them, with the reason (§42-§44, §171). The database
   refuses two open rows and, with `btree_gist` exclusion constraints, two
   overlapping standing rows (§40, §41, §89). Every write locks the employment
   row first.
6. **The employment caches its current state** — `departmentId`, `jobTitle`
   (new), `managerMemberId`, `workLocationType` (new), `workLocation`,
   `employmentType`, `employmentStatus`, `startDate`, and `endDate` once ended —
   recomputed from the rows after every write, never written by a form
   (§180, §181, §187). `verify:employment` fails on drift;
   `repair:employment --apply` rewrites a drifted cache, audited (§182).
7. **One authority for placement.** For somebody employed, the employment is
   the authority for department and title, and the membership mirrors it:
   HR's changes write the membership through Team's door `setMemberPlacement`
   and keep the department's team true through the organization's
   `placeMembership` door, passed in (the pattern of ADR 0003). Changes made
   elsewhere are **recorded, not lost**: Team's member edit (department or
   title) and invitation acceptance call `placeMembership`, which now also calls
   HR's `followMembership`; the Organization's department moves and a
   provisioned account call it directly. `followMembership` records the
   difference as a change dated today (source SYNC), or revises a planned
   employment's plan. `verify:employment` fails when an active login and its
   running employment disagree.
8. **When a change takes effect decides how** (§30, §31, §85-§88): today
   applies now; a future date schedules it, with `hr.employment.schedule`; a
   past date backdates it, with `hr.employment_history.correct`, and only
   within the current period — before that is a correction. A planned
   employment has not begun, so a change to it revises the plan. Ending takes
   the last working day; ENDED begins the day after, and anything scheduled
   after it is cancelled.
9. **Title and department on the profile come from the employment** (ADR 0002
   said E-03 would do this): the work profile shows the current employment's
   title and department, falling back to the person's professional title and
   the membership's department for somebody not employed; People's managed
   edit refuses the title of somebody employed.
10. **No `JobPosition`.** E-10's `JobPosition` is a recruitment opening
    (openings, OPEN/CLOSED, candidates), a different thing from E-03's position
    catalog; building E-03's under that name now would collide with it. The
    title on each assignment is E-03's `jobTitleSnapshot` and is what history
    and reports use (§18). `EmploymentType` is unchanged: E-03's PERMANENT and
    FIXED_TERM are contract types, which are E-09's employment contract's.
11. **Permissions extend HR's**, with history its own permission (§56, §59,
    §195):

    | E-03 suggests | NESTO |
    | --- | --- |
    | `employment_history.view_self` | `hr.self.employment` (every role's self-service) |
    | `employment_history.view`, `organization_assignment.view` | new `hr.employment_history.view` — MANAGE rung (HR, Owner); the CEO's `hr.employee.view` is the current record only |
    | `employment_history.view_private_reason` | new `hr.employment_history.view_private` — HR and Owner extras, like pay |
    | `employment_history.correct` | new `hr.employment_history.correct` — HR and Owner extras; also needed to backdate |
    | `employment_history.schedule_change` | new `hr.employment.schedule` — MANAGE rung |
    | `organization_assignment.transfer_entity` | new `hr.employment.transfer_entity` — MANAGE rung, plus HR authority in the target company |
    | `organization_assignment.manage/transfer_department/change_position/change_location` | `hr.employment.update` |
    | `organization_assignment.change_manager` | `hr.employee.manager.assign` |
    | `employment_status.view/manage` | `hr.employee.view`, `hr.employee.status.update` |

12. **One typed change, no PATCH of placement** (§37, §74): `POST
    /api/hr/employees/:memberId/employment-changes` with the action as a
    discriminated union; PATCH keeps only the number, probation, planned end and
    hours; the old `/status` and `/rehire` routes are removed. Group HR sees a
    person's history across companies at `/api/people/:personId/employment-history`,
    each employment judged by the reader's own membership in its company.
13. **A manager is of the employment's own company** (PRD #16 §32), which is
    stricter than E-03 §82's "same group" and is what leave approval routes on;
    a loop through current reporting lines is refused (§113, §114).

## Classification

| E-03 | Class | Where |
| --- | --- | --- |
| §3, §8, §25 Employment record | EXISTS | `EmployeeProfile` (decision 1) |
| §6, §180-§182, §186 Current state, sync, repair | EXTEND | cache columns; `syncCache`; `verify:employment`, `repair:employment` |
| §7, §9-§12, §19, §20 Assignments | NEW | `EmploymentAssignment` (decisions 2, 5) |
| §13-§17, §96-§101 Transfers, promotion, manager, location, type | NEW | `employment.change.service.ts` actions |
| §18, §106-§108 Job position | LATER / SUPERSEDE | title snapshot; catalog with E-10 (decision 10) |
| §21, §22, §101 Types and statuses | EXISTS | enums unchanged (decisions 3, 10) |
| §23, §24, §102-§105 Status history, private reason | NEW | `EmploymentStatusHistory` |
| §26-§28, §95 Rehire, periods | EXTEND | rehire reopens the record; periods derived (decision 3) |
| §29 Reasons | NEW | `EmploymentAssignmentReason`, `EmploymentStatusReason` |
| §30-§34, §153-§157 Effective dating, scheduling, worker | NEW | decision 8; `EmploymentChange`; job `hr.employment-changes` |
| §35-§41 Service, transactions, concurrency, overlap | NEW | row lock, expected assignment, database guards (decision 5) |
| §42-§44, §171 Corrections | NEW | `employment.correction.service.ts` |
| §45-§53, §130, §131, §165, §166 Documents | EXTEND | `sourceDocumentId` → the canonical `Document`, same company, readable by the actor; shown only to readers who can open it |
| §54-§62, §68-§70, §191-§195 Views and privacy | NEW | HR, self and nobody else (`employment.query.ts`) |
| §63-§67 Permissions and scope | EXTEND | decision 11; HR scope in each employment's own company |
| §71-§77 API | NEW / SUPERSEDE | decision 12 |
| §78-§90 Validation | NEW | Zod schemas; department, manager, document, date rules |
| §91-§93, §149 Ending, access separate | EXTEND | ending never touches the membership; offboarding opens |
| §109 Role history | EXISTS | Team's audited role changes; never employment history |
| §110-§114 Hierarchy | EXTEND | manager chain from the employments; cycle refused |
| §115-§119 Department, entity, position deactivated | EXISTS | history names stay (snapshots); corrections may name closed departments |
| §120-§122 Location | EXTEND | `WorkLocationType` + place |
| §123-§133 Timeline, activity | NEW | `EmploymentTimeline`; HR activity only; no public promotion activity |
| §134-§137 Audit | NEW | eleven `HR_EMPLOYMENT_*` actions (ten for changes, one for a cache repair); private reasons never in the payload |
| §138-§140 Search | EXTEND | People search matches current titles only |
| §141-§144, §178, §179 Reporting as of a date | NEW | `employment.report.ts`, `employmentAt` |
| §145-§147, §150 Projects and documents independent | EXISTS | nothing touches project membership or document lifecycle |
| §151, §152 Notifications | NEW | `EMPLOYMENT_CHANGE_EFFECTIVE`, `EMPLOYMENT_CHANGE_FAILED` |
| §183-§185 Migration, provenance | MIGRATE | `20260918170000_employment_history_e03`, source MIGRATION |
| §187 No dual authority | EXTEND | decision 7 |
| §188-§190 Import, bulk | LATER | not required for the first implementation (§189) |

## Migration

`20260918170000_employment_history_e03` is additive. It refuses to run if an
employment's login belongs to another company; enables `btree_gist`; adds the
three tables, three employment columns and the composite keys; adds the check,
partial unique and exclusion constraints; fills the new current fields from the
membership (or, without a login, from the hire's target); and writes each
employment's first rows — one assignment from its known start date, else the day
the record was made, and status rows (ACTIVE from the start; a non-active status
today from today, since when it began is not recorded; ENDED from the day after
the end), all marked MIGRATION. Deterministic ids; a rerun adds nothing. The
seed runs the same data steps, read from the migration file. Rollback: release
readiness §26.

## Consequences

- An HR screen is still addressed by membership; an employment without a login
  (a hire before provisioning, the other half of a transfer to a company where
  the person has no login) is in the person's history but not in HR's lists
  until E-04 makes employment the address.
- Team's and the Organization's department and title edits now leave history
  rows (source SYNC) for employees.
- A title changed in People for somebody employed is refused; HR changes it.
- The organization report needs history permission and company-wide HR scope;
  Group HR sees every company it works in.
