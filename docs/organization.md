# The organization: parent group, companies, departments and people (E-06)

NESTO's business root is a **parent group**. A group owns its companies, its
**group departments** once, and each company's **branch** of them. A person's
place in a department is a **department assignment** — member, company
department manager or group department head — which widens what the role they
already work as allows, and nothing else. The **Platform Admin** implements a
group from outside it and hands it over; from then on **HR** records people,
**Group IT** gives them logins from approved requests, and **department
managers** put them on projects.

```
PLATFORM ADMIN ──implements──→ PARENT GROUP (IMPLEMENTING → READY_FOR_VALIDATION → ACTIVE)
                                 │
                   ┌─────────────┼───────────────────────────────┐
             GROUP DEPARTMENTS   COMPANIES (isolation boundary)   PEOPLE (PersonProfile)
             Finance, Legal, …   Aurelia, Meridian, Terra, …      candidate → employee → user
                   │                  │                                │
                   └── BRANCH ────────┘                                │
                       (Department.groupDepartmentId)                  │
                                 │                                     │
                   DEPARTMENT ASSIGNMENT: MEMBER / COMPANY_MANAGER / GROUP_HEAD
                                 │
                   ProjectMember (assigned by a manager or head, or the project's team)
```

## Where things live

| Concern | Code |
| --- | --- |
| Group, departments, positions, grants, account requests | `lib/modules/organization/` (`organization.service`, `department.service`, `appointment.service`, `access-portfolio.service`, `company-context.service`, `provisioning/`) |
| Candidates and the person behind an employment | `lib/modules/hr/recruitment/`, `lib/modules/hr/hr.person.ts` |
| A person's positions in a context | `lib/context/organization-access.ts` (`positionFor`, `assignmentsInCompany`), `lib/context/member-context.ts` (`contextInCompany`) |
| Role × position permissions | `config/role-defaults.ts` (`permissionsForRole(role, position)`, `POSITION_ORGANIZATION`, `HEAD_EXTRAS`, `HEAD_OVERRIDES`) |
| Group departments and their roles | `config/group-departments.ts` |
| Platform | `lib/context/platform-context.ts`, `config/platform.ts`, `lib/modules/platform/`, `app/platform-admin/` |
| Project team changes by department managers | `lib/modules/projects/project.assignment.ts` |
| Group dashboard rows | `lib/modules/dashboard/dashboard.group.ts` |
| Demo | `prisma/seed/demo/`, `prisma/seed/fixtures/`, `prisma/seed/recruitment.ts`, `config/demo-accounts.ts` |

## Data

- `ParentGroup` (slug, identity, status, `isTestFixture`), `ParentGroupMember`
  (the group-level people: Owner, Group IT), `GroupDepartment` (key, name).
- `Company.parentGroupId`, never changed. `Department.groupDepartmentId` makes a
  company department a branch.
- `DepartmentAssignment` (user, group department, company and branch or none,
  `functionalRoleKey`, `positionLevel`, access level, status, dates). A group
  head's assignment has no company. Composite keys hold every reference inside
  the group.
- `AccessGrant` (delegated access, group or company scope; recorded, not yet
  given out through an API).
- `PlatformAccess` (role `PLATFORM_ADMIN`), never a `CompanyMember`.
- `PersonProfile` (group-scoped person; `User.personProfileId` one-to-one),
  `CandidateProfile`, `EmployeeProfile.personProfileId` with `companyMemberId`
  optional, `UserProvisioningRequest`.
- `AuditEvent.parentGroupId` and a nullable `companyId`, for group-level events.

Migrations: `20260918120000_parent_group_organization_e06` (not additive: see
`docs/release-readiness.md` §21) and `20260918130000_provisioning_rejection_reason_e06`.

## Roles and positions

Sixteen roles: Owner (the Group Owner), Platform Admin, Group IT, HR, CEO,
Project Manager, Architect, Engineer, Finance, Legal, Sales, Procurement,
Inventory, QA/QC, HSE, Viewer. **Admin**, **Company IT**, **Architecture
Manager** and **Sales Manager** are gone. Admin's technical authority went to
Group IT, and its project setup to the Owner and the CEO. The two managers are
now an Architect or a Sales member holding a manager or head position.

A position is held with a role (`functionalRoleKey`). It elevates a membership
only where the membership's role is that role: heading Group Finance makes
somebody a manager where they work as Finance, not where they are a Viewer
(`positionFor`). A group head outranks a company manager. The permission set is
`permissionsForRole(role, position)`:

- **Member**: the role's row.
- **Company department manager**: the role's row, the organization module at
  APPROVE with DEPARTMENT scope (team, workload, assigning projects), and the
  role's manager overrides (for example an Architect's publishing, a Sales
  member's decisions).
- **Group department head**: the manager's set, the organization module with
  GROUP scope, and `HEAD_EXTRAS` (`department.group.view`,
  `department.projects.view_group`, `department.company_manager.manage`,
  `department.team.access.delegate`). The Head of Group HR also approves
  account requests.

GROUP scope reads company-wide inside the session's company. The company filter
always stays.

## Working across companies

A session works in one company at a time (`UserContext`). A person with several
memberships switches from the top bar (`POST /api/me/company-context`) or by
opening a project of another company. A group user acting on a record of a
sibling company acts as their membership there (`contextInCompany`): that
company's permissions decide, and its audit log records the change (§161).
`GET /api/me/access-portfolio` lists the companies, positions, projects and
grants a person works with; it never lists permissions (§95).

Group dashboard rows (`groupCompanies` for the Owner, `groupFinance`,
`groupPipeline`) are computed one company at a time, each with that company's
scope builders.

## Departments and appointments

Organization → Departments lists each group department with its head and each
company's branch with its manager. A department page shows its team and their
projects to the department's managers and head, and to those who keep the
group's people (Owner, Group IT, HR). A head of another function does not see
it.

| Appointment | Who decides |
| --- | --- |
| Group department head | Owner (`organization.department_head.assign`) |
| Company department manager | Owner (`organization.department_manager.assign`), or that function's group head (`department.company_manager.manage`), acting in the company |
| Ending either | The same people |

The appointee must already work as a role of that department
(`config/group-departments.ts`). A manager is named on the branch
(`Department.managerMemberId`) through Team's door. `POST
/api/organization/department-assignments` (`branchCompanyId` for a manager),
`POST …/:assignmentId/end`. Group IT and local managers appoint nobody.

## Project assignment

`POST /api/projects/:projectId/members` and `DELETE …/:projectMemberId` edit the
one `ProjectMember`, by two doors (`authorizeTeamChange`):

- **the project's team**: `project.member.add`/`remove` on a project in scope;
- **a department manager**: `department.project.assign`/`unassign`, for a
  person of the branch they manage (company manager, that company's projects)
  or of the function they head (group head, any company of the group, acting
  there).

The person must have an active login. A role with neither door is refused
before any lookup. A project of a company the person does not belong to is not
found. Every change is audited as `PROJECT_MEMBER_ASSIGNED`/`REMOVED` with the
door used.

## People: recruitment and provisioning

```
HR: candidate (person, no login) ──select──→ SELECTED ──hire──→ employment PLANNED, no membership
HR: request account ──submit──→ SUBMITTED
Head of Group HR / Owner (not the requester): approve ──→ APPROVED   (reject, with a reason)
Group IT: start ──→ IN_PROGRESS; provision ──→ PROVISIONED           (return to HR, with a reason; cancel)
```

- A candidate is a `PersonProfile` of the group. One email address is one person
  in a group. HR in one company recruits into it; the Head of Group HR recruits
  across the group. Candidate notes are HR-private.
- Hiring reuses an employment already planned for the person in that company.
- An account request copies the hire's department, role, job title and manager;
  HR may correct them before submitting. One open request per person and
  company.
- **Provision** (`POST /api/organization/user-provisioning-requests/:id/provision`)
  is one transaction. It creates the user through Auth's door, with the
  username `firstname.lastname` or Group IT's choice, a temporary password
  shown once, must-change and an expiry. Team's door creates the membership;
  the organization writes a MEMBER assignment; HR's door links the employment,
  marks the person an employee and closes the candidacy as hired. A person who
  already has a login keeps it and gains a membership (§83).
- Group IT sees the HR record read-only and chooses only the username (§29).
  The `user_provisioning_request` machine is in `docs/state-machines.md`.

**Not built**: nothing forces a temporary password to be changed after sign-in.
It expires, and the account carries `mustChangePassword`, as PRD #50 left it.

## Platform

The Platform Admin signs in to `/platform-admin`, which is outside the
application shell. A session with a membership is never a platform session, and
every platform route runs inside `withPlatformContext`. From there the Platform
Admin:

1. creates a group (IMPLEMENTING, with all group departments);
2. adds companies through the company bootstrap (settings, modules, numbering,
   a branch per group department); the group's Owner and Group IT join each new
   company;
3. records the approved initial roster, one person at a time (person, login,
   memberships — every company for the Owner and Group IT — and position),
   and first project assignments;
4. sends it for validation and activates it once the checklist's blocking
   items are met: companies, group departments, linked branches, an Owner,
   Group IT. Heads and a project with a manager in every company are
   recommended.

From ACTIVE, the initial roster tools refuse (§138). Platform actions are
audited at group level (`recordPlatformAction`, `PLATFORM_*`). The Platform
Admin approves nothing and becomes a member of nothing.

## Audit

`HR_PERSON_PROFILE_CREATED`, `HR_CANDIDATE_CREATED`, `HR_CANDIDATE_SELECTED`,
`HR_EMPLOYEE_CREATED`; `ORGANIZATION_USER_PROVISIONING_{REQUESTED,APPROVED,RETURNED,REJECTED,CANCELLED}`,
`ORGANIZATION_USER_PROVISIONED` (who requested, approved and provisioned, for
whom, where, which role and manager), `ORGANIZATION_DEPARTMENT_ASSIGNMENT_CREATED`,
`ORGANIZATION_GROUP_DEPARTMENT_HEAD_ASSIGNED`,
`ORGANIZATION_COMPANY_DEPARTMENT_MANAGER_ASSIGNED`,
`ORGANIZATION_DEPARTMENT_ASSIGNMENT_ENDED`; `PROJECT_MEMBER_ASSIGNED`,
`PROJECT_MEMBER_REMOVED`; `AUTH_COMPANY_CONTEXT_SWITCHED`;
`PLATFORM_PARENT_GROUP_{CREATED,UPDATED,READY_FOR_VALIDATION,ACTIVATED}`,
`PLATFORM_COMPANY_ADDED_TO_GROUP`, `PLATFORM_INITIAL_USER_PROVISIONED`,
`PLATFORM_INITIAL_PROJECT_MEMBER_ASSIGNED`.

## Demo

**NESTO Demo Group**, five companies with one project each: Aurelia
Construction (Riverside Residences), Meridian Developments (Central Office
Tower), Terra Infrastructure (East Gate Logistics Hub), Forma Engineering
(Marina Apartments), Nova Hospitality Development (Adriatic Hotel &
Residences).

- **Group people**: the Owner, Group IT and a head for each function, members
  of every company. Some also manage a branch — Architecture in Aurelia, Sales
  in Meridian, Finance in Terra, HSE in Nova.
- **Company people**: a CEO and a project manager per company, local managers
  (Meridian Architecture, Forma Finance, Nova Legal), members, and an
  architect in Aurelia and Forma.
- **Recruitment**: Elira Hoxha interviewing for Meridian Architecture; Adrian
  Kola selected for Terra Finance, with a planned employment, an approved
  request and no login; Ermira Tafa provisioned end to end.
- **Catalog modules**: procurement, inventory, QA/QC, HSE, timesheets, daily
  logs, planning, structure and unit sales/finance/publishing live in Aurelia
  on Riverside, because their catalogs are company-wide. Finance, sales,
  contracts, HR, tasks, documents, meetings and part of engineering are spread
  over the five companies.
- **Test fixtures** live in a hidden group, `group_fixture`: the fixture tenant
  with seven modules off, Fixture Works (invitations, negative memberships) and
  the suspended company.

The development sign-in groups personas as Platform, Group, Aurelia
Construction and Other companies.

## Tests

| Suite | Covers |
| --- | --- |
| `tests/integration/access/seed.test.ts` | §131-§135, including the recruitment lifecycle |
| `tests/api/hr/recruitment.test.ts` | candidate without login, duplicates, select/hire keeping the person, reach, notes |
| `tests/api/organization/provisioning.test.ts` | HR → approval → Group IT, separation of duties, HR cannot provision, one person/one login, return/reject/cancel, attribution |
| `tests/api/organization/appointments.test.ts` | heads by the Owner, managers by the Owner or the function's head, refusals, positions taking effect |
| `tests/api/organization/group-views.test.ts` | access portfolio (stacked roles, two-company architect), departments by reach, group dashboard rows |
| `tests/api/projects/project-assignment.test.ts` | company manager and group head doors, sibling refusals, active login, Adrian on East Gate (§58) |
| `tests/api/platform/platform-implementation.test.ts` | §137, §138: group, companies, roster, checklist, activation, closed roster |
| `tests/security/sibling-companies.test.ts` | Meridian's CEO against every route with Aurelia's ids; Meridian's accountant against Terra's Finance (§144) |
| `tests/security/cross-company-api.test.ts` | Aurelia against the fixture tenant in another group, both ways |
| `tests/e2e/modules/{recruitment-provisioning,organization-group,platform-admin,projects-multi-company}.spec.ts` | the flows in a browser |

## Limits

- **Access grants** are modelled and resolved, but no API creates one yet.
- **The Organization People and Access & Roles pages** (§127) are not built;
  Team lists a company's people and Settings → Roles its role templates.
- **Department pages are English**; the section names are translated.
- **Forced password change** after a temporary password is not enforced (above).
