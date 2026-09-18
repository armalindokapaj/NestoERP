# ADR 0003 — E-13 reconciled onto E-06's departments

- **Status:** Accepted
- **Date:** 2026-09-18
- **Affected PRDs:** Enhancement E-13 (Group & Company Department Management);
  E-06 (parent group, departments, positions), PRD #14 (Team's departments),
  E-01 (the person profile), and the later E-03 (history) and E-04 (people
  without a login)

## Context

E-13 asks for a complete department feature: departments defined once for the
group and activated per company, one head per department, one manager per
company branch, members who can cover several companies, pages in Organization
and in the Platform Admin's group setup, and company setup that activates only
the departments a company needs. It says to reuse E-06's models and to build no
parallel ones (§4, §51, §61-§65, §131, §143).

E-06 had built most of the skeleton, with gaps E-13 closes:

- a fixed chart of thirteen functions (`config/group-departments.ts`), each
  bound to the roles that may hold its positions and the modules it owns, and
  no way to add or edit one;
- a branch of every function in every company, made by the company bootstrap;
- heads and managers as `DepartmentAssignment` rows, with nothing stopping two
  of either;
- membership only as `CompanyMember.departmentId` (one department per login per
  company), plus a MEMBER assignment written by provisioning and the platform
  roster but never by the seed or by Team;
- Team's own PRD #14 pages creating, editing, archiving and restoring a
  company's departments, and naming their manager, outside every rule above.

## Decisions

1. **No new models.** `GroupDepartment` is the group department,
   `Department` (Team's) is the company department, and `DepartmentAssignment`
   is every place in either — head, manager, member. There is no
   `CompanyDepartment`, `DepartmentV2` or platform copy (§4, §51, §62, §63).
2. **`code` beside `key`.** `GroupDepartment.code` is the short name people
   read (FIN, HR), unique in the group and editable (§10). `key` stays the
   permanent function identity the chart binds roles and modules to. A
   department the group adds itself gets a `custom-` key.
3. **A department the group adds binds no role, so its positions widen
   nothing.** E-06 makes a position elevate the role it is held with — the head
   of Finance manages as Finance. A department with no bound role has no such
   role, so `positionFor` ignores its positions: its head and managers are
   recorded, shown and notified, and gain no permission. The Owner staffs it.
   Binding a role to such a department is a later change (§59).
4. **One head, one manager, enforced by the database.** Partial unique indexes
   allow one active `GROUP_HEAD` per group department and one active
   `COMPANY_MANAGER` per branch; a check constraint gives every manager a
   branch. Replacing either is explicit (`replace: true`), ends the old
   appointment as history and makes the new one in one transaction; a race
   loses on the index (§22, §66, §136).
5. **Members are assignments; the membership's department is their home.**
   A member is a `MEMBER` row per branch, so covering three companies is three
   rows, one person (§24-§29). `CompanyMember.departmentId` stays — Team, the
   DEPARTMENT data scope, announcements, timesheet routing and the directory
   read it — as the membership's *home* branch, under one rule: **an active
   membership's home branch always has its MEMBER row.** The migration and the
   seed backfill it; provisioning, the platform roster and adding a company
   write both; E-13's add, move and remove keep the home in step through Team's
   door; Team's own member move and invitation acceptance call the
   organization's `placeMembership` door, passed in because Team importing the
   organization would close a domain cycle (the `PersonDoor` shape from E-01);
   `verify:organization` fails on a home without its row.
6. **Positions follow their branch.** An inactive group department already
   widened nothing; since E-13 an inactive branch doesn't either, so
   deactivating a branch suspends its manager's authority and reactivating it
   restores it (§18, §89, §90).
7. **Team's department editing is superseded.** A company department is a
   branch of a group department, activated from Organization, never created
   from the company side (§3, §39). Team's create, edit, archive and restore
   pages, routes, actions and permissions (`team.department.create`,
   `.update`, `.archive`, `.restore`) are removed; Team → Departments is a read
   list linking to Organization. The branch row stays Team's, written through
   `branch.doors.ts`.
8. **One set of services, two actors.** Organization and the Platform Admin
   call the same department services (`lib/modules/organization/departments/`).
   A member acts through their membership in the company concerned
   (`contextInCompany`) and is audited there; the Platform Admin acts through
   platform permissions (`platform.group.configure`,
   `platform.user.initial_provision`) only while the group is implementing, and
   is audited as the platform (§50, §51, §94, §111).
9. **Permissions extend E-06's, not E-13's list.** E-13 §56's keys are
   suggestions; where E-06 already has the permission, it is kept.

   | E-13 suggests | NESTO |
   | --- | --- |
   | `organization.department.create/edit/deactivate`, `…company.activate/deactivate` | `organization.department.manage` — the Owner (MANAGE rung) and, new, Group IT (§53) |
   | `organization.department.group_head.assign` | `organization.department_head.assign` (Owner) |
   | `organization.department.company_manager.assign` | `organization.department_manager.assign` (Owner), `department.company_manager.manage` (the function's head) |
   | `organization.department.member.view` | `department.team.view` |
   | `organization.department.member.assign/remove` | new: `organization.department.member.manage` (Owner, any branch); `department.member.assign/remove` (APPROVE rung: a branch's manager, a function's head) |
   | `organization.department.access.view/manage` | `organization.access.view`, `department.team.access.delegate` (E-06 §18) |

10. **A place needs a login until E-04.** `DepartmentAssignment.userId` stays
    required; the API speaks `personId` and refuses a person without an account
    (`NO_ACCOUNT`, §31). E-04 makes `userId` optional.
11. **History is the assignment rows and the audit trail.** Ended places stay
    (`INACTIVE`, `endsAt`, `endedByUserId`); every change is audited against the
    group department; the Activity tab reads that. Effective dating is E-03's
    (§67).

## Classification

| E-13 | Class | Where |
| --- | --- | --- |
| Group department, status, code, head (§8-§13) | EXISTS / EXTEND | `GroupDepartment` + `code`, `createdByUserId`; GROUP_HEAD assignment, one active |
| Company department, activation, uniqueness, manager (§14-§22) | EXISTS / EXTEND | `Department` + `@@unique([groupDepartmentId, companyId])`; COMPANY_MANAGER assignment, one active; `managerMemberId` kept as a mirror written only by the appointment door |
| Team, members, coverage (§23-§31) | EXTEND | MEMBER assignments; home rule (decision 5) |
| Organization → Departments, detail tabs, Company → Departments (§32-§39) | EXTEND / NEW | `/organization/departments`, `/organization/departments/[id]?tab=`, `/organization/companies`, `/organization/companies/[id]` |
| Create / activate UX, selectors (§40-§47) | NEW | `components/organization/department-actions.tsx`; candidates service |
| Company setup, Platform Admin (§48-§51, §94-§96) | EXTEND | `bootstrapCompany({ departmentKeys })`, add-company department choice, `/platform-admin/groups/[id]/departments`, checklist |
| Authority (§52-§60) | EXTEND | decisions 3, 8, 9 |
| Data model (§61-§67) | EXTEND | decisions 1, 2, 4, 5 |
| API (§68-§75) | NEW / SUPERSEDE | `app/api/organization/{departments,company-departments,department-assignments,companies}`, platform mirrors; E-06's `POST /department-assignments` and Team's `/api/departments` writes removed |
| People profile (§87) | EXTEND | `WorkProfileDTO.departments` |
| Project integration (§88) | EXISTS | E-06's department door onto `ProjectMember` |
| Inactive behaviour (§89, §90) | EXTEND | decision 6; services refuse new places |
| Audit, notifications (§91-§93) | EXTEND / NEW | `ORGANIZATION_*` keys; four `DEPARTMENT_*` events on the `group_department` record |
| Metrics (§97) | NEW | Organization overview cards |
| Migration (§101-§106) | MIGRATE | `20260918160000_department_management_e13` |
| Seedable department set, ARMAAR (§128, §129) | DEFERRED | the demo keeps its thirteen functions; ARMAAR is seeded after E-13 is stable, as the PRD says |

## Migration

`20260918160000_department_management_e13` is additive. It first refuses —
changing nothing — if a company has two branches of one department, a group
uses a department name twice, a department has two active heads, a branch two
active managers, or a manager position names no branch (§104, §105). Then it
adds `code` (the chart's codes; any other key upper-cased and numbered) and
`createdByUserId`, the unique indexes, the manager check, and one MEMBER row
per active membership placed in a branch of its group's department, with
deterministic ids so a rerun adds nothing. Rollback: release readiness §25.

## Consequences

- Deactivating a branch or a department changes who is a manager right away.
- Team no longer edits departments; old bookmarks to its create and edit pages
  answer 404.
- A group head is listed on every branch of their function they are placed in.
- Heads and managers of a department the group added hold no extra permission
  until a later PRD lets a group bind a role to it.
- E-03 can add effective dating on top of these rows; E-04 makes `userId`
  optional and lets a person without a login hold a place.
