> **Chat:** Nesto — mobile for the site team
> **File:** docs/demo-showcase.md
> **About:** The selling demo — a separate demo site (demo.rozaris.com) with its own database, showing Arvela Group, an invented group of ten companies with 46 people, every module filled on every project (units and their sale contracts, procurement and subcontracts, stock, site records, HSE, QA/QC, engineering, finance, people), project conversations with @mentions and temporary passwords; how it is built, set up and reset.
> **Last updated:** 2026-11-13

# Selling demo — Arvela Group

A copy of NESTO at its own address, with its own database, showing an invented
group of companies at work. Prospects sign in, post, @mention, approve and
click through every module without touching rozaris.com or any real
customer. Reset it any time: everything is rebuilt dated from that day.

Everything in it is invented: the group, the companies, the projects and the
people. Registry numbers start with X, which no Albanian NIPT does, and every
mail and web address ends in `.test`, so nothing can be mistaken for, or
reach, a real company or person.

## What is in it

- **Arvela Group** and ten companies. Arvela Ndërtim, Arvela Developments,
  Arvela Infrastruktura, Arvela Inxhinieri and Arvela Hospitality carry a full
  year of work; Arvela Energji, Arvela Pronat, Arvela Betoni, Arvela Pajisje
  and Fondacioni Arvela (documents only) have their details, a head and the
  group's people.
- **Projects:** Kalaja Residence (Tirana), Porta Tower (Durrës), Nyja Logistics
  Park (Vorë), Lungomare Apartments (Vlorë) and Ksamil Bay Hotel & Residences
  (Sarandë); Promenada Durrës (selling and building), Kodra Villas (sold out
  and handed over in 2023) and Rinas Business Park (in design) in Arvela
  Developments' portfolio.
- **Units:** about 670 — flats and penthouses, offices, warehouse bays,
  serviced residences, villas, shops, parking and storage — each published,
  most on a price list. Around 270 sold and 75 reserved, to about 250
  invented buyers (many abroad).
- **Contracts in units:** every sale has its won deal, the reservation that
  converted, a sale contract (often with a parking space or storage on the
  same contract), a payment schedule, invoices for what fell due and the
  payments against them — a few buyers late. Reserved units wait at every
  step: just reserved, a contract asked of Legal, a contract in review.
- **Procurement:** each company's suppliers (Arvela Betoni and Arvela Pajisje
  supply the group's concrete and cranes), subcontractors with their
  insurance and guarantees, supply agreements and subcontracts with
  variations, and every project's purchasing from a draft request through
  RFQs, quotes, orders and deliveries to closed orders, with the finance
  commitment each approved order opens.
- **Stock:** a store on every site, each delivery booked in, materials issued
  to the site week by week, returns, a draft issue, items below reorder.
- **Site:** phases and milestones, a month of daily logs (weather, crews,
  work, plant, deliveries, delays, visitors, instructions), tasks, weekly site
  meetings with minutes, the company calendar with public holidays.
- **HSE and quality:** safety walks, hazards, incidents, permits to work,
  toolbox talks, risk assessments, PPE checks, environmental observations, a
  stop-work order; QA/QC inspections, defects, NCRs and corrective actions;
  drawing registers with revisions, RFIs, submittals and transmittals.
- **Finance and people:** a current budget on every project, supplier bills,
  subcontract valuations and site overheads booked and paid against it;
  timesheets, leave, attendance, and two site crews with workers on every
  building project.
- **46 people**, from the Group Owner (Luan Kelmendi) and the heads of every
  group department to each company's managers and staff.
- **Conversations** on every project: people writing to each other and
  @mentioning colleagues.
- **Sign-in:** each person signs in with the demo password once and must
  choose their own (temporary passwords). The Platform Admin has a separate
  password. Sign-in names are `firstname.lastname` (`luan.kelmendi`,
  `erion.daci`).

## How it is built

The standard demo seed (`prisma/seed.ts`) builds a group of five companies with
every module in use. `prisma/seed-showcase.ts` then dresses it as Arvela
(`prisma/seed/showcase/`):

- `dataset.ts` — the group, companies, projects and people, and what each
  standard name becomes.
- `prose.ts` — one SQL statement that rewrites the standard names in every
  text and JSON column (task titles, notes, posts, file names), never in ids,
  keys, storage paths or URLs. Tested on the full migrated schema.
- `conversations.ts` — the project threads and their @mentions.
- `fill/` — everything each project and company does: `units.ts` (buildings,
  floors, units), `sales.ts` (price lists, buyers, reservations, sale
  contracts, schedules, invoices, payments, leads), `procurement.ts`,
  `inventory.ts`, `site.ts` (programme, daily logs, tasks, calendar),
  `hse.ts`, `quality.ts` (QA/QC and engineering), `meetings.ts` and
  `company.ts` (budgets, costs, time, leave, workforce). Seeded random, so
  every reset gives the same demo, dated from that day; record numbers follow
  each company's own numbering, and the counters move past them so the next
  record a prospect creates gets a free number.
- `apply.ts` — runs it all, removes the standard seed's test tenants, and
  sets the passwords.

Record ids stay the standard seed's, so every module's records keep their
links, and the standard seed and its tests are untouched.

## Setting it up (once)

1. **Demo database** — Vercel → Storage → Create Database → Supabase, named
   `nesto-demo`, in the same region as rozaris.com. In its Supabase project,
   Storage → New bucket `documents`, private.
2. **Demo site** — Vercel → Add New → Project → import NestoERP again, named
   `nesto-demo`, and connect the `nesto-demo` database to it. Environment
   variables, Production:
   - `APP_ENV` = `demo`
   - `AUTH_SECRET` = a new random value (not rozaris.com's)
   - `APP_URL` and `NEXT_PUBLIC_APP_URL` = `https://demo.rozaris.com`
   - `STORAGE_DRIVER` = `supabase`, `STORAGE_BUCKET` = `documents`, and the
     demo project's `SUPABASE_URL` and `SUPABASE_SECRET_KEY`
   - `MAIL_DELIVERY` = `disabled`
   - `NESTO_DEMO_SIGN_IN` = `temporary`, `NESTO_DEMO_EMAIL_DOMAIN` = `arvela.test`
   Domains → add `demo.rozaris.com`.
3. **Secrets for the reset** — GitHub → Settings → Environments → New
   environment `demo`, with these secrets:
   - `DEMO_DATABASE_URL` — the demo database's non-pooling URL
   - `DEMO_SEED_TARGET` — its `host/database`: `aws-0-eu-central-1.pooler.supabase.com/postgres`.
     That pooler host is shared with the live database, so the reset also
     refuses any address carrying the live project's id.
   - `DEMO_PASSWORD` — the temporary password prospects are given
   - `DEMO_ADMIN_PASSWORD` — the demo Platform Admin's, different
   - `DEMO_STORAGE_BUCKET` = `documents`, `DEMO_SUPABASE_URL`, `DEMO_SUPABASE_SECRET_KEY`

## Resetting it

GitHub → Actions → **Demo — reset** → Run workflow, and type the demo database
host (the `DEMO_SEED_TARGET` value). It empties the demo database, migrates
it, loads the standard demo, dresses it as Arvela and fills it. Allow 30 to 60
minutes: the fill writes about ten thousand records over the network. The
run refuses any other database, and the seed's own guard refuses production
and staging.

**Files** — leave it at `supabase`. Choose `none` only while Supabase storage
refuses uploads (a Free plan over its storage quota answers 402): the demo is
filled without its files, so every record is there but opening a document or
photo shows nothing. Reset again with `supabase` once storage is back.

After a reset every temporary password works again for 30 days, and the
Platform Admin (`platform-admin`) signs in with `DEMO_ADMIN_PASSWORD` and
chooses a new one.

## Signing in

Open `https://demo.rozaris.com/login`, sign in as a person with the demo
password, and choose a new password when asked. A good start:

| Sign-in | Who |
|---|---|
| `luan.kelmendi` | Group Owner: the group view of all ten companies |
| `genci.hasani` | CEO, Arvela Ndërtim: Kalaja Residence, the busiest project |
| `erion.daci` | Project manager, Kalaja Residence |
| `klea.marku` | Project manager, Arvela Developments |
| `teuta.brahimi` | CEO, Arvela Hospitality: Ksamil Bay, sales and reservations |
| `anila.gjoni` | Head of Group Finance |

Each account is one person's once claimed: give each prospect a different
person, and reset for a fresh set.
