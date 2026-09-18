# The ARMAAR Group demo tenant

Demo PRD D-01, reconciled in [ADR 0005](adr/0005-d01-armaar-demo-tenant.md).
A second parent group beside the five-company demo: ARMAAR GROUP sh.p.k., its
thirteen companies, departments, people and public project portfolio, with a
working day of operations in every module and the group's executive dashboard.

**Public facts are kept apart from synthetic data.** Only what D-01's source
set gives is public: the group's legal name, NIPT (M01517007J), country and city;
the thirteen companies and which are suspended; the eleven project names; Tirana
Lake's city, built area (233,000 m²), type and components (residential,
commercial, office), and its company, BUILDING CONSTRUCTION INVEST. Everything
else — people, which company runs the other projects, statuses, progress,
budgets, prices, sales, payments, suppliers, contracts, documents, tasks — is
synthetic, and every page of the tenant says so.

## Building it

| | |
| --- | --- |
| A fresh database | `pnpm db:seed` builds the demo and ARMAAR |
| A database that already exists | `pnpm seed:armaar` adds ARMAAR, or brings it up to date |
| Checking it | `pnpm verify:demo` — public facts unchanged, companies, people, projects, provenance |
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
| Group Owner | `armaar.owner` | the group's dashboard |
| Group IT | `armaar.it` | |
| Group Finance Head | `armaar.finance` | |
| Group Procurement Head | `armaar.procurement` | |
| Group HR, Legal, Engineering, Architecture, Project Management, Sales, HSE, QA/QC, Inventory heads | `armaar.hr`, `armaar.legal`, `armaar.engineering`, `armaar.architecture`, `armaar.projects`, `armaar.sales`, `armaar.hse`, `armaar.qaqc`, `armaar.inventory` | |
| Company Director (BCI) | `bci.director` | BUILDING CONSTRUCTION INVEST |
| Project Manager, Tirana Lake | `bci.pm` | |
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
7. **Procurement / contractors**: a request to delivery — rebar ordered and half
   delivered, concrete delivered in full and billed, brackets and switchgear
   waiting for approval; five contractors with work packages and compliance.
8. **Documents / tasks**: drawings, reports and minutes; tasks due this week,
   one blocked.
9. **Sales / units**: 129 units in two projects, typologies 1+1 to 5+1;
   Square 21 nearly sold out and mostly paid; Tirana Lake a third sold, some
   installments overdue, reservations waiting, two with a contract asked of
   Legal.
10. **Finance / legal**: budgets (the portfolio's value), expenses waiting for
    approval; the construction contract with ARLIS - NDERTIM, a supply framework,
    five subcontracts and an amendment waiting for approval.
11. **Site workforce** (E-04) as `bci.pm` or `bci.hr`: Workforce lists 24 of
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
12. **Employee files and qualifications** (E-02) as `arlis.hr`: HR →
    Documents → *To verify* has Taulant Ymeri's crane signaller card and
    Eduart Vrioni's ETABS; *Expiring in 30 days* has Marsela Toska's licence to
    practise and Nertila Gjini's first aid; *Expired*, Taulant's truck licence.
    Marsela's profile shows her documents by group and her shared degree and
    Civil 3D; as `arlis.structural` the Italian certificate he keeps private is
    his alone. Denis Kote's technician card was sent back with a reason. As
    `bci.hr`, Ergys Lamaj's contract has its site-allowance amendment and a
    salary review shared with Finance; the crane operator Ylli Berisha, who
    never signs in, has an operator's licence running out in a week.
13. **Activity**: the dashboard's feed and every record's own history.
14. **Platform Admin** as `armaar.platform-admin`: the group among the
    platform's parent groups.

## What is where

| | Location |
| --- | --- |
| Public facts, with their source | `prisma/seed/armaar/public-facts.ts` |
| The seed, stage by stage | `prisma/seed/armaar/` — `organization`, `people`/`access`, `workforce`, `credentials`, `projects`, `units`, `sales`, `operations`, `seed.ts` |
| D-01's checks | `prisma/seed/armaar/verify.ts`, `pnpm verify:demo` |
| Where each fact comes from | the `demo_records` table: one row per group, company, department, person (with a login or without) and project, PUBLIC / SYNTHETIC / INFERRED, per field where mixed |
| The executive view | `lib/modules/dashboard/dashboard.group.ts`, `GET /api/dashboard/group` |

**Adding a verified fact** — a company's NIPT, a project's location or built
area: add it to `public-facts.ts` with its source and reseed. `verify:demo`
then holds the database to it.

## Limits

- **Workers are counted with everybody employed**: the dashboard's employees
  figure includes the 34 site workers; there is no separate Workers figure.
  Their timesheets, overtime and pay are E-09's.
- **Employee files are a presenter's handful**, not a whole company's: eighteen
  files and seventeen qualifications of seven people. Expiry dates are relative
  to the day of the seed; the reminder job moves them on from there.
- **Site attendance is written once**, on the first seed, for the working days
  before it; a rerun does not move it forward.
- **External companies are counted across the registers** (suppliers,
  contractors, client companies, once each by tax number or name); the canonical
  register is E-11's. So is the contractor chain after the contract: progress,
  invoice, verification, payment.
- **Activity is NESTO's own feed**, not E-12's.
- **Announcements are company-wide at most**: the Owner's group-wide welcome is
  published in BUILDING CONSTRUCTION INVEST.
- **Covers are illustrations** generated for the demo, not the projects' own
  renders; they say so in their description.
- ARMAAR's pages are English, like the rest of the modules.
