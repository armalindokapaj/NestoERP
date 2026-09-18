# Employment & organization history

Enhancement E-03, reconciled onto HR's employment record —
[ADR 0004](adr/0004-e03-employment-history-reconciliation.md) records why each
decision was taken. This is the contract: what is stored, who may change and
read it, and what the database, the gates and the tests hold true.

```
PersonProfile ─┬─ EmployeeProfile (company A: its legal entity)        HR
               │    ├─ current fields — a cache of the rows below
               │    ├─ EmploymentAssignment[]    where they sat, from–to
               │    ├─ EmploymentStatusHistory[] their status, from–to
               │    └─ EmploymentChange[]        changes scheduled for a date
               └─ EmployeeProfile (company B, after a transfer)          HR
CompanyMember (login in a company) — department and title mirror a running employment
DepartmentAssignment MEMBER — the department's team (E-13), follows the membership's department
```

## The rows

| Table | One row is | Never |
| --- | --- | --- |
| `employment_assignments` | a period of company (the employment's), department, job title, manager, work location type and place, employment type; `startDate`–`endDate` inclusive, the open row has no end | edited: a change closes the open row the day before and opens the next; a correction supersedes rows and writes corrected ones |
| `employment_status_history` | a period of status with its reason and — HR-private — the reason in words | edited, same rule |
| `employment_changes` | a typed change waiting for its effective date: SCHEDULED, then APPLIED, CANCELLED or FAILED | applied twice, or cancelled after it applied |

Department and manager names are kept as they read on the day. Superseded rows
stay, marked with who superseded them and when; the row that replaced them
names them (`correctsId`) and, for a correction, why. Every row says how it came
to be (`source`): CHANGE, SCHEDULED, CORRECTION, MIGRATION, SYNC.

**Database guarantees:** `endDate ≥ startDate`; one open row per employment;
no two standing rows of one employment overlap (`btree_gist` exclusion
constraints); department, document and employment of a row are of the row's own
company (composite keys). Every write locks the employment's row first.

**The current fields** — department, title, manager, location type and place,
type, status, start (of the current period, or the planned start) and, once
ended, the last day — are recomputed from the rows after every write
(`syncCache`). A running employment's planned end (a fixed term) is a term, not
history, and is edited on the record.

## Changing an employment

`POST /api/hr/employees/:memberId/employment-changes`, one of:

| Action | Changes | Permission |
| --- | --- | --- |
| `POSITION` | title (reason: promotion, demotion, title change, reorganization), optionally department and manager | `hr.employment.update` (+ `hr.employee.manager.assign` for the manager) |
| `DEPARTMENT` | department, optionally manager and location | `hr.employment.update` (+ manager) |
| `MANAGER` | manager, or none | `hr.employee.manager.assign` |
| `LOCATION` | where they work: office, site, remote, hybrid, other, and the place | `hr.employment.update` |
| `EMPLOYMENT_TYPE` | full time, part time, contractor, intern, temporary, other | `hr.employment.update` |
| `STATUS` | start a planned employment; on leave, suspended, back at work — with a reason and a private reason | `hr.employee.status.update` |
| `TERMINATE` | the last working day, the reason, a private reason; ended from the day after | `hr.employee.status.update` |
| `REHIRE` | the same record reopened from a new start, placement carried over unless changed | `hr.employee.status.update` |
| `LEGAL_ENTITY` | to another company of the group: department, title, manager, location, type there | `hr.employment.transfer_entity` here, and `hr.employee.create_profile` in the target company |

**When it takes effect decides how.** Today: applied now. A later date:
scheduled, with `hr.employment.schedule`, and applied by the worker on the day.
An earlier date: backdated, with `hr.employment_history.correct`, and only
after the current period began — anything earlier is a correction. A planned
employment has not begun, so a change to it revises the plan; starting it
(`STATUS` → ACTIVE) takes the real first day, even one before the record was
made. A rehire in the future plans the new period.

Every change may name a **supporting document**: one canonical document of the
same company that the person linking it can open. The row keeps its id; nothing
is copied. The change form offers the documents filed on the employee's record.

`expectedAssignmentId` carries the current row the form was built on; if it has
moved on, the change is refused as stale.

**Ending employment** closes the assignment, ends the status from the day after
the last day, cancels anything scheduled after it and opens offboarding. It
never touches the login: company access is Team's decision.

**A transfer** ends the employment here the day before and begins one in the
other company — the person's earlier employment there reopened if they had
one. Their login's membership there is linked if they have one; if not, the
result says so, and the account request is the next step. A company of another
group, and its departments, are refused.

### Corrections

`POST /api/hr/employees/:memberId/employment-history/:rowId/correct` with
`kind` ASSIGNMENT or STATUS, the corrected values and a required
`correctionReason`, with `hr.employment_history.correct` (and
`hr.employment_history.view_private` to change a private reason). The row and —
when its start moves — the row before it are superseded and rewritten; a
correction may name a department since closed or a manager since gone, because
it was true then. Audited as `HR_EMPLOYMENT_HISTORY_CORRECTED` with the reason.

### Scheduled changes

`GET/POST /api/hr/employees/:memberId/scheduled-changes`,
`POST …/scheduled-changes/:changeId/cancel` (`hr.employment.schedule`). A second
change for the same day is refused; nothing may be scheduled after a scheduled
ending, and an ending may not be scheduled before other changes.

The job **`hr.employment-changes`** runs hourly, per company, skipping
suspended companies and those with HR off. It claims each due change
(SCHEDULED → APPLIED) in the same transaction that applies it, dated its own
effective date — a run missed for a week applies each overdue change once, on
its date. A change that breaks a rule on the day (its manager left, its
department closed, a later change already in effect) is marked FAILED with
why, audited, and its requester notified; it is not retried.

## One authority for placement

For somebody employed, department and job title are the employment's. HR's
changes write the membership through Team's `setMemberPlacement` door and keep
the department's team true through the organization's `placeMembership`
door, handed in by the route, the action or the job.

Changes made elsewhere are recorded, not lost. Team's member edit and
invitation acceptance hand every department or title change to
`placeMembership`, which calls HR's `followMembership`; the Organization's
department moves and a newly provisioned account call it directly. If the
membership now says something the running employment does not, the difference
is recorded as a change dated today, source SYNC (a planned employment's plan is
revised instead). The People profile's managed edit refuses the title of
somebody employed.

## Who reads what

| Reader | Sees |
| --- | --- |
| HR with `hr.employment_history.view` and HR scope over the employee in the employment's own company (the HR role, the Owner; Group HR in every company it works in) | every row, superseded ones too, who recorded each, HR notes, correction reasons, scheduled changes; private reasons only with `hr.employment_history.view_private` |
| The employee (`hr.self.employment`) | their own timeline and rows, without notes, private reasons, corrections or who recorded them; their employments in every company of the group |
| The CEO, managers, Finance, Group IT, colleagues | the current record where they could already see it; no history — the history endpoints refuse |

A supporting document appears only when the reader may open it; otherwise not
even its name. `GET /api/hr/employees/:memberId/employment-history` is one
employment; `GET /api/people/:personId/employment-history` is the person
across the group's companies, each employment judged in its own company. The
People profile's Employment tab shows the timeline; HR's employee record has a
History tab (timeline, scheduled changes, positions and placements, status).

Nothing about history is in the directory search or the global search: they
match current titles only. Notifications tell the employee a promotion, a
department or a manager took effect — never why.

## Reporting

`GET /api/hr/reports/organization?asOf=&from=&to=` and HR → Reports →
Organization: headcount on a day (employed that day, active or on leave) by
company, department and title as they were that day, and by status; joiners,
leavers, promotions, department and company transfers, manager and status
changes in a period; tenure in the current period. Every figure from effective
dates. Needs `hr.report.view`, `hr.employment_history.view` and company-wide
HR scope; each company the reader works in with that authority is counted.

## Audit

`HR_EMPLOYMENT_ASSIGNMENT_CHANGED`, `HR_EMPLOYMENT_STATUS_CHANGED`,
`HR_EMPLOYMENT_TERMINATED`, `HR_EMPLOYMENT_REHIRED`,
`HR_EMPLOYMENT_ENTITY_TRANSFERRED` (in both companies),
`HR_EMPLOYMENT_HISTORY_CORRECTED`, `HR_EMPLOYMENT_CHANGE_SCHEDULED`,
`…_CANCELLED`, `…_APPLIED` and `…_FAILED` (as the system), and
`HR_EMPLOYMENT_CACHE_REPAIRED`. Ids, dates, codes and names as they read that
day; a private reason never — only whether one was recorded.

## Integrity

`pnpm verify:employment` (CI, after the suites) fails when an employment has no
history, not exactly one current status, a running employment has no current
assignment or an ended one still has one, the current fields disagree with the
rows, an active login is placed elsewhere than its running employment, a
current reporting line loops, or a current manager is of another company; it
warns when a scheduled change is overdue. `pnpm repair:employment` lists
drifted employments and, with `--apply`, rewrites their current fields from the
history, audited; it never changes history.

## Tests

| Suite | Holds |
| --- | --- |
| `tests/api/hr/employment-history.test.ts` | promotion, department transfer with the team following, manager history and loops, stale forms and concurrent changes, backdating, scheduling, the worker's catch-up and once-only application, cancellation, failure, ending and rehire, company transfer, cross-group refusal, correction, who sees history and private reasons, directory search of current titles only, supporting documents by reference, Team's edit recorded as SYNC, People's title edit refused, drift and repair, as-of placement and headcount, the demo's transfer story |
| `tests/api/jobs/hr.employment-changes.test.ts` | the job's idempotency, failure, company isolation and suspended company |
| `tests/api/hr/hr-service.test.ts` | the employment lifecycle through the typed changes; the edit form holds no placement field |
| `tests/e2e/modules/employment-history.spec.ts` | promotion with an amendment, company transfer, the employee's own history on a phone, a colleague refused, correction, scheduling and cancelling, the organization report |

## Limits

- An HR screen is still addressed by a login's membership: an employment with
  no login (a hire before its account, the other half of a transfer to a
  company where the person has none) is in the person's history but not in HR's
  lists until E-04.
- No job-position catalog: the title is recorded on each row; E-10's
  `JobPosition` is a recruitment opening, a different thing.
- A manager is of the employment's own company.
- Promotions are not published to company activity; bulk changes and import
  are not built (E-03 §189).
