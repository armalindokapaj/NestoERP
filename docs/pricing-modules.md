> **Chat:** Nesto — mobile for the site team
> **File:** docs/pricing-modules.md
> **About:** How NESTO Platform is charged by module — the price list decided with the owner on 2026-11-13, the rules the engine applies, where the public site shows it, and how to change a rate.
> **Last updated:** 2026-11-13

# NESTO Platform, charged by module

Until price book 2026.11 the NESTO Platform was one bundle: every module was
included in the base. From **2026.11.1** a company pays a small base and then
only for the modules its team works in, so a developer that only sells units
no longer pays for HSE or Inventory.

## 1. The price list (EUR a month, 24 months, excl. VAT)

| What | Monthly |
| --- | --- |
| **Base** — 1 company, 1 active project, 15 people, and the everyday tools: Documents, Meetings, Calendar, Timesheets, Daily Log, Announcements | €400 |
| **Sales** — units, buyers, reservations, contracts (the selling part of the units) | €300 |
| Finance | €300 |
| Project Management | €250 |
| Procurement | €200 |
| HR / Workforce | €150 |
| Full Legal (includes Legal Documents) | €150 |
| Legal Documents on its own | €50 |
| Architecture · Engineering · HSE · Inventory / Storage · Contractors | €100 each |
| Further company (adds 15 people) | €250 |
| Further active project | €200 |
| 10 further people | €300 |

What typical buyers pay a month:

| Buyer | Modules | Monthly |
| --- | --- | --- |
| Selling units | Sales | €700 |
| A developer | Sales, Finance, Project Management, Procurement | €1,450 |
| Everything | every module | €2,250 |
| A group: 3 companies, 3 projects, 25 people | the developer's four | €2,350 |

NESTO ROZARIS — selling with the 3D viewer, priced per project — is a
separate product and is unchanged; Sales stays part of it.

## 2. The rules

- **A module is charged once for the whole group**, however many of its
  companies use it. A further company adds its own rate and 15 people.
- **Full Legal absorbs Legal Documents**: choosing both charges Full Legal only.
- A module another one needs is added and charged with a notice (the engine's
  dependencies); none of the priced modules has a priced dependency today.
- Indexation (HICP, 0–5% a year from month 13) and the launch offer apply as
  before.

## 3. Where it shows

All read from the live price book — no page holds a figure of its own:

- **The bill of quantities** (home page and `/pricing`): the base, then a
  "Modules, chosen one by one" row quoted from the cheapest module
  (`lib/marketing/price-book.ts`, `priceRows`).
- **The module schedule** on `/pricing#modules`: every module by group with
  its rate or "In the base", then the four buyers above, worked out by the
  configurator's own engine (`components/marketing/module-schedule.tsx`,
  `moduleGroups`, `priceExamples`). A book that includes every module in the
  base shows no schedule.
- **The configurator** (`/pricing`, step 2): each module with its rate, as
  before.

## 4. Changing a rate

In the Admin Console, Customers → Pricing: create a draft (it copies the
active book), change the rates, publish with a reason. The old version is
retired, never edited, so quotes made under it keep their figures. The site
changes at once.
