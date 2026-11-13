> **Chat:** Nesto — mobile for the site team
> **File:** docs/pricing-modules.md
> **About:** How the NESTO Platform is priced — a company choosing its modules or a group of companies with all of them, projects, ROZARIS 3D, users, a €600 minimum — the decisions taken with the owner on 2026-11-13, the rules the engine applies, where the site shows it, and how to change a price.
> **Last updated:** 2026-11-13

# NESTO Platform pricing

The configurator asks, in this order:

1. **What are you?** A **company** or a **group of companies**.
2. **How many projects** are in your portfolio.
3. **ROZARIS 3D** for how many of them, and each one's size — after a short
   explanation with three sketches of what a 3D experience is.
4. **Modules** — a company chooses; a group has them all.
5. **Users** — one number for all modules.
6. **Contract** — 24 or 12 months.

Then the review shows every line of the price with how it is worked out.

History: 2026.11 one bundle · 2026.11.1 base + flat module prices · 2026.11.2
per person × every module · 2026.11.3 + €500 minimum · 2026.11.4 per company,
group cap and per user · **2026.11.5** (this one) company or group.

## 1. The price list (EUR a month, 24 months, excl. VAT)

**A company** — chooses its modules; at least 10 users.

| Module | A month | Per user |
| --- | --- | --- |
| Sales — units, buyers, reservations, contracts | €150 | €15 |
| Finance | €150 | €15 |
| Project Management | €120 | €12 |
| Procurement | €100 | €10 |
| HR / Workforce · Full Legal (includes Legal Documents) | €80 each | €8 each |
| Legal Documents on its own | €30 | €3 |
| Architecture · Engineering · HSE · Inventory / Storage · Contractors | €50 each | €5 each |
| Documents, Meetings, Calendar, Timesheets, Daily Log, Announcements | free | free |

**A group of companies** — every module, for every company; at least 2
companies and 25 users.

| What | Monthly |
| --- | --- |
| Each company in the group | €600 |
| Each user | €60 |
| Each joint-venture company | €250 |
| Each documents-only company | €100 |

**Both**

| What | Monthly |
| --- | --- |
| Projects in the portfolio | the first included, €200 each further |
| ROZARIS 3D, per project — Basic / Large / Village | €650 / €1,300 / €2,600 (12 months: twice) |
| **Minimum** — everything above, 3D included, counts towards it | €600 |

ROZARIS 3D includes Sales: a company with 3D projects does not pay for the
Sales module. The old NESTO ROZARIS product is folded in: a developer that
only sells picks Company, no modules, and its 3D projects.

What typical buyers pay a month:

| Buyer | Setup | Monthly |
| --- | --- | --- |
| A small office | company · Architecture, Engineering, Finance, Project Management · 10 users | €370 + 10 × €37 = **€740** |
| A developer | company · Sales, Finance, Project Management, Procurement · 15 users | €520 + 15 × €52 = **€1,300** |
| Selling in 3D | company · no module · one Basic 3D project · 10 users | **€650** |
| A group | 3 companies · 25 users · 3 projects | €1,800 + €1,500 + €400 = **€3,700** |

## 2. The rules (`lib/modules/pricing/pricing.engine.ts`)

- **Customer** (`customer` on the request): `COMPANY` unless `GROUP` is asked
  and the book prices a group (`customers.group`).
- **A company**: each chosen module costs `monthlyPriceCents` +
  `monthlyPerUserCents` × users. No further companies. Users at least
  `customers.company.minUsers`.
- **A group**: every public module is included (`reason: "GROUP"`); its line
  is companies × `perCompanyCents` + users × `perUserCents`. Companies at
  least `minCompanies`, users at least `minUsers`; joint ventures and
  documents-only companies at their own prices.
- **ROZARIS 3D**: each project priced by its class; it brings the modules the
  ROZARIS product included (Sales) at no charge (`reason: "ROZARIS"`). Never
  more 3D projects than projects: the portfolio is raised to the 3D count.
- **Projects**: the first included, each further one at its price.
- **Minimum**: when the whole month, ROZARIS 3D included, is under €600 the
  quote adds a top-up line. The launch offer discounts NESTO charges and the
  top-up, never ROZARIS.
- **Older books** still read: 2026.11.4's per-company price becomes the
  module's monthly price, its group cap is dropped, and a book without
  customer rules offers no group.

## 3. Where it shows

All read from the live price book — no page holds a figure of its own:

- **The bill of quantities** (home page and `/pricing`): the minimum, a
  company's modules and users from the cheapest, the group's prices,
  joint-venture and documents-only companies, further project, ROZARIS 3D
  (`lib/marketing/price-book.ts`, `priceRows`).
- **The module schedule** on `/pricing#modules`: every module's price a month
  and per user, the group's line, the minimum, then the four buyers above,
  worked out by the configurator's engine
  (`components/marketing/module-schedule.tsx`).
- **The configurator** (`components/pricing/pricing-wizard.tsx`): the six
  steps above; the address keeps the configuration
  (`type=company|group&companies=&projects=&rozaris=&modules=&users=`), and old
  links (`foundation=`, `mode=`, old step names) are rewritten.

## 4. Changing a price

In the Admin Console, Customers → Pricing: create a draft (it copies the
active book), change a module's "€ a month (company)" or "€ per user", the
Platform's minimum, the company's fewest users or the group's prices and
minimums, and publish with a reason. The old version is retired, never edited,
so quotes made under it keep their figures. The site changes at once.
