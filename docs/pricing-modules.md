> **Chat:** Nesto — mobile for the site team
> **File:** docs/pricing-modules.md
> **About:** How NESTO Platform is charged — people × the modules they work in, a month, with a €500 monthly minimum — the price list decided with the owner on 2026-11-13, the rules the engine applies, where the public site shows it, and how to change a rate.
> **Last updated:** 2026-11-13

# NESTO Platform, charged per person and module

The price is two things: **how many people** use NESTO and **which modules**
they work in. Each module has a monthly rate for each person; the bill is
people × the sum of the chosen modules' rates, **never less than €500 a
month**. There is no base fee and no user packs. The everyday tools are free.

History: until 2026.11 every module was in one bundle; 2026.11.1 charged a
€400 base plus a flat price per module; 2026.11.2 charged per person and
module; **2026.11.3** (this one) adds the €500 monthly minimum.

## 1. The price list (EUR a person a month, 24 months, excl. VAT)

| Module | Per person / month |
| --- | --- |
| **Sales** — units, buyers, reservations, contracts (the selling part of the units) | €28 |
| Finance | €28 |
| Project Management | €24 |
| Procurement | €18 |
| HR / Workforce | €14 |
| Full Legal (includes Legal Documents) | €14 |
| Legal Documents on its own | €5 |
| Architecture · Engineering · HSE · Inventory / Storage · Contractors | €9 each |
| Documents, Meetings, Calendar, Timesheets, Daily Log, Announcements | free |

Included: 1 company and 1 active project. On top:

| What | Monthly |
| --- | --- |
| Further company | €250 |
| Further active project | €200 |
| **Minimum** — modules, people, further companies and projects all count towards it | €500 |

What typical buyers pay a month:

| Buyer | Modules | People | Monthly |
| --- | --- | --- | --- |
| A small office: 1 architect, 1 engineer, 2 directors | Architecture, Engineering, Finance, Project Management (€280) | 4 | €500 (the minimum) |
| Selling units | Sales (€420) | 15 | €500 (the minimum) |
| A developer | Sales, Finance, Project Management, Procurement (€98 a person) | 15 | €1,470 |
| Everything | every module (€171 a person) | 15 | €2,565 |
| A group: 3 companies, 3 projects | the developer's four | 25 | €3,350 |

NESTO ROZARIS — selling with the 3D viewer, priced per project — is a
separate product and is unchanged; Sales stays part of it.

## 2. The rules

- **Every person pays every chosen module.** The count is the company's
  active users; the configurator starts at 15.
- **The minimum.** A setup whose charges (modules, further companies and
  projects) come to less than €500 a month is charged €500; the quote shows
  the top-up as its own line (`minimum.topUpCents`). The launch offer
  discounts the €500 like any NESTO charge: months 1–3 free, 4–6 €250.
- A foundation can carry a base (`baseMonthlyCents`), a minimum
  (`minimumMonthlyCents`), or both; 2026.11.3 uses the minimum only. A stored
  book without a minimum reads it as 0.
- **Full Legal absorbs Legal Documents**: choosing both charges Full Legal only.
- A module another one needs is added and charged with a notice (the engine's
  dependencies).
- A module can carry a flat monthly price, a per-person price, or both
  (`monthlyPriceCents`, `monthlyPerUserCents`); since 2026.11.2 only per-person.
  A stored book without `monthlyPerUserCents` reads it as 0, so retired books
  keep their figures.
- Indexation (HICP, 0–5% a year from month 13) and the launch offer apply as
  before.

## 3. Where it shows

All read from the live price book — no page holds a figure of its own:

- **The bill of quantities** (home page and `/pricing`): the €500 minimum,
  a "Modules, for each person" row quoted from the cheapest rate, then
  companies and projects
  (`lib/marketing/price-book.ts`, `priceRows`). The base and user-pack rows
  appear only when the book charges them.
- **The module schedule** on `/pricing#modules`: every module by group with
  its rate per person or "Free", the minimum, then four buyers (one marked
  "The minimum"), worked out by the configurator's own engine (`components/marketing/module-schedule.tsx`,
  `moduleGroups`, `priceExamples`).
- **The configurator** (`/pricing`): the Platform card reads "From €500";
  step 2 shows each module's rate per person; the Users step shows the
  per-person total × people and, below €500, what the minimum adds; the live
  estimate and the review show the minimum as a line.

## 4. Changing a rate

In the Admin Console, Customers → Pricing: create a draft (it copies the
active book), change the rates — the "€ per person / month" column, and the
Platform's "Minimum / month" — and publish with a reason. The old version is retired, never edited, so quotes
made under it keep their figures. The site changes at once.
