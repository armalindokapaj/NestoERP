# ADR 0005 — D-01: the ARMAAR Group demo tenant and the group's executive dashboard

- **Status:** Accepted
- **Date:** 2026-09-18
- **Affected PRDs:** Demo PRD D-01 (ARMAAR Group Demo Environment & Executive
  Dashboard); PRD #4 (dashboards), E-01 (the person, ADR 0002), E-03 (employment
  history, ADR 0004), E-05A/B/D/E/F (projects, structure, publishing, sales,
  contracts and collection), E-06 (the parent group), E-13 (departments, ADR
  0003); and the later E-04 (non-login workers), E-11 (external companies and
  contractor payables) and E-12 (the activity feed)

## Context

D-01 asks for a realistic, navigable tenant for ARMAAR GROUP sh.p.k. — thirteen
companies, the group's departments, sixty to a hundred people, its eleven public
projects with Tirana Lake as the flagship, a working day of operations in every
module — built from real public facts where the source set has them and clearly
synthetic data everywhere else, every record traceable to its source; and a
premium executive dashboard for the group, every figure derived from the
database and none shown to somebody who may not see it.

The code had nearly all of it as product: the parent group and its companies
(E-06), departments activated per company (E-13), people, logins, positions and
employments with history (E-01, E-03), projects with types and covers (E-05A),
buildings, floors and units (E-05B), publishing (E-05D), selling (E-05E), sale
contracts and collection (E-05F), procurement, finance, legal, documents,
tasks, meetings, calendar, announcements, HSE, QA/QC, contractors and the
Owner's per-company group widgets (E-06 §108-§111). What it did not have: a
group's own registration number and city, company ownership, a project's
published built area, a way to mark key projects, a demo flag, provenance, the
executive view, non-login workers (E-04), a canonical register of external
companies and contractor payables (E-11), and E-12's activity feed.

The four questions asked when D-01 arrived — its order against E-03, alongside
or instead of the five-company demo, the public source set, E-12 — were not
answered before the work was asked for ("then armaar prd"). The defaults below
are the recommendations given then.

## Decisions

1. **A second group beside the five-company demo.** The demo's suites were
   written for it and keep it. ARMAAR is seeded by the main seed after the demo
   (every development and test database has both, so every suite also runs with
   a second real group present) and by `pnpm seed:armaar` for a database that
   already exists. Idempotent: every record has a stable id and is upserted or
   skipped; a rerun adds and changes nothing (§73, §110). Reset is rebuilding the
   database; there is no destructive in-app reset (§74 "may").
2. **Public facts are what D-01 gives, in one file.** The group's legal name,
   NIPT, country and city; the thirteen companies and which are suspended; the
   eleven project names; Tirana Lake's city, built area, type, components and
   company. They live in `prisma/seed/armaar/public-facts.ts` with their source,
   nothing else claims to be public, and `verify:demo` fails if the database
   says otherwise (§108). A company's NIPT or a project's location that the
   source set does not have is left empty rather than guessed; which company runs
   the other ten projects is assigned for the demo and recorded as synthetic.
3. **Provenance is a demo table, `DemoRecord`** (§3, §107): one row per record
   a presenter talks about — the group, its companies, departments, people and
   projects — under a readable stable key (`ARMAAR:PROJECT:TIRANA_LAKE`), with
   PUBLIC, SYNTHETIC or INFERRED for the record and, where it mixes them, per
   field; the group's own row says that everything else in it is synthetic. The
   product reads it for nothing (§80); `verify:demo` does. Owned by `platform`.
4. **NIPT is the registration number.** NESTO's Albanian labels already call a
   company's registration number the NIPT (E-01); the group's is the new
   `ParentGroup.registrationNumber`, beside a new `city`. The group's dashboard
   shows it as NIPT.
5. **Departments are the chart's thirteen functions, named ARMAAR's way** (§9):
   Executive is Administration, Architecture is Architecture & Design, Projects
   is Project Management, Inventory is Inventory & Logistics — renames E-13 lets
   a group make, so every role stays bound. Each company activates only the
   departments it works in (§10); the group's services company, ARLIS
   ADMINISTRIM, employs the heads of the group's functions and runs all
   thirteen.
6. **Small, generic product additions** — data, never "ARMAAR" in code (§92; a
   test holds it): `ParentGroup.isDemo`, which puts D-01 §69's notice on every
   page of a demo tenant and on its dashboard; `CompanyOwner` (holder, share,
   the group when it is the holder), read in Settings → Company → Ownership (§6);
   `Project.builtArea` and `Project.isKeyProject`, both on the project form
   (project.update) and the overview. Migration `20260918180000_demo_tenant_d01`,
   additive.
7. **The executive view is the existing resolver's** (§79-§85): the Owner's
   dashboard gains five group KPIs (companies, active projects, employees,
   external companies, portfolio value), key projects as cards, the portfolio by
   status and by type, departments by their people, upcoming milestones and the
   group's recent activity, and a group banner above them; the heads of the
   group's functions (`department.group.view`) see the banner above their own
   dashboards and may read the aggregate. Every figure is computed **company by
   company as the reader** — the E-06 pattern — with that company's module,
   permission and scope; a company where the reader may not read a figure contributes nothing,
   and a KPI with no company behind it is left out rather than shown as a dash.
   A company-only reader gets no group banner, figures or endpoint (§66). One
   aggregate, `GET /api/dashboard/group`, answers the same functions in one
   response. Key projects and the portfolio charts use the Projects page's own
   portfolio (authorisation, covers). Progress is the plan's — completed
   milestones over those not cancelled (PRD #44 §129) — so Tirana Lake's 62% is
   eight of thirteen milestones, not a stored number. The portfolio's value is
   the approved current budgets, per currency, and says it is synthetic in a
   demo tenant (§29).
8. **External companies are counted, not yet registered** (§28, §45, §99): the
   KPI counts suppliers, contractors and client companies once each across the
   group, by tax number where one is recorded and by name otherwise — AlbaBuild,
   a supplier in two companies and a contractor in one, is one. The canonical
   register with its relationships is E-11's.
9. **Activity is the existing feed** (§35, §62): the group's is each company's
   feed, row by row what the reader could open, merged. A unit's sale, contract
   and payment events — written by Sales, Legal and Finance against the one unit
   — are now sources the feed trusts where the unit and its tab are reachable;
   they were not before, anywhere. E-12's feed replaces it when it exists.
10. **Not faked** (§102, §104): non-login workers and the Workers KPI wait for
    E-04; the contractor chain past its contract (progress, invoice,
    verification, payment) waits for E-11; the Workforce scenario and contractor
    scenario are not seeded.
11. **Its own credentials** (§87): `ARMAAR_DEMO_PASSWORD`, or in development
    the demo's password; refused in production without `ALLOW_DEMO_SEED`.
    Addresses on the reserved `.test` domain; supplier tax numbers begin with X,
    which no Albanian NIPT does. Synthetic people belong to nobody on purpose
    (§76); the group's public legal representatives are not seeded (§40).

## Classification

| D-01 | Class | Where |
| --- | --- | --- |
| §2, §3, §107 Public vs synthetic, provenance | NEW | `DemoRecord`, `public-facts.ts`, `verify:demo` |
| §4 Parent group | EXTEND | `ParentGroup.registrationNumber`, `city`, `isDemo` |
| §5 Companies, active and suspended | EXISTS | `Company`, `CompanyStatus` |
| §6 Ownership | NEW | `CompanyOwner`, Settings → Company |
| §7, §8 Deep and light companies | SEED | `organization.ts` profiles |
| §9, §10 Group and company departments | EXISTS | E-13; renamed functions, selective activation |
| §11-§14, §41, §64 People, group, company and project roles | EXISTS | accounts, logins, positions, employments with history, project teams |
| §15-§24 Portfolio, Tirana Lake, secondary projects | EXISTS / EXTEND | `Project.builtArea`, `isKeyProject`; status PLANNING → PENDING, COMPLETED → FINISHED |
| §19, §78 Progress | EXISTS | the plan's milestones |
| §25-§36, §79-§84, §97 Executive dashboard | EXTEND | `dashboard.group.ts`, config, `GroupHero`, the `projects` widget, `GET /api/dashboard/group` |
| §37, §38, §98 Navigation, Platform Admin | EXISTS | unchanged |
| §39 Search | EXISTS | unchanged |
| §42, §43, §104 Non-login workforce | LATER | E-04 |
| §44, §45, §99 External companies | EXTEND / LATER | counted across registers; the register is E-11 |
| §46, §47, §102 Contractors | EXISTS / LATER | profiles, assignments, work packages, compliance; payables are E-11 |
| §48-§51, §101 Procurement, finance | EXISTS | request → order → receipt → expense; budgets |
| §52 Legal | EXISTS | construction, framework, subcontracts, employment, amendment |
| §53-§55, §103 Sales | EXISTS | E-05E/F, 129 units, typologies 1+1 to 5+1 |
| §56-§61, §63 Documents, tasks, approvals, meetings, calendar, announcements | EXISTS | company-scoped announcements: no group audience |
| §35, §62, §105 Activity | EXISTS / EXTEND / LATER | merged per company; unit events trusted; E-12 |
| §65, §66, §85, §106 Access and security | EXISTS | per-company computation; tests |
| §68, §69 Branding, disclaimer | NEW | `isDemo`, the notice |
| §72-§75, §110, §111 Seed order, idempotency, reset, isolation | NEW | `prisma/seed/armaar/`, main seed, `seed:armaar` |
| §86-§89 Demo accounts, presentation | NEW | `docs/demo-armaar.md` |
| §92 No product coupling | NEW | a test: no product file names ARMAAR |

## Migration

`20260918180000_demo_tenant_d01` adds `registrationNumber`, `city` and `isDemo`
to `parent_groups`, `builtArea` and `isKeyProject` to `projects`, and the tables
`company_owners` (a share above 0 and at most 100) and `demo_records`, with the
`DemoSourceType` enum. Nothing existing changes. Rollback: release readiness
§27.

## Consequences

- Every seeded database has a second, realistic group: the suites run with it
  present, and the Platform Admin's list, sign-in and search see two groups.
- The Owner's dashboard is the group's executive view; its company-level
  widgets stay below it.
- The dashboard's activity feed now shows unit reservations, sale contracts and
  contract payments to readers who could open them on the unit, in every group.
- ARMAAR's Workers KPI, workforce scenario and contractor payables arrive with
  E-04 and E-11; the canonical external-company register with E-11.
