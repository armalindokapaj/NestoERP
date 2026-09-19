# The ARMAAR Group demo tenant

Demo PRD D-01, reconciled in [ADR 0005](adr/0005-d01-armaar-demo-tenant.md),
deepened by Demo PRD D-02 (data only — see [What D-02 added](#what-d-02-added))
and D-03 (its named people — see [What D-03 added](#what-d-03-added),
[ADR 0009](adr/0009-d03-armaar-named-people.md)).
A second parent group beside the five-company demo: ARMAAR GROUP sh.p.k., its
thirteen companies, departments, people and public project portfolio, with a
month of operations in every module and the group's executive dashboard.

**Public facts are kept apart from synthetic data.** Only what D-01's and
D-03's source sets give is public:
- the group's legal name, NIPT (M01517007J), country and city, and its owner,
  Armand Lilo;
- the thirteen companies, which are suspended, each one's NIPT and its
  administrator in the registry;
- the eleven project names;
- Tirana Lake's city, built area (233,000 m²), type and components
  (residential, commercial, office), and its company, BUILDING CONSTRUCTION
  INVEST.

NESTO's owner supplied six heads of the group's functions and Eyes of Tirana's
manager, by name. Everything else is synthetic, and every page of the tenant
says so: the other people, which company runs the other projects, statuses,
progress, budgets, prices, sales, payments, suppliers, contracts, documents
and tasks.

## Building it

| | |
| --- | --- |
| A fresh database | `pnpm db:seed` builds the demo and ARMAAR |
| A database that already exists | `pnpm seed:armaar` adds ARMAAR, or brings it up to date |
| Checking it | `pnpm verify:demo` — public facts unchanged, companies, people, projects, provenance, D-02's operational rules, D-03's named people in their places |
| Starting again | rebuild the database (`pnpm db:reset:demo`, development only) |

Running either seed again adds nothing and changes nothing: every record has a
stable id. It refuses to run in production unless `ALLOW_DEMO_SEED=true`, and
there it needs `ARMAAR_DEMO_PASSWORD`.

**Passwords are not in this document.** ARMAAR's people sign in with
`ARMAAR_DEMO_PASSWORD` when it is set; in development, without it, with the
demo's password. Whoever runs the demo manages it (D-01 §87).

## Logins (D-01 §87)

| Persona | Username | Lands in |
| --- | --- | --- |
| Platform Admin (outside the group) | `armaar.platform-admin` | Platform → Parent groups |
| Group Owner — Armand Lilo | `armaar.owner` | the group's dashboard |
| Group IT | `armaar.it` | |
| Group Finance Head — Edvin Gace | `armaar.finance` | |
| Group Procurement Head — Adela Dervishaj | `armaar.procurement` | |
| Group HR, Legal, Architecture, HSE heads — Xhejsi Lilo, Migena Bajro, Besar Zifla, Arted Ballaj | `armaar.hr`, `armaar.legal`, `armaar.architecture`, `armaar.hse` | |
| Group Engineering, Project Management, Sales, QA/QC, Inventory heads | `armaar.engineering`, `armaar.projects`, `armaar.sales`, `armaar.qaqc`, `armaar.inventory` | |
| Company Director (BCI) | `bci.director` | BUILDING CONSTRUCTION INVEST |
| Project Manager, Tirana Lake | `bci.pm` | |
| Project Manager, Eyes of Tirana — Tedi Gogu | `unico.pm` | UNICO CONSTRUCTION; sees Eyes of Tirana only |
| Architect | `bci.architect` | |
| Engineer (ARLIS - NDERTIM, on site at Tirana Lake) | `arlis.civil` | ARLIS - NDERTIM; a login in BCI too |
| Finance user | `bci.finance-specialist` | |
| Procurement user | `arlis.buyer` | works for three companies |
| HSE user | `arlis.hse-officer` | |
| Sales user | `bci.sales-agent` | |
| Viewer | `bci.viewer` | read only |

Every company's people follow the same pattern: `<company>.<role>` — `bci`,
`arlis`, `ideal`, `unico`, `arsol`, `smi`, `arlisadm`, `klais`, `kfp`. Group
people sign in to BUILDING CONSTRUCTION INVEST first, where Tirana Lake is.

In development the sign-in screen lists these people first, one click each,
read from the database as any demo tenant's are (`lib/auth/demo-tenants.ts` —
product code never names ARMAAR, §92): the group heads, then each active
company's people, BUILDING CONSTRUCTION INVEST open and the others folded. The
one-click sign-in uses the demo's password; with `ARMAAR_DEMO_PASSWORD` set,
sign in through the form.

## Presenting (D-01 §88, §89)

1. **Group dashboard** as `armaar.owner`: the group's banner (NIPT, nine active
   and four suspended companies, the demo notice), five figures derived from
   the database, Tirana Lake, United Towers, Gran Melia and Square 21 as cards
   with their progress, the portfolio by status and type, departments by their
   people, the next milestones and the group's recent activity.
2. **Companies**: Organization → Companies; each company's departments.
3. **Departments**: Organization → Departments — thirteen, each active only
   where its company works in it.
4. **People**: the directory; a person's profile, employment and its history.
5. **Tirana Lake**: 62% complete (eight of thirteen milestones), 233,000 m².
6. **Project team**: developer's and contractor's people together — ARLIS -
   NDERTIM's site team has a login in BCI.
7. **Procurement** as `bci.procurement` (D-02 §64): request → approval →
   supplier → order → delivery in every state — rebar half delivered, the
   podium membrane delivered and in stock, the AHUs part-delivered, tiles
   ordered, sanitary ware waiting for approval, a balustrade request sent back
   for a re-quote; each approved order has its Finance commitment. ARLIS -
   NDERTIM, IDEAL, Saranda Marina Invest and ARSOL buy too (29 supplier
   records, 40 requests, orders and deliveries).
8. **Contractors and engineering** as `bci.engineering` (§65): eleven
   contractors, from the frame and façade at work to the lifts signed and the
   landscaping out to tender; on Tirana Lake twelve drawings and specifications
   through their revisions, fourteen RFIs (RFI-009, the level 9 core openings,
   is critical and due tomorrow), twelve submittals, six transmittals.
9. **Documents / tasks**: drawings, reports, minutes, site photos and reviews —
   the handover plan and the Q3 cost report wait for the director's review;
   sixty-five tasks, each opened from the record it is about, some blocked.
10. **Sales / units**: 205 units in two projects — Tirana Lake 101 (with its
    car park), Square 21 104 — typologies 1+1 to 5+1; Square 21 nearly sold
    out, its blocks 3 and 4 bought by investors who already own in blocks 1 and
    2; Tirana Lake a third sold, installments invoiced, some overdue,
    reservations waiting, two with a contract asked of Legal.
11. **Finance / legal** as `bci.finance` (§67): invoice → payment → allocation
    on the buyers' installments; expenses approved, waiting, rejected, and the
    approved ones paid; budgets and commitments. The construction contract with
    Tower B's two extra floors in force, subcontracts with their parties and
    obligations (the façade performance bond overdue), and a hotel operator's
    services agreement waiting for approval at Saranda Marina Invest.
12. **Site operations** as `bci.pm` (§68): Tirana Lake's daily log for every
    working day of the last four weeks — crews from the site sheet,
    subcontractors, deliveries against their orders, the rain days, RFI-009's
    hold — the latest waiting for review and one sent back; HSE inspections,
    hazards and their actions, toolbox talks the site workers signed, a hot-work
    permit active; QA/QC's cube test, flood test and the façade NCR; the site
    store's stock, three items low; the team's timesheets, one week returned.
13. **Site workforce** (E-04) as `bci.pm` or `bci.hr`: Workforce lists 24 of
    BCI's people who never sign in — concrete, formwork, steel fixing, the yard
    — in five crews, each under a foreman without a login. Tirana Lake's
    Workforce tab shows its three sites, who works where, and two people
    without a valid induction: Xhevdet Llani, a steel fixer new on site,
    and Artan Sinani, whose yard induction lapsed. The attendance sheet
    has the last working days, with somebody off sick. Square 21's frame crew
    is archived; its people moved to Tirana Lake after the handover, and Olsi
    Dervishi moved from Tower B to Tower A a few weeks ago — both kept in their
    history. ARLIS - NDERTIM's ten are on The Courtyard (as `arlis.hr`), one
    with an induction voided for the wrong date and given again.
14. **Employee files and qualifications** (E-02) as `arlis.hr`: HR →
    Documents → *To verify* has Taulant Ymeri's crane signaller card and
    Eduart Vrioni's ETABS; *Expiring in 30 days* has Marsela Toska's licence to
    practise and Nertila Gjini's first aid; *Expired*, Taulant's truck licence.
    Marsela's profile shows her documents by group and her shared degree and
    Civil 3D; as `arlis.structural` the Italian certificate he keeps private is
    his alone. Denis Kote's technician card was sent back with a reason. As
    `bci.hr`, Ergys Lamaj's contract has its site-allowance amendment and a
    salary review shared with Finance; the crane operator Ylli Berisha, who
    never signs in, has an operator's licence running out in a week.
15. **Activity**: the dashboard's feed and every record's own history.
16. **Platform Admin** as `armaar.platform-admin`: the group among the
    platform's parent groups.

## What is where

| | Location |
| --- | --- |
| Public facts, with their source | `prisma/seed/armaar/public-facts.ts` |
| What NESTO's owner supplied (D-03) | `prisma/seed/armaar/provided-facts.ts` |
| D-03's named people: survey, provenance, report | `prisma/seed/armaar/named-people.ts` |
| The seed, stage by stage | `prisma/seed/armaar/` — D-01: `organization`, `people`/`access`, `workforce`, `credentials`, `projects`, `units`, `sales`, `operations`; D-02: `supply`, `engineering`, `tasks`, `legal`, `finance`, `schedule`, `safety`, `quality`, `inventory`, `site`, `timesheets`; `seed.ts` runs them in order |
| The checks | `prisma/seed/armaar/verify.ts`, `pnpm verify:demo` — D-01's, and D-02's (every approved order committed, stock equal to its ledger, numbers in the product's series shape, invoices not over-allocated, task links resolving) |
| Where each fact comes from | the `demo_records` table: one row per group, company, department, person (with a login or without) and project, and per D-03 relationship: PUBLIC, SYNTHETIC, INFERRED or USER_PROVIDED, per field where mixed |
| The executive view | `lib/modules/dashboard/dashboard.group.ts`, `GET /api/dashboard/group` |

**Adding a verified fact**, such as a project's location or built area: add it
to `public-facts.ts` with its source and reseed. `verify:demo` then holds the
database to it. A fact NESTO's owner supplies goes in `provided-facts.ts`.

## What D-02 added

D-02 is data only: no migration, API, screen, state, permission or product
change (§1, §57-§61). Every module it names was audited first (§3, §82) and
exists; nothing it needed was missing, so nothing was faked or skipped as
unsupported. What it deliberately does not seed, because the feature is
another PRD's (§4): E-08's people directory (since built — see below), E-09's worker profile and
overtime, E-10's recruitment, E-11's contractor invoice → verification →
payment and the external-company register, E-12's activity centre,
co-ownership, E-05C's 3D explorer. Company fields the schema has no column for
(city, capital, activity, administrator) are not seeded (§9); documents have no
folder, so D-02's folders are the records the files are filed on (§29).

| Area (§) | What is there |
| --- | --- |
| Suppliers (§23) | 29 records of 20 companies, tax numbers beginning with X |
| Procurement (§22) | 18 requests, 13 orders, 9 deliveries across five companies; 11 commitments from approved orders |
| Contractors (§24, §25) | 11, with contacts, assignments, work packages, subcontracts, compliance |
| Engineering (§26-§28) | Tirana Lake: 12 documents / 16 revisions, 14 RFIs, 12 submittals, 6 transmittals |
| Documents, tasks (§29-§31) | Tirana Lake 56 files; 65 tasks |
| Finance, legal (§20, §21) | invoices on installments, 12 expenses, 6 disbursements, 22 contracts besides the sales with parties and obligations, 4 amendments |
| Meetings, calendar (§33, §34) | 17 meetings, 11 events; 4 document reviews |
| Site (§36-§40) | 24 daily logs; HSE 5 inspections, 6 hazards, 5 actions, 5 talks, 3 incidents, 3 permits; QA/QC 8 inspections, 4 NCRs, 4 actions, 2 defects; 13 items in 3 stores; 10 timesheets |
| Units, clients (§15, §18) | Tirana Lake 101, Square 21 104; 77 clients, investors among them |

**Corrections to D-01's data** it made on the way: purchase request, order,
goods receipt and NCR numbers are now in the product's own series shape
(`PR-2026-0041`, not `PR-2026-041`) — with three digits, the product's
highest-in-series allocator re-issued the same next number and a second
request in the demo would fail; D-01's approved orders now carry the Finance
commitment approving them opens, its requests their approval, its order lines
the request line they order; a request whose order waits for approval is
ORDERED, as the product derives it; the sales seed's counters count units
already sold, so a unit added later never re-issues contract 001.

## What D-03 added

D-03 names real people. Each one goes through a relationship NESTO already has,
or is skipped and reported ([ADR 0009](adr/0009-d03-armaar-named-people.md)
classifies each one). `pnpm seed:armaar` prints what it did for each: created,
reused, replaced, conflict, skipped.

| Named | Source | How NESTO holds it |
| --- | --- | --- |
| **Armand Lilo**, Group Owner | public | the group's Owner (`armaar.owner`): one person, nothing on the platform |
| **Adela Dervishaj** (Procurement), **Edvin Gace** (Finance), **Besar Zifla** (Architecture & Design), **Arted Ballaj** (HSE), **Migena Bajro** (Legal), **Xhejsi Lilo** (HR) | supplied by NESTO's owner | each function's head position (`armaar.procurement` … `armaar.hr`) |
| **Tedi Gogu**, Eyes of Tirana's project manager | supplied by NESTO's owner | the project's manager and its one primary team member (`unico.pm`, UNICO CONSTRUCTION) |
| All thirteen companies' NIPTs | public | each company's registration number |

- **The personas are replaced, not duplicated.** D-01's invented Owner and six
  heads carry D-03's names now:
  - Ilir Dervishaj is Armand Lilo;
  - Elira Shkurti is Edvin Gace;
  - Anisa Qosja is Migena Bajro;
  - Gentian Bardhi is Adela Dervishaj;
  - Mirela Kodra is Xhejsi Lilo;
  - Arta Lleshaj is Besar Zifla;
  - Fatmir Zeqiri is Arted Ballaj.

  They keep the same logins and the same recorded work, which stays synthetic
  and is recorded as such. Anxhela Rusi, who managed Eyes of Tirana, stays on its
  team as Technical Coordinator.
- **Nothing private is made up for them.** They have no phone and no home city
  or country. Their work email is on the reserved `.test` domain.
- **Legal administrators are not held.** NESTO has no relationship between a
  company, or a group, and the people who represent it in law, and D-03 adds
  none (§13, §41). The seed keeps the fourteen administrator relationships in
  `public-facts.ts` and reports them as skipped. Klaisi Çela, Kopi Gusho,
  Xhensila Pupa and Gentiana Lilo have no other relationship, so they are not
  people in the demo yet. That needs a generic NESTO feature, with its own PRD,
  first.
- **A place the product gave to somebody else is left to them.** This covers a
  head, a branch manager, or a project's manager appointed in NESTO since the
  last seed. The seed says so, and `verify:demo` fails naming the conflict. A
  named person who already exists in the group under another record stops the
  seed before it writes anything.

## E-08: people before and after a login

Two people the rest of ARMAAR did not have (`prisma/seed/armaar/lifecycle.ts`),
so the profile can show both ends of a working life (E-08 §45-§47, §54, §117,
§118). And Erion Kasa (`armaar.it`), Head of Group IT, now also manages IT in
ARLIS ADMINISTRIM, which employs him: the group head who is a company manager
too (§52), both places on his profile.

| Person | Where to show them |
| --- | --- |
| **Kejsi Braho**, a Sales Agent selected for BUILDING CONSTRUCTION INVEST; her employment (BCI-0950) starts in ten days and HR's account request is approved | `armaar.it` → People → her profile (`/people/person_armaar_selected_kejsi?tab=access`): "no NESTO account", the approved request, **Open the request** to create her login from what HR already typed. `bci.pm` cannot open her profile yet (§119) |
| **Bujar Kelmendi**, a concrete finisher who left Tirana Lake two months ago; his employment (BCI-1090) and his place in the Tower A concrete crew ended together | `bci.pm` → Workforce → Crews → Tower A concrete crew → Former members → his name: "Former employee", nothing more. He is not in the directory for `bci.pm`; `bci.hr` sees his whole profile and lists him with "Include former" |

Every other name in the demo — a project team, a task, a comment, an invoice's
approver, a daily log's author, the audit log — now opens that person's
profile.

## Limits

- **Workers are counted with everybody employed**: the dashboard's employees
  figure includes the 34 site workers; there is no separate Workers figure.
  Their timesheets, overtime and pay are E-09's.
- **Employee files are a presenter's handful**, not a whole company's: eighteen
  files and seventeen qualifications of seven people. Expiry dates are relative
  to the day of the seed; the reminder job moves them on from there.
- **Site attendance is written once**, on the first seed, for the working days
  before it; a rerun does not move it forward. So are D-02's daily logs,
  timesheets and installment invoices, which share its dates.
- **Square 21's blocks 3 and 4 and Tirana Lake's car park are synthetic**, added
  by D-02 to reach its unit ranges; D-01's two blocks and three buildings are
  unchanged.
- **Timesheets are the team's who sign in**; the site workers' hours and
  overtime are E-09's.
- **External companies are counted across the registers** (suppliers,
  contractors, client companies, once each by tax number or name); the canonical
  register is E-11's. So is the contractor chain after the contract: progress,
  invoice, verification, payment.
- **Activity is NESTO's own feed**, not E-12's.
- **Announcements are company-wide at most**: the Owner's group-wide welcome is
  published in BUILDING CONSTRUCTION INVEST.
- **Covers are illustrations** generated for the demo, not the projects' own
  renders; they say so in their description.
- **Nobody in the demo is the legal administrator of a company**: the
  relationship is not in NESTO yet (D-03 §41; see above).
- ARMAAR's pages are English, like the rest of the modules.
