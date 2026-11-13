> **Chat:** Nesto — mobile for the site team
> **File:** docs/pricing-modules.md
> **About:** How the modular NESTO Platform is charged — each module per company (capped by a group price) and per user, plus companies and projects, never less than €500 a month — the price list decided with the owner on 2026-11-13, the rules the engine applies, where the site shows it, and how to change a rate.
> **Last updated:** 2026-11-13

# NESTO Platform, a modular price

A new customer chooses the modules it needs. Each module has three prices a
month:

- **per company** — for each company in the group that uses it;
- **group, at most** — the most its company price comes to for the whole
  group (the cap);
- **per user** — for each person who uses that module (not everyone).

On top come further companies and projects, and the whole is **never less
than €500 a month**. The everyday tools are free.

History: 2026.11 one bundle · 2026.11.1 base + flat module prices · 2026.11.2
per person × every module · 2026.11.3 + €500 minimum · **2026.11.4** (this
one) per company, group cap and per user of each module.

## 1. The price list (EUR a month, 24 months, excl. VAT)

| Module | Per company | Group, at most | Per user |
| --- | --- | --- | --- |
| **Sales** — units, buyers, reservations, contracts | €150 | €375 | €15 |
| Finance | €150 | €375 | €15 |
| Project Management | €120 | €300 | €12 |
| Procurement | €100 | €250 | €10 |
| HR / Workforce | €80 | €200 | €8 |
| Full Legal (includes Legal Documents) | €80 | €200 | €8 |
| Legal Documents on its own | €30 | €75 | €3 |
| Architecture · Engineering · HSE · Inventory / Storage · Contractors | €50 each | €125 each | €5 each |
| Documents, Meetings, Calendar, Timesheets, Daily Log, Announcements | free | | |

The group cap is 2.5 companies' worth: from the third company on, a module's
company price costs nothing more.

| Also | Monthly |
| --- | --- |
| 1 company and 1 active project | included |
| Further company | €250 |
| Further active project | €200 |
| **Minimum** — everything above counts towards it | €500 |

What typical buyers pay a month:

| Buyer | Setup | Monthly |
| --- | --- | --- |
| A small office | 1 company · Architecture (1 user), Engineering (1), Finance (2), Project Management (2) — modules €434 | **€500** (the minimum) |
| A developer | 1 company · Sales, Finance, Project Management, Procurement, all 15 people in all four | €1,300 |
| Everything | 1 company · every module, 15 people in each | €2,325 |
| A group | 3 companies, 3 projects · the developer's four, 25 people in each | €3,500 |

The group: module company prices capped (Sales 3 × €150 = €450 → €375) =
€1,300, users 25 × €52 = €1,300, 2 further companies €500, 2 further projects
€400.

NESTO ROZARIS — selling with the 3D viewer, priced per project — is a
separate product and is unchanged; Sales stays part of it.

## 2. The rules (`lib/modules/pricing/pricing.engine.ts`)

- **A module's charge** = flat price (none today) + company price × companies,
  never more than its group cap + per-user price × its users.
- **Companies a module serves**: the included one, further group companies
  and joint ventures. Documents-only companies use no modules.
- **Users of a module**: the configurator asks how many people use each one
  (`moduleUsers`); a module not given counts every active user. Never more
  than the active users.
- **The minimum**: a setup whose charges come to less than €500 is charged
  €500; the quote shows the top-up as its own line. The launch offer
  discounts the €500 like any NESTO charge (months 1–3 free, 4–6 €250).
- **Full Legal absorbs Legal Documents**: choosing both charges Full Legal only.
- A stored book without company prices or caps reads them as 0, so retired
  books keep their figures.
- Indexation (HICP, 0–5% a year from month 13) applies as before.

## 3. Where it shows

All read from the live price book — no page holds a figure of its own:

- **The bill of quantities** (home page and `/pricing`): the minimum, "Modules,
  for each company" and "Modules, for each user" from the cheapest rates, then
  further company and project (`lib/marketing/price-book.ts`, `priceRows`).
- **The module schedule** on `/pricing#modules`: every module with its three
  rates or "Free", the minimum, then the four buyers above, worked out by the
  configurator's engine (`components/marketing/module-schedule.tsx`).
- **The configurator** (`/pricing`): each module card shows "€150 per company
  + €15 per user / month" and its group cap; the Users step asks the people
  in each chosen module and shows each module's sum; the estimate and review
  show every module's charge and the minimum. A shared link keeps the people
  per module (`mu=sales:5,finance:3`).

## 4. Changing a rate

In the Admin Console, Customers → Pricing: create a draft (it copies the
active book), change the "€ per company", "Group, at most" and "€ per user"
columns or the Platform's "Minimum / month", and publish with a reason. The
old version is retired, never edited, so quotes made under it keep their
figures. The site changes at once.
