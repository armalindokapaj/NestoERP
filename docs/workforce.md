# Workforce: employees with or without a login

Enhancement E-04 — [ADR 0006](adr/0006-e04-workforce-employees.md) records why
each decision was taken. This is the contract: what is stored, who may change
and read it, the doors between the domains, and what the database, the gates
and the tests hold true.

```
PersonProfile ── EmployeeProfile (company)                           HR
                   ├─ companyMemberId?       a login, or none
                   ├─ workerCategory?, tradeId? ── WorkforceTrade    workforce
                   ├─ leave, attendance      the employment's, login or not
                   ├─ WorkforceCrewMember[]  one crew at a time, from–to   workforce
                   │    └─ WorkforceCrew ─ supervisor: an EmployeeProfile, project?, site?
                   ├─ EmployeeProjectAssignment[]  project, site?, main or not, from–to
                   └─ HseInduction[], incident people, permit workers,
                      toolbox participants, PPE checks                      hse
Project ── ProjectSite[]                                             project-structure
Project ── ProjectMember[]  platform access — never made by any of the above
```

## The rows

| Table | One row is | Never |
| --- | --- | --- |
| `workforce_trades` | a trade in the company's own list: name, code, order, active | deleted while an employee, crew or assignment uses it — retired instead |
| `project_sites` | a named place of a project: name, code, address, city; ACTIVE or ARCHIVED | of another project; a project with none is one site |
| `workforce_crews` | a team: name, project, site, trade, supervisor (an employment), ACTIVE or ARCHIVED | archived with people still in it |
| `workforce_crew_members` | one employee in one crew, `startDate`–`endDate` inclusive, a role, why it ended | edited: a move ends it and opens another; two overlapping for one employee |
| `employee_project_assignments` | one employee on one project, optionally a site, with a trade, a role, whether it is their main project, from–to | a `ProjectMember`; the same project twice at once; two main projects at once |
| `attendance_records` | one employment's day: status, times, where (project, site, crew) and how it was recorded (`SITE` from the site sheet) | two for one employment and day |
| `hse_inductions` | a site induction given to an employee on a project (and site), with an expiry if it has one | deleted: voided with a reason |
| `hse_incident_people` | an employee, or a named outsider, injured, a witness or involved | two rows for one employee on one incident |
| `hse_work_permit_workers` | an employee or a whole crew a permit covers | changed once the permit is submitted |
| `employee_import_batches` | a previewed file: its rows with errors and warnings, counts, PREVIEWED → COMMITTED or DISCARDED | committed twice, or from rows the browser sends back |

**Database guarantees:** crew and assignment periods end on or after they
begin; `btree_gist` exclusion constraints refuse overlapping crew periods for
one employee (`workforce_crew_members_no_overlap`), the same project twice at
once (`employee_project_assignments_no_overlap`) and two main projects at once
(`employee_project_assignments_one_primary`) — so of two racing transfers, one
wins. Every trade, crew, site, project and employee a row names is of the
row's own company (composite keys). Periods are business dates (`date`
columns); attendance keeps HR's midday-UTC day.

## The doors

The employment is HR's; where people work is the workforce's. Neither writes the
other's rows.

| Door | Owner | Called by | The owner's part |
|---|---|---|---|
| `createImportedEmployment` | hr (`employee.doors.ts`) | workforce (import) | A new person of the group and an employment of this company with its first history rows and audit — as HR makes one by hand; planned when the start is later. No login. |
| `writeSiteAttendance` | hr (`attendance.doors.ts`) | workforce (site sheet) | One row per employment and day, source `SITE`, with where; never over a day HR recorded by hand; refused for an employment not working. |
| `endWorkforce` | workforce (`workforce.end.ts`) | hr — handed in as `ChangeOptions.workforce` by the employment routes, actions and job | On the last day of an employment (or before a transfer), open crew memberships and project assignments end that day; those not yet begun are withdrawn. |
| `linkEmploymentToLogin` | hr (`person.doors.ts`) | organization | A provisioned login joins the existing employment and is stamped on its leave and attendance. |

## Who may do what

| Permission | Allows | Rungs (module `workforce` unless said) |
| --- | --- | --- |
| `workforce.view` | Workers and Crews, a worker's Workforce tab | VIEW |
| `workforce.attendance.view` / `.manage` | read / mark the site sheet | VIEW / CONTRIBUTE |
| `workforce.crew.manage` | create, change, archive crews; put people in and take them out | MANAGE |
| `workforce.project_assignment.manage` | assign to projects and sites, move, end | MANAGE |
| `workforce.trade.manage` | the company's trade list | MANAGE |
| `project.structure.manage` | a project's sites | projects |
| `hr.employee.import` | the bulk import | hr, MANAGE |
| `hse.induction.view` / `.record` / `.void` | inductions | hse, VIEW / CONTRIBUTE / MANAGE |

Default rows: Owner and HR M/C, CEO V/C, project manager M/P (their projects),
engineer C/AS, QA/QC V/P, HSE V/C. A project-scoped reader sees and manages the
people, crews and sites of their own projects only. Somebody without a login
has no permission at all — they are recorded, never signed in.

## Where it is

| Page | What |
| --- | --- |
| `/workforce` | Workers: everybody employed, filtered by status, category, account, trade, crew, project and site |
| `/workforce/crews`, `/workforce/crews/[crewId]` | crews; a crew's members, history and supervisor |
| `/workforce/attendance?crewId=&date=` | the site sheet: a crew's day, marked at once |
| `/workforce/trades` | the trade list |
| `/projects/[id]/workforce` | a project's sites, people, crews, and — with HSE — its inductions and who works there without one |
| `/people/[personId]?tab=workforce` | a worker's crew, projects, their history and a Safety section |
| `/hr/employees/[employmentId]` | HR's record, an Account card and "Request account" |
| `/hr/employees/import` | the bulk import |

## API

| Method | Path | |
| --- | --- | --- |
| GET | `/api/workforce/workers` | the directory |
| GET, POST | `/api/workforce/trades`; PATCH, DELETE `…/[tradeId]`; POST `…/reorder` | trades |
| GET, POST | `/api/workforce/crews`; GET, PATCH `…/[crewId]` | crews |
| GET, POST | `/api/workforce/employees/[employeeId]/crew-assignments`; POST `…/[assignmentId]/end` | crew membership |
| GET, POST | `/api/workforce/employees/[employeeId]/project-assignments`; POST `…/[assignmentId]/end` | project assignments |
| GET, POST | `/api/workforce/attendance` | the site sheet |
| GET, POST | `/api/projects/[projectId]/sites`; PATCH `…/[siteId]` | sites |
| GET, POST | `/api/hse/inductions`; POST `…/[inductionId]/void` | inductions |
| GET, POST | `/api/hse/incidents/[incidentId]/people`; DELETE `…/[personRowId]` | who an incident involved |
| GET, POST | `/api/hse/permits/[permitId]/workers`; DELETE `…/[workerRowId]` | who a permit covers |
| GET, POST | `/api/daily-logs/[dailyLogId]/workforce-suggestions` | the day's workforce, suggested and added |
| POST | `/api/hr/employees/import`; GET `…/[batchId]`; POST `…/[batchId]/commit`, `…/[batchId]/discard` | import |

A move is a POST too: a project assignment with `transferFromId`, a crew
membership with `transfer: true`. The old period ends the day before the new
one begins, in one transaction; without them, somebody already in a crew or on
the project is refused rather than moved. HSE people pickers
send `employee:<id>` for an employment and a member id for a login.

## Importing

A CSV of up to 2 000 people. Headings are matched loosely (`Surname` is Last
name, `Hire date` is Start date):

| Column | |
| --- | --- |
| First name, Last name | required |
| Employee code | unique in the company and in the file |
| Trade, Department | one of the company's own, by name |
| Category, Employment type | by label or key; type defaults to full time |
| Job title, Phone | |
| Start date | `YYYY-MM-DD`; none means today, a later one plans the employment |
| Project, Site, Crew | the importer's own projects and crews; a site of that project; needs the assignment and crew permissions |
| Account required | only warns: an import makes no login |

Preview stores every row with its errors and warnings — a name or phone the
group already has, the same name twice in the file — and nothing else.
Commit creates only the valid rows, in groups of four, each person with their
employment, assignment and crew in one transaction; a row that fails is
reported and the others stand. Pay columns are named and ignored. The batch
cannot be committed twice.

## Holding it true

- `pnpm verify:employee-integrity` — an employment's login is a membership of
  its own company and belongs to the same person; the person is of the
  company's group; nobody is still in a crew or on a project after their
  employment ended; leave and attendance carry the login their employment has,
  or none; every document filed under an employee names an employment of its
  company. Read-only; run after seeding, and in CI after the suites.
- `pnpm verify:employment` (E-03) covers the rest:
  every employment agrees with its history.
- Tests: `tests/api/workforce/workforce.test.ts` (trades, sites, assignments,
  crews, races, scope, site attendance, ending),
  `tests/api/workforce/workforce-stage3.test.ts` (HSE, daily-log suggestions,
  import — including a thousand people — and the integrity check),
  `tests/api/hr/non-account-employees.test.ts`, and the E2E specs
  `workforce.spec.ts` and `workforce-site.spec.ts`.

## Demo data

None. Tests make their own.

## Not here

Timesheets and work logs entered for somebody else, overtime, night work and
pay bases are E-09's; qualifications and employee contracts are E-02's; QA/QC,
tools, driver and machine-operator records, merging two employees, a workforce
dashboard and offline marking are later.
