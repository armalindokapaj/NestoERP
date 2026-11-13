> **Chat:** Nesto — mobile for the site team
> **File:** docs/pricing-modules.md
> **About:** How NESTO Platform is charged — people × the modules they work in, a month — the price list decided with the owner on 2026-11-13, the rules the engine applies, where the public site shows it, and how to change a rate.
> **Last updated:** 2026-11-13

# NESTO Platform, charged per person and module

The price is two things: **how many people** use NESTO and **which modules**
they work in. Each module has a monthly rate for each person; the bill is
people × the sum of the chosen modules' rates. There is no base fee and no
user packs. The everyday tools are free.

History: until 2026.11 every module was in one bundle; 2026.11.1 charged a
€400 base plus a flat price per module; **2026.11.2** (this one) charges per
person and module.

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

What typical buyers pay a month:

| Buyer | Modules | People | Monthly |
| --- | --- | --- | --- |
| Selling units | Sales | 15 | €420 |
| A developer | Sales, Finance, Project Management, Procurement (€98 a person) | 15 | €1,470 |
| Everything | every module (€171 a person) | 15 | €2,565 |
| A group: 3 companies, 3 projects | the developer's four | 25 | €3,350 |

NESTO ROZARIS — selling with the 3D viewer, priced per project — is a
separate product and is unchanged; Sales stays part of it.

## 2. The rules

- **Every person pays every chosen module.** The count is the company's
  active users; the configurator starts at 15.
- **Full Legal absorbs Legal Documents**: choosing both charges Full Legal only.
- A module another one needs is added and charged with a notice (the engine's
  dependencies).
- A module can carry a flat monthly price, a per-person price, or both
  (`monthlyPriceCents`, `monthlyPerUserCents`); 2026.11.2 uses per-person only.
  A stored book without `monthlyPerUserCents` reads it as 0, so retired books
  keep their figures.
- Indexation (HICP, 0–5% a year from month 13) and the launch offer apply as
  before.

## 3. Where it shows

All read from the live price book — no page holds a figure of its own:

- **The bill of quantities** (home page and `/pricing`): a "Modules, for each
  person" row quoted from the cheapest rate, then companies and projects
  (`lib/marketing/price-book.ts`, `priceRows`). The base and user-pack rows
  appear only when the book charges them.
- **The module schedule** on `/pricing#modules`: every module by group with
  its rate per person or "Free", then the four buyers above, worked out by
  the configurator's own engine (`components/marketing/module-schedule.tsx`,
  `moduleGroups`, `priceExamples`).
- **The configurator** (`/pricing`): step 2 shows each module's rate per
  person; the Users step shows the per-person total × people.

## 4. Changing a rate

In the Admin Console, Customers → Pricing: create a draft (it copies the
active book), change the rates — the "€ per person / month" column — and
publish with a reason. The old version is retired, never edited, so quotes
made under it keep their figures. The site changes at once.
