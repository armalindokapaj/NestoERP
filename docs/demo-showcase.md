> **Chat:** Nesto — mobile for the site team
> **File:** docs/demo-showcase.md
> **About:** The selling demo — a separate demo site (demo.rozaris.com) with its own database, showing Arvela Group, an invented group of ten companies with 46 people, every module in use, project conversations with @mentions and temporary passwords; how it is built, set up and reset.
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
  (Sarandë), with tasks, milestones, daily logs, defects, HSE, documents,
  meetings, approvals, units, buyers, reservations, contracts, budgets,
  invoices, purchase requests and orders; Promenada Durrës, Kodra Villas and
  Rinas Business Park in Arvela Developments' portfolio.
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
- `apply.ts` — runs it all and sets the passwords.

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
   - `DEMO_SEED_TARGET` — its `host/database`, e.g. `db.xxxx.supabase.co/postgres`
   - `DEMO_PASSWORD` — the temporary password prospects are given
   - `DEMO_ADMIN_PASSWORD` — the demo Platform Admin's, different
   - `DEMO_STORAGE_BUCKET` = `documents`, `DEMO_SUPABASE_URL`, `DEMO_SUPABASE_SECRET_KEY`

## Resetting it

GitHub → Actions → **Demo — reset** → Run workflow, and type the demo database
host (the `DEMO_SEED_TARGET` value). It empties the demo database, migrates
it, loads the standard demo and dresses it as Arvela. About five minutes. The
run refuses any other database, and the seed's own guard refuses production
and staging.

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
