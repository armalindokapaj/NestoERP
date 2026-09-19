# ADR 0009 — D-03: ARMAAR's named people in NESTO's own relationships

- **Status:** Accepted
- **Date:** 2026-09-19
- **Affected PRDs:** Demo PRD D-03 (ARMAAR Organization, People & Project
  Assignment Seed); D-01 (the tenant, [ADR 0005](0005-d01-armaar-demo-tenant.md)),
  D-02 (its operational data), E-06 (roles and positions), E-13 (departments,
  [ADR 0003](0003-e13-department-management-reconciliation.md)), E-05A (project
  team), E-01 (the person, [ADR 0002](0002-e01-person-identity-reconciliation.md))

## Context

D-03 names real people in ARMAAR: the group's owner (public), the registry's
administrator of the group and of each company (public), six heads of the
group's functions and Eyes of Tirana's project manager (supplied by NESTO's
owner). It adds each company's NIPT. It is data only: every relationship goes
through a capability NESTO already has, is classified before it is seeded
(§9, §41), and one that NESTO cannot represent is skipped and reported, never
emulated.

D-01 had deliberately left real people out: every ARMAAR person was a synthetic
persona, and the group's legal representatives were "not people here" (D-01
§40). Its personas already held the places D-03 names. Each group function had
a head with a login, and D-02 recorded their work: approvals, meetings, contract
reviews.

## Classification (§9, §32, §41)

| Relationship | NESTO | Class | Seeded |
|---|---|---|---|
| Group Owner (§6) | the OWNER role, held as the group's head of Executive (E-06) | SUPPORTED_NOW | Armand Lilo |
| The six group departments (§10) | E-13's thirteen functions, all present in ARMAAR since D-01 | SUPPORTED_NOW | nothing to create |
| Group department head (§8) | a `GROUP_HEAD` position, which needs a login | SUPPORTED_NOW | the six heads |
| Project manager (§11) | `Project.projectManagerMemberId` and the primary team member, both a membership of the project's company | SUPPORTED_NOW | Tedi Gogu |
| NIPT (§13) | `Company.registrationNumber` (D-01 decision 4) | SUPPORTED_NOW | all thirteen companies |
| Group and company legal administrator (§7, §13) | none. A company holds only its registry facts (name, legal name, NIPT, tax number); a contract party has a signatory, per contract | NOT_SUPPORTED | skipped and reported |
| USER_PROVIDED provenance (§3) | `DemoSourceType` had PUBLIC, SYNTHETIC and INFERRED | a missing value | added (decision 4) |

## Decisions

1. **The named people take the personas' places.** The Owner and the six heads
   keep their usernames, logins, memberships, employments and positions under
   the names D-03 gives. This is §24's exception: the old holders are
   clearly stale demo data, and the replacement is intentional. Putting the
   named people beside the personas does not work. A function has one head
   (E-13's index), and the work D-02 recorded would then belong to somebody no
   longer in the place. So the synthetic work under those logins now shows the
   named person's name. Their provenance records say that the login, the
   employment and that work are synthetic.
2. **Tedi Gogu is a new login in UNICO CONSTRUCTION** (`unico.pm`). NESTO's
   project manager is a membership of the project's company (§12), so this is
   the one login D-03 deliberately requires (§26). D-01's manager, Anxhela Rusi,
   stays on Eyes of Tirana's team as Technical Coordinator and is no longer
   primary. He is listed last, so no other employee number or phone moves.
3. **Nothing private is made up for a named person** (§14). A named person gets:
   - no phone;
   - no city or country, which belong to their private record with the home
     address (`docs/people.md`).

   The persona's values are cleared. The work email stays on the reserved `.test`
   domain, because it is a login's contact that reaches nobody. Start dates and
   titles are synthetic and recorded as synthetic.
4. **`USER_PROVIDED` is added to `DemoSourceType`.** This is D-03's only schema
   change: migration `20260919200000_demo_source_user_provided_d03`, one additive
   enum value. Only the seed and `verify:demo` read provenance (D-01 decision 3),
   so no product behaviour changes. Recording the supplied names as PUBLIC would
   claim they were verified, and recording them as SYNTHETIC would call real
   people invented. A supplied name has no verification date.
5. **Legal administrators are skipped, and the facts are kept.** They live in
   `public-facts.ts` as `LEGAL_ADMINISTRATORS`, and every run reports them as
   skipped. Four people appear only in that relationship: Klaisi Çela, Kopi
   Gusho, Xhensila Pupa and Gentiana Lilo. They are not people in the demo yet.
   A person with no relationship would be a candidate with no candidacy, and
   `verify:demo` refuses a person with neither a login nor an employment. §35's
   "all twelve exist" therefore gives way to §41. Holding them needs a generic
   feature first, with its own PRD (§1, §43): the people who represent a company
   or a group in law.
6. **A place somebody else holds is left to them, and said** (§24, §25):
   - **Positions and project managers.** The seed never takes a position (a
     group head, a branch manager) or a project's management from whoever the
     product gave it to. It reports the conflict, leaves the place as it is, and
     `verify:demo` then fails with the conflict named. Somebody who already
     holds the same place under another id is left alone.
   - **A named person under another record.** If a named person already exists
     in the group under a different record, the seed stops before it writes
     anything (§4, §23). A name matches exactly, ignoring case, spacing and
     accents, and never on the surname alone.
7. **D-03's keys are provenance keys** (§21):
   - `ARMAAR:PERSON:EDVIN_GACE` on the person;
   - `ARMAAR:GROUP_OWNER:ARMAND_LILO` and `ARMAAR:DEPT_HEAD:FINANCE:EDVIN_GACE`
     on the positions;
   - `ARMAAR:PROJECT_MANAGER:EYES_OF_TIRANA:TEDI_GOGU` on the team member.

   Record ids stay derived from the username, so a database seeded before D-03
   keeps them. One provenance record per entity: a record re-keyed later
   replaces its old key.
8. **Heading a function grants what the product's head profile grants**, and
   D-03 adds nothing to it (§16):
   - every head: running their department (Organization);
   - the Architecture head also: E-05D's unit publishing, folded into the
     Architect's position by E-06, and a view across the company.

   No head gains anything in another function's module. A test holds each
   head's access against the same role held without the position.

## Consequences

- ARMAAR has 82 people with a login (was 81). 8 of them are named: 1 public
  and 7 supplied. The rest are synthetic.
- `pnpm seed:armaar` on a database seeded before D-03 renames the seven
  personas and makes Tedi Gogu Eyes of Tirana's manager. It reports each step:
  created, reused, replaced, conflict, skipped. A second run reports only
  "reused" and "skipped".
- Every company in the group has its NIPT, cited to D-03 in its provenance.
- The legal administrators wait for a generic NESTO feature. Until then, a
  presenter shows who administers a company from the source, not from NESTO.
