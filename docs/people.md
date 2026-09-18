# People: the directory and the work profile (E-01)

Every person who works in a parent group can find every other one, across the
group's companies, and read who they are, where they work, how to reach them
and what they work on. What HR keeps private stays HR's. The profile belongs
to the **person** (`PersonProfile`), not to a login or a membership, so it is
the same profile whichever company you read it from — and it exists for
somebody who has no NESTO account. Why it is built this way, and which parts of
E-01 belong to later PRDs, is [ADR 0002](adr/0002-e01-person-identity-reconciliation.md).

```
PERSON (PersonProfile, group-scoped)          one per human per group
  ├── work profile   preferred name, job title, work email/phone/extension,
  │                  office, bio                  → every colleague in the group
  ├── employments    EmployeeProfile, per company → HR, by HR's own rules
  ├── private record personal email/phone, date of birth, address
  │                                               → the person and HR
  └── login          User → CompanyMember[] → ProjectMember[]
                     department and in-company title per membership (Team)
```

## Where things live

| Concern | Code |
| --- | --- |
| Directory, work profile, projects, activity, both edits | `lib/modules/people/people.service.ts`, `people.schema.ts`, `people.types.ts` |
| The employment view, judged by HR | `lib/modules/hr/employees/employment.view.ts` |
| The person record's doors: identity, reach, work-profile write | `lib/modules/hr/person.doors.ts` |
| Pages | `app/(nesto)/people/` (`/people`, `/people/[personId]`, `/people/me`) |
| API | `app/api/people/` |
| Search | the `people` provider in `lib/core/search/search.providers.ts` |
| Company legal identity | `Company.registrationNumber`, `Company.taxNumber` (set when a company is created) |

## Who sees whom

| Reader | Sees |
| --- | --- |
| Anybody who works in the group | Everybody who works in it today: an active login in an active company, or a current employment (active, on leave, suspended). Across every company of the group |
| Those who keep person records (`person_profile.view`) | Also those who no longer work here ("Include former") |
| Anybody else | Nothing: a person of another group, a candidate who never joined and a made-up id are all "not found" |

A candidate is recruitment's, in HR, until they are hired.

## What each view holds

| View | Endpoint | Who | Holds |
| --- | --- | --- | --- |
| Work profile | `GET /api/people/:id` | everybody who may see the person (`people.profile.view`) | name, preferred name, job title, employing company, department, work email, phone and extension, office, bio, group and company positions, NESTO role, manager, projects, activity, a status without its reason |
| Employment | `GET /api/people/:id/employment` | per employment, in that employment's company: `hr.employee.view` within HR's scope, or your own through `hr.self.employment` | company and its legal identity, employee number, status, type, dates, work location, manager, links to HR's own pages; never pay |
| Private | `GET /api/people/:id/private` | yourself, or `person_profile.view` within reach | personal email and phone, date of birth, address |

"Within reach" is the reach HR recruits with: the reader's own company, or the
whole group for somebody whose organization scope is group-wide (the Head of
Group HR, the Owner). Group IT, Finance, a CEO and a department manager have no
private view unless their role already holds `person_profile.view`.

The work profile is built without reading the employment or the private record
at all (E-01 §121); a tab a reader may not open is absent, not locked (§165).

## Where each fact comes from

| Shown | Source |
| --- | --- |
| Job title | the current employment's title (HR's, kept as history — E-03); for somebody not employed, the person's professional title, else the membership's |
| Employing company | the current employment (active, on leave, suspended; else the most recent) |
| Department | the current employment's department; for somebody not employed, the membership's branch |
| Manager | the current employment's manager |
| Companies | each active membership: company, role, in-company title, department, manager position |
| Departments | every live place in an open department — department, company or the whole group, head, manager or member (E-13 §87) |
| Projects | `ProjectMember` rows of the person's memberships in the group, linked only where the reader can open the project |
| Activity | project joins and departures, appointments and their ends — from those records, not from the audit log |

The employment is the single current truth for placement, with history
(E-03, [employment history](employment-history.md)): the membership mirrors it,
the managed edit refuses the title of somebody employed, and the Employment tab
shows the organization history to the person and to HR.

## Changing a profile

| Who | Endpoint | Fields |
| --- | --- | --- |
| The person (`people.profile.edit_self`) | `PATCH /api/people/me/work-profile` | preferred name, extension, office, bio. Name and phone stay the account's (Settings → Profile) |
| Those who keep person records (`person_profile.update`), within reach | `PATCH /api/people/:id/work-profile` | preferred name, job title, work email (one per person in the group), extension, office |

A field left out is left alone; an empty one is cleared. Every change is
audited as `PERSON_WORK_PROFILE_UPDATED`, with the fields before and after and
whether the person or HR made it. A read-only role edits nothing.

## Every login is a person

Every door that makes somebody a member of a company gives the login its
person in that group: provisioning (E-06), the platform roster (E-06), and —
since E-01 — accepting an invitation, through `ensurePersonForUser` (an
unlinked person of the group with the same email is theirs; otherwise one is
made from the account). Migration `20260918150000_person_work_profile_e01`
backfilled anybody left without one. `pnpm verify:organization` fails on a
login working in a group with no person, and the seed validates it for the
demo.

## Tests

| Suite | Covers |
| --- | --- |
| `tests/api/people/people.test.ts` | same-group and cross-group visibility, candidates, pagination, search and filters, former people for HR, no private field in the directory or work profile, permission-aware project links, the employment view by HR's rules (HR, self; not a colleague, Finance or Group IT), the private view (self, HR; not a CEO, Group IT or an architect), a company's HR limited to its company, own and managed edits, one email per person, search |
| `tests/api/team/team-service.test.ts` | an accepted invitation gives the account its person |
| `tests/security/sibling-companies.test.ts` | Meridian's CEO against every `/api/people` route with Aurelia's people: work profiles by design, never a record id of Aurelia's, the restricted views refused. The sweep exempts only a sibling company's own id on these routes |
| `tests/e2e/modules/people.spec.ts` | finding a colleague in another company, project links and names, editing your own profile, HR's tabs, another group's address |

## Limits

- **No photo.** The avatar is initials. A profile photo is a person-owned
  document, which is E-02's (ADR 0002 decision 6).
- **No skills, qualifications or employee documents** — E-02's.
- **No history.** Department, title and manager are current values; E-03 adds
  effective-dated history.
- **Names are not linked everywhere.** A person's name in a task, a comment or
  an audit row does not yet lead to their profile; that is E-08's `PersonLink`.
- **Company identity is set when a company is created.** Settings shows the
  legal name, registration and tax numbers read-only; there is no door to
  change them afterwards yet.
