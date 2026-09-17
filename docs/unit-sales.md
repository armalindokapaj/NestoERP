# Selling units: price, reservation and sale (E-05E)

Sales works on the same units E-05B created and E-05D publishes. There is no
Sales copy of a unit, of a client or of a deal: a unit's commercial side is a
profile beside the unit, a reservation points at the canonical Client and the
CRM's Opportunity (the unit page calls it the *Deal*), and a deal holds units by
their ids.

```
ONE UNIT · ONE CLIENT · ONE DEAL · MANY UNITS PER DEAL · ZERO DUPLICATION
```

```
NOT_FOR_SALE ──put_on_sale──→ FOR_SALE ──hold (reason)──→ ON_HOLD
      ↑                          │  ↑                        │
      └──────take_off_sale───────┘  └──────release_hold──────┘
                                 │                           │
                                 └──reserve──→ RESERVED ←──reserve
                                                │   ↑
          release (reason) / expiry ←───────────┘   │
          → FOR_SALE                                │
                                     mark_sold      │ reopen → RESERVED (reason)
                                         ↓          │
                                        SOLD ───────┘
                                         └── reopen → FOR_SALE (reason)
```

Commercial status is **not** publication status (§6, E-05D §15). A unit is put
on sale and reserved only while it is active and **Published**; once on sale, it
cannot be unpublished, sent back, or archived until it is taken off sale.

## Where things live

| Concern | Location |
| --- | --- |
| Types, labels, DTOs (client-safe) | `lib/modules/sales/units/unit-sales.types.ts` |
| Price per m², eligibility, the Sold check (pure, client-safe) | `lib/modules/sales/units/unit-sales.rules.ts` |
| The state machine | `lib/modules/sales/units/unit-commercial.machine.ts` (`unit_commercial`, registered in `lib/core/state/registry.ts`) |
| Capabilities, the profile and its row lock, closing a reservation, notices | `lib/modules/sales/units/unit-sales.core.ts` |
| Price, status, reserve, extend, release, correct, sell, reopen, deal units | `lib/modules/sales/units/unit-sales.service.ts` |
| The inventory query | `lib/modules/sales/units/unit-sales.inventory.ts` |
| The expiry job | `lib/modules/sales/units/unit-sales.expiry.ts` (`sales.unit-reservations`) |
| Validation | `lib/modules/sales/units/unit-sales.schema.ts` |
| Reservation length | `lib/modules/settings/sales-settings.service.ts` (`CompanySettings.unitReservationDays`) |
| API | `app/api/project-units/[unitId]/{sales,sales/status,reservations,mark-sold,reopen-sale}`, `app/api/unit-reservations/[reservationId]/{extend,release,correct}`, `app/api/projects/[projectId]/sales/units`, `app/api/sales/opportunities/[opportunityId]/units/**`, `app/api/settings/sales` |
| UI | `app/(nesto)/projects/[projectId]/sales` (inventory), `app/(nesto)/projects/[projectId]/units/[unitId]/sales` (the unit's Sales section), `app/(nesto)/settings/sales`, `components/sales/unit-sales/*` |
| Demo data | `prisma/seed/unit-sales.ts` |

The `sales` domain owns the six new tables (`scripts/architecture/ownership.ts`).
It reads units only through project structure's door (`findReadableUnit`,
`readableUnitWhere`), creates clients through `createClientRecord` and deals
through `createOpportunityInTransaction`, never by writing their tables.

## Data

Migration `20260917170000_unit_sales_e05e`, purely additive. Every existing unit
is Not For Sale — it simply has no commercial profile yet (§58); nothing is put
on sale by a migration.

- **UnitCommercialProfile** — one per unit, created the first time Sales acts on
  it: `status` (moved only by the machine), `askingPrice` DECIMAL(18,2),
  `currency`, `priceBasis` (saleable, internal or gross area, or a fixed price),
  `holdReason`, `holdUntil`, `heldByMemberId`, `salesNotes`, `statusChangedAt`,
  `version`.
- **UnitPriceHistory** — every change of price, currency or basis: old and new
  values, reason, who, when. Never updated.
- **UnitReservation** — `clientId` and `opportunityId` (both required),
  `status` (`ACTIVE`, `EXPIRED`, `RELEASED`, `CANCELLED`, `CONVERTED_TO_SALE`),
  `reservedAt`, `expiresAt`, `expiryWarnedAt`, `closedAt`, `closedByMemberId`,
  `closeReason`, `agreedPrice`, `currency`, `notes`, `createdByMemberId`,
  `version`. Never deleted (§27).
- **UnitReservationExtension** — old and new expiry, reason, who, when (§26).
- **OpportunityUnit** — a unit in a deal, with the agreed price for it (§17, §43).
- **UnitCommercialStatusHistory** — every status move, with its reason, source
  (`USER`, `SYSTEM_EXPIRY`; `LEGAL`, `FINANCE` and `IMPORT` are for E-05F and
  later), actor, reservation and deal.
- **CompanySettings.unitReservationDays** — default 7.

Held by the database, not only the service:

| Rule | How |
| --- | --- |
| At most one active reservation per unit (§21) | partial unique index `unit_reservations_one_active_per_unit` on `(unitId) WHERE status = 'ACTIVE'` |
| A profile, price, reservation, deal link and status row belong to their unit's project and company | composite FK `(unitId, projectId, companyId)` → `project_units` |
| A unit is in a deal once | unique `(opportunityId, unitId)` |
| No negative asking or agreed price; a reservation ends after it starts; 1–90 reservation days | `CHECK` constraints |

## Rules

| Rule | Where |
| --- | --- |
| Only an active, Published unit is put on sale or reserved: *This Unit is not published for Sales use.* (§6, §22) | `sellability`, checked under the profile lock; `UNIT_NOT_SELLABLE` |
| A unit on sale, on hold, reserved or sold is not unpublished, sent back from Published, or archived (§35) | `assertNotOnSale` in `unit-publishing.service.ts`; `UNIT_ON_SALE` |
| A unit with any sales history is not deleted | `deleteUnit`; `UNIT_REFERENCED` |
| Price per m² is derived, never stored: the asking price over the area its basis names, exact to the cent; none for a fixed price or a missing area (§10) | `pricePerSqm`; the inventory computes the same in SQL to filter and sort |
| A price, currency or basis change writes price history with its reason; notes alone do not. A sold unit's price is frozen (§12) | `updateCommercialDetails`; `UNIT_SOLD` |
| Holding needs a reason; the hold may carry a review date (§28) | the machine's `requiresReason`; `changeSaleStatus` |
| Reserving needs a client and a deal — an existing client the reader may open or a new one, an open deal of that client or a new one — and an expiry, defaulting to the company's days (§19-§24). A new client that looks like one the company has is offered back first (409 with the matches); the reader confirms to create it anyway | `reserveUnit`; *Select a Client before reserving this Unit.*, *Create or select a Deal before reserving this Unit.*, *That deal belongs to another client.* |
| The client, the deal, the reservation, the deal link, the status move, history, audit and activity commit together or not at all (§23, §49) | one `runInTransaction` |
| Two people reserving at once: exactly one succeeds; the other is told *This Unit has just been reserved by another user. Refresh to see the current status.* (§50, §60) | the profile row lock, then the partial unique index as the last word; `UNIT_ALREADY_RESERVED` |
| Extending needs a later date and a reason; it clears the expiry warning and keeps the old and new dates (§26) | `extendReservation` |
| Releasing needs a reason; the reservation stays in history and the unit is For Sale (§27) | `releaseReservation` |
| Marking Sold needs a reserved unit with an active, unexpired reservation, a client, a deal and an agreed price, and whatever the company's Sold rule adds (E-05F); the reservation becomes `CONVERTED_TO_SALE` and the asking and agreed prices stay distinct (§29, §30). The deal is not marked Won (§18) | `canMarkUnitSold`; `UNIT_NOT_SELLABLE_YET` with `details.missing` |
| Reopening a sale is its own grant and needs a reason. Back to For Sale cancels the converted reservation; back to Reserved cancels it and opens a new active one for the same client, deal and agreed price (§31) | `reopenSale` |
| An administrative correction of the agreed price or notes needs `sales_correct` and a reason | `correctReservation` |
| A unit is taken out of a deal only when the deal does not hold it reserved or sold (§18) | `removeUnitFromDeal`; `DEAL_UNIT_HELD` |
| Every change names the version it read: *This unit's sales were updated by another user. Refresh before continuing.* | `UNIT_SALES_STALE`, `RESERVATION_STALE` |

## The expiry job

`sales.unit-reservations` runs every five minutes, per company, skipping
suspended companies and companies with Projects switched off
(`docs/worker-matrix.md`). For each active reservation whose `expiresAt` has
passed it closes the reservation as `EXPIRED` — conditional on it still being
active and still expired, so an extension saved a moment earlier wins — moves the
unit from Reserved to For Sale with the machine's `expire_reservation` (checked
with `canMove`, written conditional on `RESERVED`), writes the status history as
`SYSTEM_EXPIRY`, the audit event as the system, and tells the salesperson and
the deal owner once. A reservation expiring within 24 hours is warned about once
per expiry date. One reservation failing rolls back alone; the run reports a
partial failure and the next run picks it up.

Between a reservation's expiry and the next run it is still `ACTIVE`: the page
says *Expired — being released*, and it cannot be marked Sold — extend it first.

## Authorisation (§32, §38, §39, §46, §67)

Every read and write goes through the unit's project door first; a unit,
reservation or deal the reader cannot open is a 404 that names nothing. Then the
action's permission — never a role name.

| Permission | Allows |
| --- | --- |
| `project.unit.sales.view` | The inventory, a unit's Sales section, the commercial history |
| `project.unit.sales_status.manage` | Put on sale, take off sale, hold, release a hold |
| `project.unit.price.manage` | Asking price, currency, basis, sales notes |
| `project.unit.reserve` | Reserve |
| `project.unit.reservation.extend` | Extend |
| `project.unit.reservation.release` | Release |
| `project.unit.mark_sold` | Mark Sold |
| `project.unit.reopen_sale` | Reopen a sale |
| `project.unit.sales_correct` | Correct a reservation's agreed price or notes |

| Role | See sales | Price, status, reserve, extend, release, sell | Reopen, correct |
| --- | --- | --- | --- |
| Owner; Sales as a company department manager or group head | yes | yes | yes |
| Sales | yes | yes | no |
| CEO, Project Manager, Finance, Legal, Viewer | yes | no | no |
| Architect (any position), Engineer, others | commercial status on the unit only | no | no |

Client and deal names are shown, and searched, only for readers with the Clients
module and `client.view`, or the Sales module and `sales.opportunity.view` (§32).
Creating a client in the reserve form needs `client.create`, and a deal
`sales.opportunity.create`, checked inside the services that create them.

## API

| Method and path | Does |
| --- | --- |
| `GET /api/projects/:projectId/sales/units` | The inventory: `q`, `buildingId`, `floorId`, `unitTypeId`, `commercialStatus`, `areaMin/Max`, `bedrooms`, `bathrooms`, `orientation`, `position`, `priceMin/Max`, `pricePerSqmMin/Max`, `sort`, `page`, `limit` (≤ 100, default 50). Counts per status ignore the status filter |
| `GET /api/project-units/:unitId/sales` | Status, price, price per m², hold, active and past reservations, deals, histories, the Sold check, defaults, capabilities |
| `PATCH /api/project-units/:unitId/sales` | `{ askingPrice, currency?, priceBasis, salesNotes?, reason?, expectedVersion? }` |
| `POST /api/project-units/:unitId/sales/status` | `{ action: put_on_sale \| take_off_sale \| hold \| release_hold, reason?, holdUntil?, expectedVersion? }` |
| `POST /api/project-units/:unitId/reservations` | `{ clientId \| newClient{ name, type, email?, phone?, acceptDuplicate? }, opportunityId \| newDeal{ name? }, expiresAt?, agreedPrice?, currency?, notes?, expectedVersion? }` → 201 |
| `POST /api/unit-reservations/:reservationId/extend` | `{ expiresAt, reason, expectedVersion? }` |
| `POST /api/unit-reservations/:reservationId/release` | `{ reason, expectedVersion? }` |
| `POST /api/unit-reservations/:reservationId/correct` | `{ agreedPrice, currency?, notes?, reason, expectedVersion? }` |
| `POST /api/project-units/:unitId/mark-sold` | `{ expectedVersion? }` |
| `POST /api/project-units/:unitId/reopen-sale` | `{ to: FOR_SALE \| RESERVED, reason, expiresAt?, expectedVersion? }` |
| `GET`, `POST /api/sales/opportunities/:opportunityId/units` | The deal's units the reader may open; `{ unitId, agreedPrice?, currency? }` adds one without reserving it |
| `DELETE /api/sales/opportunities/:opportunityId/units/:unitId` | Takes a unit out of the deal |
| `GET`, `PATCH /api/settings/sales` | `{ unitReservationDays }` (1–90) |

Paths follow E-05B's `/api/project-units/...`; the deal is the CRM's opportunity,
so its units live under `/api/sales/opportunities`.

## Notifications, audit and activity (§52-§54)

Notification category **Sales** (*Shitjet*), for readers holding
`project.unit.sales.view`, sent to the salesperson who reserved and the deal
owner, never the person acting: `UNIT_RESERVATION_EXPIRING`,
`UNIT_RESERVATION_EXPIRED`, `UNIT_RESERVATION_RELEASED`, `UNIT_MARKED_SOLD`.

Audit (module `sales`, category `SALES`): `UNIT_COMMERCIAL_STATUS_CHANGED`,
`UNIT_PRICE_CHANGED`, `UNIT_RESERVED`, `UNIT_RESERVATION_EXTENDED`,
`UNIT_RESERVATION_RELEASED`, `UNIT_RESERVATION_EXPIRED` (as the system),
`UNIT_RESERVATION_CORRECTED`, `UNIT_MARKED_SOLD`, `UNIT_SALE_REOPENED`,
`DEAL_UNIT_LINKED`, `DEAL_UNIT_UNLINKED`; and `COMPANY_SALES_SETTINGS_UPDATED`
(settings). All written in the transaction of the change.

Activity on the unit (module `sales`), shown in the unit's Activity section to
readers who may see sales, without client names: price changes, put on sale,
held, reserved until a date, extended, released, corrected, marked Sold, sale
reopened, added to and removed from a deal.

## Screens

- **Project → Sales** `/projects/:projectId/sales` — quick filters with counts
  (All, For Sale, On Hold, Reserved, Sold, Not For Sale), search (unit code or
  name, and client or deal name when visible), filters (building, floor, type,
  bedrooms, bathrooms, orientation, position, saleable area, price, price per
  m²), sort, 50 a page, the filters in the URL. Desktop: a table of unit and
  type, location, area, beds, status, asking price, price per m², client, deal
  and expiry. Phone: cards with code, status, price, place, area, client and
  expiry, and **Open**, **Reserve** and **Release** where permitted.
- **The unit's Sales section** `/projects/:projectId/units/:unitId/sales` — the
  status, asking price, price per m² and basis, the hold; the actions the reader
  may take (Put on sale, Reserve, Mark Sold, Extend, Release, Hold, Release
  hold, Reopen sale, Set/Change price; Correct reservation and Take off sale in
  the menu); the active reservation with client, deal, dates, salesperson,
  agreed price and extensions; every reservation; the deals holding the unit;
  price and status history. A unit that is not published says so instead of
  offering the actions. `?action=reserve` or `?action=release` opens that dialog.
- **The unit header** shows the commercial status beside the publication status
  for everyone who can open the unit; the unit list has a Sales column.
- **The deal** `/sales/opportunities/:id` has a Units panel: each unit, its
  project and place, status, reservation and agreed price; units not held can be
  removed.
- **Settings → Sales** (translated): reservation length in days, and the Sold
  rule (E-05F).

## Seed

Riverside Residences, Block A: **A-101** For Sale at €185,000 (raised from
€179,000); **A-102** Reserved for ACME Developments on *Riverside phase 2*, five
days left, agreed €126,500 against €129,500; **A-201** Sold to Beta Properties;
**A-202** On Hold with a reason and a review date; **A-203** Reserved on the same
ACME deal, extended once; **A-204** Published and Not For Sale. E-05D's seed
publishes A-201 to A-204 with their Sales Plans and floor plans for this. Company
B's **OF-001** is Reserved for Isarwerk Holding on its own deal.

## Tests

| Suite | Covers |
| --- | --- |
| `tests/unit/sales/unit-sales-rules.test.ts` | Price per m² to the cent and when there is none; eligibility; everything the Sold check can find missing, an expired reservation included; the machine's moves and reasons; validation; the default role policy |
| `tests/api/sales/unit-sales.test.ts` | Price history and price per m²; status moves and eligibility; reserving with existing and new client and deal, the refusals and messages, the duplicate client offered back; exactly one of two concurrent reservations; extend and release with history; a multi-unit deal releasing one unit; Sold, the agreed price, the expired-reservation guard, reopen both ways; publishing and deletion guards; access for each role and Company B; the inventory's filters, search, counts and hidden names; the settings |
| `tests/api/jobs/sales.unit-reservations.test.ts` | Expires once and audits as the system; warns once per expiry date; an extension saved mid-run wins; two overlapping runs; company isolation; suspended companies and Projects switched off; one failing reservation rolls back alone |
| `tests/security/*` | Every new route swept both ways between companies: 17 foreign-id calls each way, all 404 |
| `tests/e2e/modules/unit-sales.spec.ts` | Sales prices, puts on sale, reserves for a new client and deal, extends and sells; the Head of Group Sales reopens, reserves for an existing client and releases; the inventory's quick filter and search; a draft unit cannot be offered; an Architect sees the status and not the sale |
| `tests/e2e/responsive/unit-sales-mobile.spec.ts` | Reserved units as cards on a phone and a card's Release opening the dialog, without horizontal scroll |

## Limits

- **The company Sold rule is E-05F's**, now built: `canMarkUnitSold` adds the
  company's rule (signed contract by default) to E-05E's reservation, client,
  deal and agreed price, and only unlocks Mark Sold. A unit under a live contract
  keeps its reservation — it is not expired, released or reopened — and
  `docs/unit-finance.md` is the contract for both.
- **No currency conversion.** Price filters and sorting compare amounts as
  numbers whatever their currency; a project priced in one currency reads
  correctly.
- **No bulk pricing, price lists or imports**, and no unit picker on the deal
  page: a unit joins a deal when it is reserved for it, or through the API.
- **Expiry lags by up to one job interval** (five minutes); the page and the Sold
  check treat a passed expiry as expired meanwhile.
- **Module pages are English**; only Settings → Sales and the notification
  category are translated.
- **The development server needs a restart** after this migration and
  `prisma generate`, and `pnpm db:seed` (or `pnpm access:sync`) before anybody
  holds the new permissions.
