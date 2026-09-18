# ADR 0006 — E-04: the workforce as employments, with or without a login

- **Status:** Accepted
- **Date:** 2026-09-18
- **Affected PRDs:** Enhancement E-04 (Workforce Employees & Non-Account
  Employee Records); PRD #16 (HR), PRD #22 (HSE), PRD #43 (daily logs), E-06
  (people and provisioning), E-01 (the person, ADR 0002), E-03 (employment
  history, ADR 0004), D-01 (the ARMAAR tenant, ADR 0005); the later E-02
  (employee documents and qualifications) and E-09 (worker contracts,
  timesheets and overtime)

## Context

Most of a construction company's workforce never signs in: masons, steel
fixers, drivers, their foremen. E-04 asks that each of them still be an
employee — with HR's record, leave, attendance and documents, a trade, a crew
and a project — and that a NESTO account be something added later to the same
employee, never a second one. It asks for crews, sites and project
assignments separate from project access, HSE and daily logs that name these
people, a bulk import, and integrity checks that hold the whole together.

The code had:

- the person (`PersonProfile`, E-06/E-01) and the employment
  (`EmployeeProfile`, with its history since E-03), with an optional login
  (`companyMemberId`) — but HR **addressed every employee by the login**: its
  pages, API, documents, activity, leave and attendance were keyed by the
  membership, and its lists showed only employees who had one;
- no trade, no crew, no site, and no way to place anybody on a project except
  `ProjectMember`, which is platform access;
- HSE, daily logs and attendance that could name only logins.

E-04's own model (an `Employee` root, a `LegalEntity`, a separate worker
profile) predates E-06, E-01 and E-03 and would duplicate the person and the
employment this codebase already has.

## Decisions

1. **The employee is the employment.** `EmployeeProfile` is E-04's Employee: a
   person of the group employed by one company, with a login or without one
   (§2-§9). Nothing new stands beside it. A login is attached to the same
   employment when an account is provisioned (E-06's request already carries
   `employeeProfileId`); removing a login never removes the employee (§5, §6).
2. **HR is addressed by the employment.** Pages and API moved from
   `/hr/employees/[memberId]` to `/hr/employees/[employeeId]`; an old member
   URL redirects. Documents, activity, tasks, threads, notifications and
   their outbox, attention items, favourites and recent items filed under an
   employee were re-keyed from the membership's id to the employment's in the
   migration — no copies (§60, §195). The HR list shows everybody employed, with an account
   filter (§20).
3. **Leave and attendance belong to the employment.** `companyMemberId` is
   optional on `AttendanceRecord`, `LeaveRequest` and `LeaveBalance`, and
   attendance is unique per employment and day. When a login is linked later,
   `linkEmploymentToLogin` stamps it on the employment's leave and attendance,
   which approvals, calendar and timesheets read (§51, §88).
4. **Three ways to employ somebody** (§228-§230): an existing login, an
   existing person of the group, or a new person. A new person with the name
   of somebody in the group — or their surname and date of birth, or a phone
   number — is refused as `PROBABLE_DUPLICATE` with the candidates, until HR
   confirms they are new (§92, §176). A person already employed in the
   company cannot be employed there twice.
5. **Category and trade are facts about the job, never roles** (§10-§13).
   `EmployeeProfile.workerCategory` is a fixed list; `tradeId` names a
   `WorkforceTrade`, each company's own list (like project types). Somebody
   without a login has a trade and no role at all (§149).
6. **A new domain, `workforce`**, owns trades, crews, crew memberships,
   project assignments and import batches. It never writes HR's rows: the
   employment is made through HR's door `createImportedEmployment`, site
   attendance through HR's door `writeSiteAttendance` (source `SITE`), and
   when HR ends or transfers an employment it closes the workforce rows
   through `endWorkforce`, which HR is handed as `ChangeOptions.workforce` —
   the pattern of ADR 0003 and 0004, so there is no import cycle (§114-§118).
7. **Sites belong to the project.** `ProjectSite` (project structure) is a
   named place of a project — name, code, address, city, archived when done.
   A project with none is one site (§38, §39). Kept by whoever sets up the
   physical project (`project.structure.manage`).
8. **Crews are teams led by an employment.** `WorkforceCrew` has a project, a
   site, a trade, and a supervisor who is an employment — a foreman needs no
   login (§31, §32). `WorkforceCrewMember` is one period of one employee in
   one crew; a move ends one row and opens the next, so the history is the
   rows (§29, §30). The database refuses two overlapping crew periods for one
   employee.
9. **Where somebody works is not project access.** `EmployeeProjectAssignment`
   places an employment on a project and, optionally, a site, with a trade,
   a role and whether it is their main project. It never creates a
   `ProjectMember` (§35, §119). The database refuses the same project twice
   at once and two main projects at once; a transfer ends one row and opens
   the next (§41, §42). Both racing writers cannot win (§221, §222).
10. **Dates are business dates.** Crew and assignment periods are `date`
    columns, inclusive at both ends, as E-03's history is; attendance keeps
    HR's midday-UTC day.
11. **HSE names employments** (§70-§74): toolbox participants and a PPE
    check's subject may be an employee; an incident records who was injured,
    a witness or involved — an employee or a named outsider; a draft permit
    covers people or whole crews; `HseInduction` records a site induction per
    employee and project, voided with a reason, never deleted. The project's
    workforce tab lists who works there without a valid induction. People
    pickers send `employee:<id>` beside member ids.
12. **The daily log suggests its workforce** (§43, §44, §182): the project's
    crews with the site sheet's headcount for the day (or the crew's members
    when nobody marked it), and people assigned in no crew, by trade. The
    writer picks; each becomes an ordinary entry, keeping its `crewId`.
13. **Import keeps what it validated.** A CSV is previewed into an
    `EmployeeImportBatch` whose rows, errors and warnings are stored; commit
    applies those rows, never a copy sent back by the browser, once. Pay is
    never imported; nobody gets a login (§93-§98, §189).
14. **A module, `workforce`,** with Workers, Crews, Attendance and Trades.
    Ladder: VIEW `workforce.view`, `workforce.attendance.view`; CONTRIBUTE
    `workforce.attendance.manage`; MANAGE `workforce.crew.manage`,
    `workforce.project_assignment.manage`, `workforce.trade.manage`. Rows:
    Owner and HR M/C, CEO V/C, project manager M/P, engineer C/AS, QA/QC V/P,
    HSE V/C. Import is HR's `hr.employee.import`; inductions are HSE's
    `hse.induction.view`, `.record`, `.void`. No literal role checks (§147).
15. **The worker's profile is the person's** (§139-§145): `/people/[personId]`
    with a Workforce tab — crew, projects, their history, and a Safety
    section — and HR's record at `/hr/employees/[employmentId]` with an
    Account card and "Request account".
16. **Integrity is checked, not assumed** (§197, §198):
    `pnpm verify:employee-integrity` fails when an employment's login belongs
    to another company or person, a person to another group, a crew or
    project assignment outlives its employment, leave or attendance carries a
    login its employment does not have, or an employee's document names no
    employment of its company.
17. **Demo data is ARMAAR's only** (the owner's decision): 34 site workers
    without a login, their trades, sites, crews, assignments, site attendance
    and inductions, in BUILDING CONSTRUCTION INVEST and ARLIS - NDERTIM. The
    five-company demo gains none; tests make their own rows.

## Classification

| E-04 | Class | Where |
| --- | --- | --- |
| §1-§9, §85 The employee, the optional account, no duplicate, no deletion | EXISTS / EXTEND | `EmployeeProfile` (E-06, E-03); HR by employment |
| §10-§13 Categories, trades, titles, no roles | NEW / EXISTS | `workerCategory`, `WorkforceTrade`; the title is E-03's |
| §14-§27, §136-§145, §228-§233 Profile, directory, filters, cards, quick create | EXTEND | HR list filters; `/people/[personId]` Workforce tab; `/workforce` pages; "No NESTO account" |
| §28-§32, §110, §113, §205 Crews, history, foreman | NEW | `WorkforceCrew`, `WorkforceCrewMember` |
| §33-§42, §111, §112, §119, §204 Project and site assignments, transfer | NEW | `EmployeeProjectAssignment`, `ProjectSite` |
| §43, §44, §182 Daily log | EXTEND | `DailyLogWorkforceEntry.crewId`, suggestions |
| §45-§50, §125-§135 Timesheets by others, work logs, wage basis, overtime | LATER | E-09 |
| §51-§54, §123, §124, §206, §266 Attendance, site sheet | EXTEND / NEW | by employment; source `SITE`; `/workforce/attendance` |
| §55-§58 Payroll readiness, salary and its privacy | EXISTS | `Compensation`, HR-private; payroll is E-09's |
| §59-§69, §226, §227 Documents, qualifications, expiry, OneDrive | EXISTS / LATER | documents filed under the employment; qualifications are E-02's |
| §70-§74, §183, §209, §270 HSE | EXTEND / NEW | participants, PPE subject, `HseIncidentPerson`, `HseWorkPermitWorker`, `HseInduction` |
| §75-§78 QA/QC, tools, drivers, machine operators | LATER | — |
| §79-§84, §150-§152 Privacy and scopes | EXISTS / EXTEND | HR scope by employment; workforce scope by project |
| §86-§90, §117, §164, §210, §262 History, account creation and linking | EXISTS / EXTEND | E-03; E-06 provisioning; `linkEmploymentToLogin` |
| §91 Merge | LATER | — |
| §92, §176, §211 Duplicate detection | NEW | `PROBABLE_DUPLICATE` on create; warnings on import |
| §93-§98, §163, §188, §189, §224, §225, §273 Import | NEW | `EmployeeImportBatch`, `/hr/employees/import` |
| §99, §100, §169 Employee code | EXISTS | `employeeNumber`, unique per company |
| §101-§109, §213, §214, §271, §272 Lifecycle, termination effects, rehire | EXISTS / EXTEND | E-03; ending closes crews and assignments |
| §114-§118 Services and doors | NEW | `lib/modules/workforce`, the three doors |
| §120-§122 Tasks and daily allocation | EXISTS / LATER | a worker without a login is not a task assignee |
| §146-§149, §165, §166 Permissions | NEW / EXTEND | module `workforce`, `hr.employee.import`, `hse.induction.*` |
| §153-§164 API | NEW / EXTEND | [docs/workforce.md](../workforce.md) |
| §167-§175 Validation | NEW | Zod schemas; composite keys to the company's own rows |
| §177, §178 Search | EXISTS | the people directory lists everybody employed |
| §179-§181 Reporting, workforce dashboard | PARTIAL | the group's employees figure counts everyone employed; a workforce dashboard is later |
| §184-§187 Audit | EXTEND | `WORKFORCE_*`, `PROJECT_SITE_*`, `HR_EMPLOYEE_UPDATED` |
| §190-§196, §275 Migration | EXTEND | re-key in the migration; `ProjectMember` and timesheets untouched |
| §197-§200 Integrity, CI | NEW | `verify:employee-integrity`, the gates |
| §236, §237 Mobile, offline | EXISTS / LATER | responsive pages; no offline mode |
| §238-§245 Performance, indexes | EXTEND | indexes on every new table |

## Migration

`20260919090000_workforce_e04` adds the enums `WorkerCategory`,
`ProjectSiteStatus`, `WorkforceCrewStatus`, `HseIncidentInvolvement` and
`EmployeeImportStatus` and the value `SITE` of `AttendanceSource`; the columns
`workerCategory` and `tradeId` of `employee_profiles`, `projectId`, `siteId`
and `crewId` of `attendance_records`, `crewId` of the daily log's workforce
entries, and the employee columns of toolbox participants and PPE checks; the
tables `workforce_trades`, `project_sites`, `workforce_crews`,
`workforce_crew_members`, `employee_project_assignments`,
`employee_import_batches`, `hse_incident_people`, `hse_work_permit_workers`
and `hse_inductions`, with `btree_gist` exclusion constraints on crew and
assignment periods. Attendance, leave requests and leave balances no longer
require a login, and attendance is unique per employment and day. Rows filed
under an employee by membership id are re-keyed to the employment's id.
Rollback: release readiness §28.

## Consequences

- HR, HSE, daily logs and attendance serve the whole workforce, not only the
  people who sign in; every count of employees now includes them.
- A link to an employee is the employment's id; old member links still arrive.
- Timesheets and work logs are still a login's: E-09 moves them to the
  employment with foreman entry, overtime and pay bases.
- Qualifications, contracts and salary documents are E-02's, split between the
  person and the employment as the owner decided.
