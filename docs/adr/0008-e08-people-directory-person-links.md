# ADR 0008 — E-08: one link to a person, former employees who stay linkable, and the profile photo

- **Status:** Accepted
- **Date:** 2026-09-19
- **Affected PRDs:** Enhancement E-08 (People Directory, User Profiles &
  Universal User Linking); E-01 (the person and the directory, ADR 0002), E-02
  (qualifications and files, ADR 0007), E-06 (candidates and provisioning),
  E-13 (departments, ADR 0003); PRD #29 (storage), PRD #47 (authorization)

## Context

E-08 asks that every person NESTO shows be one click from one canonical
profile, that the directory and profile say who somebody is without exposing
what HR keeps, and that a person exist before, beside and after a login.

Most of that was built by E-01 (the person-keyed profile at
`/people/[personId]`, the group directory, the work / employment / private
views), E-06 (candidates, the lifecycle, provisioning a login from the person
without re-entry) and E-02 (skills, qualifications and the employee file).
What was missing:

- **Links.** About 180 components show a person by name; almost none link, and
  the few that do build their own URL — to a membership's Team page, to HR's
  employee page, and in one place to a login id where a membership was meant.
  Nine in ten of the records behind them name the person by their membership in
  a company, not by the person.
- **Former employees** were invisible to everybody but HR, so a departed
  colleague's name on an old task could lead nowhere (E-08 §54, §55, §118).
- **No photo.** E-01 left it to E-02, whose text did not ask for one.

## Decisions

1. **The directory stays group-wide** (the owner's decision, 2026-09-19).
   Anybody who works in the group finds anybody who works in it, as E-01
   decided; §115 leaves the policy to the group. Private data is unaffected.
2. **Former employees are linkable, not listed** (the owner's decision). A
   colleague opens a former employee's profile from any link and reads who they
   were: name, last title and company, "Former employee". Not their work
   contact, photo, projects, places, activity, qualifications or files — those
   described somebody at work. The directory and search list them only for
   those who keep person records, as before. "Former" is precise: not working
   in the group, and an ended employment or a login whose place in the group
   was closed. A selected candidate whose employment has not started, and a
   suspended login, are not former and stay hidden from colleagues (§119).
3. **One component, one destination.** `<PersonLink>`
   (`components/people/person-link.tsx`) is the only way a name or avatar leads
   to a profile. It takes the person's id where the record has it; otherwise the
   id the record keeps — a membership, a login, an employment — and links to
   `/people/member/[id]`, `/people/user/[id]` or `/people/employee/[id]`, which
   find the person inside the reader's group (`person.refs.ts`) and redirect to
   `/people/[personId]`. The records keep the ids they have; no module is
   re-keyed to the person. Whether the reader may open the profile is the
   profile's rule, checked when it opens: a link never grants anything, and
   another group's id is not found.
4. **The photo is the person's, not a company document** (the owner's decision
   to build it). A person may have no company (a candidate) and colleagues in
   every company of the group see it, while a `Document` belongs to one company
   and answers to that company's readers. So the person record keeps the photo
   — its object key, type, checksum and size — and the object sits under
   `people/<group>/<person>/`, named by its checksum. It is read through
   `GET /api/people/:id/photo`, by whoever may read the person's full work
   profile, and set or removed by the person or by those who keep person records
   within reach. Only JPEG, PNG or WebP, recognised by their bytes, up to 2 MB.
   The URL carries the checksum, so a new photo is a new URL. Initials remain
   the fallback. Audited as `PERSON_PROFILE_PHOTO_UPDATED`.
5. **Access is shown to those who administer it, and changed where it always
   was.** The profile's Access tab (`GET /api/people/:id/account`) is for
   `organization.access.view` — the Owner and Group IT: the login, its
   companies and roles, project access, department positions, delegated grants
   and how complete the record is; last sign-in only with
   `team.member.security_metadata.view`. It changes nothing: a login is still
   deactivated on Team and created from the account request. So that Group IT
   can act for somebody not (or not yet) working — a selected candidate waiting
   for a login (§46, §117), a leaver whose login must close — an access
   administrator opens the profile of anybody who has been in the group, as
   those who keep person records do. The directory still lists former people
   only for the latter.
6. **Putting somebody on a project from their profile goes through the project's
   door** (§49, §50, §64). The profile offers only the projects the reader may
   staff with this person — in a company where the person has a login — and
   `authorizeTeamChange` decides, exactly as on the project's Team tab: the
   project's own team door, or a department manager's for their own people
   (E-06 §94). The change is the projects domain's `addMember` / `removeMember`,
   audited there as `PROJECT_MEMBER_ASSIGNED` / `PROJECT_MEMBER_REMOVED` with
   `via` — the events E-08 §109 calls `PERSON_PROJECT_ASSIGNED` /
   `PERSON_PROJECT_REMOVED`. Nothing is audited twice.

## Requirement classification

EXISTS = already there. EXTEND = there, widened. NEW = added by E-08.

| § | Requirement | Class | Where |
| --- | --- | --- | --- |
| §2.1, §3, §4, §57, §60, §120 | One person, one profile, one route; login → person 1:0..1 | EXISTS | E-01, E-06 |
| §5-§8, §69-§83, §112, §121 | `PersonLink`, reference resolver, every module | NEW | decision 3 |
| §9-§15, §41, §61, §122 | Directory, search, filters, views | EXISTS + EXTEND | E-01; manager and NESTO role filters; views Everyone, My company, My department, My projects |
| §16-§25, §62 | Header, overview, organization, projects, group and company roles | EXISTS | E-01, E-13 |
| §20-§21 | Manager linked; direct reports | EXTEND | the overview lists the people whose current employment names this person as manager; the directory filters by manager |
| §26-§27 | Skills, qualifications, documents | EXISTS | E-02 |
| §29, §35, §66, §97 | Access section, account summary, record completeness | NEW | decision 5 |
| §43, §93 | Photo | NEW | decision 4 |
| §45-§48, §117, §119, §124 | Candidate → employee → login | EXISTS | E-06 |
| §49-§51, §64 | A department manager assigns projects from the profile | NEW | decision 6 |
| §109, §110 | Audit events | EXISTS + EXTEND | `PERSON_PROFILE_PHOTO_UPDATED` added; profile, employment (E-03), project (decision 6) and account (E-06, Team) changes keep the events they had |
| §53-§56, §118 | Without login; former employee | EXISTS + EXTEND | decision 2 |
| §90, §115 | Company-scoped directory | SUPERSEDE | decision 1 |

## Consequences

- A module shows a person with `<PersonLink>` and the id it has; building a
  profile URL anywhere else is refused by a test.
- Records that kept only a name — activity feeds, histories — need the actor's
  id added to their payload to link; the database already holds it.
- The photo adds five nullable columns to `person_profiles` (migration
  `20260919150000_person_photo_e08`), set together or not at all.
- Stage 2 put `PersonLink` on about 330 places across every module. Payloads
  gained the ids beside the names they already carried (`actorMemberId`,
  `recordedByMemberId`, …); nothing was re-keyed and no name moved. A name stays
  plain text where it is inside another link (a row that opens its record), in a
  form or picker, on a print page, or names somebody who is not a NESTO person
  (a visitor, a contractor's contact).
- HR's links to a membership's Team page — where a login's access is managed —
  go through `membershipHref` beside `personHref`, so the test still holds every
  hand-built `/people/…` and `/team/…` URL to one file.
- A few services still build `/people/<id>?tab=…` strings for their own
  worklists and calendar entries (`lib/`, which the test does not scan); they
  lead to the same canonical profile.
