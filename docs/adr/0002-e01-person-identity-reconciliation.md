# ADR 0002 — E-01 reconciled onto the person record

- **Status:** Accepted
- **Date:** 2026-09-18
- **Affected PRDs:** Enhancement E-01 (Group User Profile & Employee Identity);
  its neighbours E-02, E-03, E-04 and E-08; the PRD implementation audit of
  2026-09-17 (§4 "E-01", §6 Phase 2, §7 protocol steps 1-3)

## Context

E-01 was written before E-06. It anchors the professional profile to
`CompanyMember` (`/team/[memberId]`, `EmployeeProfile.memberId @unique`) and
proposes a `LegalEntity` model inside a company. E-06 has since built the
person-first identity that later PRDs depend on: a group-scoped `PersonProfile`
behind every login and every employment (`User.personProfileId`,
`EmployeeProfile.personProfileId`), employments that can exist without a login,
and a parent group whose companies are the isolation boundary.

The audit says: apply E-01 next, carefully, by extending `PersonProfile` and
creating no second profile model (§4, §8), and keep E-02 (qualifications and
documents), E-03 (history), E-04 (non-login workforce) and E-08 (universal
linking) as their own steps. Built literally, E-01 would re-key identity to the
membership and undo E-06. This record is the audit's step 1-3 for E-01: every
requirement classified against the code, who owns what, and what migrates.

## Decisions

1. **The person is the profile.** The professional profile is `PersonProfile`,
   read through an employment and the person's memberships. There is no
   `EmployeeProfile.memberId @unique` and no second identity table (§8, §9, §29,
   §30).
2. **A company is the legal entity.** A NESTO company is already the employing
   entity and the isolation boundary. `Company` gains `registrationNumber` and
   `taxNumber` beside `legalName`, `country` and `address`; there is no
   `LegalEntity` model (§4, §7, §27, §28). A company therefore cannot hold two
   legal entities; a group that has two sets them up as two companies.
3. **The route is `/people/[personId]`**, and the directory `/people` — a new
   core module, `people`, that every internal role opens (§10, §11, §103). A
   person without a login has no membership id, and E-08 §4 names the same
   route, so E-08 extends this rather than moving it. `/team/[memberId]` stays
   Team's page about a membership and links to the person.
4. **The people module holds only what is new; restricted views keep their
   owners' permissions.** Opening the directory and a work profile and editing
   your own are `people.directory.view`, `people.profile.view` and
   `people.profile.edit_self` — E-08's names, so E-08 renames nothing. The
   employment view is HR's record, so it is authorized exactly as HR authorizes
   it (`hr.employee.view` with HR's scope in that employment's company, or
   `hr.self.employment` for your own). Private contact data and managed edits are
   the person record's, authorized by E-06's `person_profile.view` and
   `person_profile.update` with the organization reach HR recruits with (its
   company, or the group for the Head of Group HR). A profile must not become a
   second door to HR data with rules of its own.
5. **Where each fact lives stays where it lives now; the profile reads it.**
   The department is the membership's branch (Team). Manager, work location,
   employee number and employment status are the employment's (HR). Work contact
   and bio are the person's. The job title on the profile is the person's
   professional title (`PersonProfile.jobTitle`, which HR keeps), falling back to
   the title of the membership in the employing company; each membership keeps
   its own in-company title, shown per company. Making the employment the single
   current truth for placement, with history, is E-03's (its §6, §7). E-01 adds
   no field E-03 would have to move.
6. **Skills, qualifications, employee documents, expiry and the profile photo
   are E-02's.** Every one of them hangs off person-owned documents, which do
   not exist yet: today's only upload path is the Documents module's, and it
   asks for a document permission many roles do not hold. The audit orders E-02
   after E-04 so it attaches to the settled model (§6 Phase 2). Until then the
   avatar is the initials fallback it is today.

## Requirement classification

EXISTS = already true in the code. EXTEND = built on an existing model or
service. NEW = added by E-01. SUPERSEDE = replaced by a decision above. LATER =
belongs to the PRD named.

| E-01 § | Requirement | Class | Where / why |
|---|---|---|---|
| §2-§3, §233-§235 | A login is a professional identity | EXTEND | `PersonProfile` (decision 1) |
| §4, §7, §26-§28 | Parent group → legal entity → member; exact employing entity | SUPERSEDE + EXTEND | Company is the entity; legal identity fields added (decision 2). Employing company = the person's current employment's company |
| §5-§6, §110, §118, §180-§183 | Group-wide visibility, cross-group denial | NEW | People service resolves the target inside the reader's group; direct ids from another group are not found |
| §8-§9, §29-§31 | Profile model; no duplicate user | EXTEND | `PersonProfile` gains `professionalBio`, `officeLocation`, `workPhoneExtension` |
| §10-§11 | `/team/[memberId]`, `/team` | SUPERSEDE | `/people/[personId]`, `/people` (decision 3) |
| §12-§13, §159-§171 | Tabs, header, responsive, empty and error states | NEW | Overview, Projects, Activity for everyone; Employment and Private only when permitted, absent otherwise |
| §14, §18 | Identity and work contact fields | EXISTS + EXTEND | name, preferred name, work email, work phone exist; extension, office location, bio added |
| §15 | Employee code | EXISTS | `EmployeeProfile.employeeNumber`, per employment |
| §16-§17 | Profile photo | LATER (E-02) | decision 6 |
| §18, §34 | Personal contact is HR-private | EXISTS + NEW | fields exist on `PersonProfile`; a separate private serializer and endpoint |
| §19 | Work email is not the login | EXISTS | PRD #50: username sign-in |
| §20, §31 | Canonical department | EXISTS | membership branch (`CompanyMember.departmentId` → group department) |
| §21 | Manager | EXISTS | `EmployeeProfile.managerMemberId`, same company; shown with the manager's person |
| §22 | Group-safe employment status | NEW | work profile shows ACTIVE / ON_LEAVE / INACTIVE / SUSPENDED, never a reason |
| §23-§25 | Job title vs NESTO role; no role count assumed | EXISTS + NEW | both shown, separately; role labels from `config/roles.ts` |
| §32-§33 | What colleagues see; profile ≠ HR | NEW | work-profile serializer |
| §35-§40, §174-§175 | Directory: group-wide, search, filters, pagination, inactive for HR | NEW | `GET /api/people` from the reader's group; filters company, department, job title, project, location, status |
| §41-§46, §184, §191 | Projects from `ProjectMember` only, permission-aware links | NEW (read) | links only where the reader can open the project |
| §47-§58, §127, §138-§140, §192 | Skills and qualifications | LATER (E-02) | decision 6 |
| §59-§95, §128, §141, §154-§158, §193-§197, §203 | Employee documents, contracts, OneDrive, expiry | LATER (E-02) | decision 6 |
| §96-§97 | Safe activity | NEW | project assignments and appointments, never HR events |
| §98 | Employment tab | NEW (read) | employments of the person the reader may see, from HR's records |
| §99 | Compensation tab | EXISTS | HR's compensation page, linked when permitted; not duplicated |
| §100 | Private HR tab | NEW (read) | private serializer |
| §101-§109, §111, §185-§190 | Permissions, no role checks, self, HR, Finance, IT, management | NEW + EXTEND | `people.*` for the new reads, HR's and the person record's own permissions for the restricted ones (decision 4); Finance, Group IT and management get no private view they do not already hold |
| §113, §119-§121 | Server-side, separate DTOs, no over-fetch | NEW | three serializers, three endpoints |
| §114-§117 | Profile and directory services | NEW | `lib/modules/people/` |
| §116, §124-§125, §132-§136 | Own edit, managed edit, validation, no client security fields | NEW | own: bio, extension, office location, preferred name, work phone; HR: also work email and job title |
| §142-§143, §198 | Audit, nothing sensitive in it | NEW | `PERSON_WORK_PROFILE_UPDATED` |
| §144-§147 | Search | NEW | a `people` provider, group-scoped, no private field |
| §148-§153 | Dashboard, notifications, attention, calendar, workers | LATER (E-02) | they are about qualification expiry |
| §176-§179 | Performance and cache | EXTEND | batched reads; no shared cache of private data |
| §219, §232 | Every active member resolves to a profile | NEW | backfill migration plus the invariant at every membership door; `verify:organization` makes a login without a person an error |

## Data ownership

| Record | Owner (writes) | Readers |
|---|---|---|
| `PersonProfile` work profile | people (own edit, HR's managed edit) | everyone in the group, through the work serializer |
| `PersonProfile` private fields | HR (`hr.person`, recruitment) | HR through the private serializer; the person themselves |
| `Company` legal identity | settings | people (employing company) |
| `EmployeeProfile` | HR | people (employment serializer, restricted) |
| `CompanyMember` job title, department | Team | people (work profile) |
| `ProjectMember` | projects | people (projects tab) |

The people module reads other modules' records and writes only
`PersonProfile`'s work-profile columns, so the ownership registry gains no
contested model: `personProfile` stays HR's, and people writes through HR's
door (`updatePersonWorkProfile` in `lib/modules/hr/person.doors.ts`).

Joining a company by invitation gives the account its person through HR's
`ensurePersonForUser`. Team does not import HR — that would close a circle
through Finance, Sales and Projects back to Team — so `acceptInvite` takes the
door as a required parameter and the server action passes it in.

## Migration

One additive migration: three nullable `person_profiles` columns and two
nullable `companies` columns. Then a data backfill in the same migration,
written to be re-runnable: for every user with an active membership in a
group and no person there, create the person from the account (name, email as
work email, phone) as EMPLOYEE and link it — the same shape
`personForMember` already creates lazily. On the demo it touches nobody
(every active member already has a person); on an older database it closes the
gap. Rollback: drop the five columns; the backfilled persons are ordinary
persons and stay.

## Consequences

- E-03 moves placement (department, title, manager, location) onto an
  effective-dated employment assignment; the profile then reads the current
  assignment instead of the membership, with no route or DTO change.
- E-04 adds the non-login workforce; people already lists persons with an active
  employment, login or not.
- E-02 adds skills, qualifications, documents, the photo and expiry, as tabs and
  fields on this profile.
- E-08 adds `PersonLink` everywhere, hover cards, direct reports, the IT access
  section and candidate and former-employee states, on this route.
