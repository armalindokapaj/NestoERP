# NESTO V0.1

**ERP Foundation: Access, Shell, Dashboards, Module System & Projects**

V0.1 is not the finished ERP. It is the permanent foundation: one application,
one design system, one app shell, one navigation engine, one access system, one
core data model and one reusable module shell. All 16 company roles sign in and
meet NESTO from their own perspective, every module has a real route with real
scoped data, and Projects is fully functional as the reference implementation
every later module follows.

Implements PRDs #1–#10.

| PRD | Delivered by |
| --- | --- |
| #1 Product Foundation | the app, the public site, `config/brand.ts` |
| #2 Design System | `styles/tokens.css`, `components/ui`, `components/charts` |
| #3 Application Shell & Navigation | `components/layout`, `config/navigation.ts` |
| #4 Dashboard System | `config/{dashboards,widgets,kpis,quick-actions}.ts`, `lib/modules/dashboard` |
| #5 Roles, Permissions & Access Matrix | `config/{access,permissions,role-defaults}.ts`, `lib/access` |
| #6 Authentication & User Context | `lib/auth`, `lib/context` |
| #7 Module Shell System | `components/modules`, `components/data`, `lib/modules/records` |
| #8 Core Data Model | `prisma/schema.prisma` |
| #9 Demo Data & Testing | `prisma/seed`, `tests/`, `scripts/verify-roles.ts` |
| #10 Projects Module | `lib/modules/projects`, `app/(nesto)/projects`, `app/api/projects` |

---

## Getting started

Requirements: Node 20+, pnpm, PostgreSQL 14+.

```bash
pnpm install

cp .env.example .env          # then fill in DATABASE_URL and AUTH_SECRET
#   AUTH_SECRET: openssl rand -base64 32

createdb nesto_erp            # or point DATABASE_URL at an existing database
pnpm db:migrate               # apply prisma/migrations
pnpm db:seed                  # two demo companies, 16 role accounts, full dataset

pnpm dev                      # http://localhost:3000
```

Starting again from scratch:

```bash
pnpm db:reset:demo            # drop, re-migrate and re-seed
```

`db:reset:demo` refuses to run against a production environment, and the seed
itself requires both `NODE_ENV !== production` and an explicit
`ALLOW_DEMO_SEED=true` before it will place demo records anywhere else.

### Scripts

| Script | Purpose |
| --- | --- |
| `pnpm dev` | Development server |
| `pnpm build` / `pnpm start` | Production build and server |
| `pnpm typecheck` | TypeScript, no emit |
| `pnpm lint` | ESLint |
| `pnpm db:migrate` | Create / apply Prisma migrations |
| `pnpm db:deploy` | Apply migrations without generating one (CI, deploys) |
| `pnpm db:seed` | Seed the demo dataset and validate it |
| `pnpm db:reset:demo` | Drop, re-migrate and re-seed |
| `pnpm db:studio` | Prisma Studio |
| `pnpm test` | Unit + integration + API (vitest) |
| `pnpm test:unit` | Pure resolver logic — no database needed |
| `pnpm test:integration` | Context, scope and isolation against PostgreSQL |
| `pnpm test:api` | Projects authorisation through the real service layer |
| `pnpm test:e2e` | Browser journeys (Playwright) |
| `pnpm test:e2e:all-browsers` | …plus Firefox, WebKit and mobile Safari |
| `pnpm verify:roles` | Walk all 16 roles over HTTP against a running server |

---

## Development accounts

Two demo companies. **NESTO Demo Construction** is the primary workspace, with
one account for each of the 16 roles. **NESTO Second Company** exists so tenant
isolation can actually be proven rather than assumed — one company cannot show
you anything about the other, and its reduced module set is how the
"module unavailable" path is tested.

The roster lives in [`config/demo-accounts.ts`](config/demo-accounts.ts); the
seed, the login page and the test helpers all read it, so they cannot disagree.
The password comes from `NESTO_DEMO_PASSWORD` and defaults to `nesto1234` in
development.

| Email | Role | | Email | Role |
| --- | --- | --- | --- | --- |
| `owner@nesto.test` | Owner | | `finance@nesto.test` | Finance |
| `admin@nesto.test` | Admin | | `legal@nesto.test` | Legal |
| `it@nesto.test` | Company IT | | `sales@nesto.test` | Sales |
| `hr@nesto.test` | HR | | `procurement@nesto.test` | Procurement |
| `ceo@nesto.test` | CEO / Director | | `inventory@nesto.test` | Stock / Inventory |
| `pm@nesto.test` | Project Manager | | `qaqc@nesto.test` | QA/QC |
| `architect@nesto.test` | Architect | | `hse@nesto.test` | HSE |
| `engineer@nesto.test` | Engineer | | `viewer@nesto.test` | Viewer |

Company B: `owner-b@nesto.test`, `viewer-b@nesto.test`.

Fixtures that exist to be refused: `inactive-user@`, `suspended-user@`,
`inactive-membership@`, `suspended-membership@` and `suspended-company@`. Each
fails authentication in its own specific way, and each has a test that says so.

`multicompany@nesto.test` holds two memberships — Architect in Company A,
Project Manager in Company B — which proves the data model supports a different
role per company well before the company switcher exists.

### Signing in quickly

In development the login page shows a **demo account picker** — one click signs
you in as that role, no typing. Once inside, the **role switcher** in the top bar
re-renders the whole workspace as any of the 16 roles without signing out.

Both are gated on `NODE_ENV`. In a production build the picker is not rendered,
the switcher is not rendered, and the demo sign-in action refuses. The picker
sends only a role key to the server — the demo password is resolved in
[`lib/actions/demo.ts`](lib/actions/demo.ts) and never enters the browser
bundle, so no credential ships to the client in any build.

### Adding a role

1. Add the key to `ROLE_KEYS` and `roles` in `config/roles.ts`.
2. Add its row to the access matrix in `config/role-defaults.ts` — that one
   table decides its navigation, its module access, its data scope and every
   granular permission it holds.
3. Give it a dashboard in `config/dashboards.ts`.
4. Add its demo account to `config/demo-accounts.ts`.
5. `pnpm db:seed`.

It then appears in the sidebar, the login picker, the role switcher, the Roles
settings page, `pnpm verify:roles` and the test matrix — without touching a
component. Roles are database rows rather than an enum, so a custom role later
needs no migration.

---

## Architecture

```
Request
   ↓
Session cookie                       middleware.ts — is there a session?
   ↓
resolveUserContext()                 lib/context — the one resolver
   ↓
User → Membership → Company → Role → Permissions → Module access → Scope
   ↓
   ├── Navigation resolver  ──→  Sidebar and drawer (one data source)
   ├── Dashboard resolver   ──→  /dashboard for all 16 roles
   └── Module resolver      ──→  Tabs, actions and scoped records
                                        ↓
                                 Server authorisation
                                 Company + permission + scope
                                        ↓
                                    Allow / deny
```

### Configuration is the product

Nothing about a role is hard-coded in a component. Everything a role sees comes
from `config/`:

| File | Owns |
| --- | --- |
| `config/roles.ts` | The 16 roles |
| `config/access.ts` | Access levels and data scopes |
| `config/permissions.ts` | The permission registry — 109 `resource.action` keys |
| `config/role-defaults.ts` | **The role × module access matrix** (PRD #5 §10) |
| `config/modules.ts` | Module registry: routes, icons, group, sections, permissions |
| `config/navigation.ts` | The navigation resolver |
| `config/widgets.ts` `config/kpis.ts` `config/quick-actions.ts` | The dashboard registries |
| `config/dashboards.ts` | Role → KPIs, widgets, quick actions |
| `config/demo-accounts.ts` | The demo roster |
| `config/settings.ts` | Settings sections |

`config/role-defaults.ts` is the single source of truth. It transcribes the PRD
matrix cell for cell in the PRD's own shorthand:

```ts
PROJECT_MANAGER: {
  projects: "M/P", tasks: "M/P", clients: "C/P", documents: "C/P",
  finance: "V/P", hr: "V/P", contracts: "V/P",
  procurement: "C/P", inventory: "V/P", qaqc: "C/P", hse: "C/P",
  team: "V/P", company: "V/C", support: "V/C",
},
```

Granular permissions are then *derived* from the access level through per-module
ladders, so a cell and the permissions it implies cannot drift. Navigation,
dashboards, module tabs, route guards, the API layer and the database seed all
resolve from this one file, and a test asserts that the seeded rows still match
it.

There is exactly **one** dashboard page rendering all 16 role dashboards, and
one module-section component rendering every department module's lists.

### Permissions

Permissions are `resource.action` strings. Feature code asks
`can(context, "project.create")` — never `if (role === "OWNER")`. Read-only
roles have every mutating grant stripped whatever the ladders say, so a Viewer
cannot reach `/projects/new` or any mutation endpoint.

Enforcement runs at three levels, on purpose:

1. **`middleware.ts`** — edge. Answers one question: is there a session? The
   cookie deliberately carries no role or permission data, so a stale or
   tampered cookie can never widen access.
2. **`requireModule()` / `requirePermission()`** — server components, from the
   live database, *before* anything is streamed. That is what makes an
   unauthorised request a real HTTP redirect rather than a flash of restricted
   markup.
3. **`assertModule()` / `assertPermission()`** — the service layer, so the API
   and the UI can never be out of step.

A record outside the caller's scope answers **404, not 403** — a 403 would
confirm the record exists.

> The authenticated app has exactly one `loading.tsx`, on the dashboard. A
> loading file opens a Suspense boundary, and once the shell has flushed, a
> guard's `redirect()` below it can only arrive as a client-side navigation
> inside a 200 response. Every other route renders its guard before anything is
> sent. The dashboard is safe because every role may open it.

### Data scope

Five scopes, applied in the database and never in the browser:

| Scope | Resolved through |
| --- | --- |
| `SELF` | the member's own records |
| `ASSIGNED` | `ProjectMember`, `Task.assigneeMemberId` |
| `PROJECT` | `ProjectMember` |
| `DEPARTMENT` | `CompanyMember.departmentId` |
| `COMPANY` | `companyId` |

Every list query composes: company → archive state → permission scope →
search → filters → sort → pagination. `companyId` is the first clause in every
one of them, for the Owner as much as for a Viewer.

Documents are the sharpest case: a document is reachable only through its
*parent's* permissions. A project document follows project access, a client
document follows client access, and a company-level document requires
company-scope access to the module it was filed under — which is what keeps
"Company Financial Summary.pdf" away from an Architect whose Finance access is
scoped to their own projects.

### Auth and user context

Auth.js v5 with a Credentials provider. The signed cookie carries only a user
id, an email and a **session id** — nothing about what that person may do.

Every request re-reads the session row, the membership and the company from the
database, so disabling a membership or suspending a company takes effect on the
*next request* rather than whenever a token happens to expire. Sign-out deletes
the row; a password reset deletes every row for that user.

- `lib/auth/auth.config.ts` — edge-safe half (middleware imports only this)
- `lib/auth/index.ts` — the Credentials provider and the database lookup
- `lib/auth/session-store.ts` — server-side session records
- `lib/auth/password-reset.ts` — hashed, expiring, single-use reset tokens
- `lib/context/build-context.ts` — the resolver, testable without a request
- `lib/context/current-user.ts` — `requireUserContext()`, `requireModule()`

Failures are distinguished rather than lumped together: not signed in, session
expired, account unavailable, membership inactive, company suspended and
configuration error each go somewhere that says what happened.

### Module shell

Every module plugs into one shell. `resolveModuleExperience(context, "finance")`
answers, in one place, what *this* user's Finance looks like: access level, data
scope, which tabs render, which actions are offered.

Tabs are routes (`/projects/all`), not client state, so deep links, refresh and
back/forward work without extra code. A tab the user cannot open is absent
rather than disabled.

The department modules — Finance, HR, Sales, Legal, Procurement, Inventory,
QA/QC, HSE, Support — plus Tasks, Clients and Documents are declared in
[`lib/modules/records/`](lib/modules/records): columns, filters, scoped queries,
detail fields and approval rules. Their route files are three lines each. The
business content changes; the interaction architecture does not.

### Projects: the reference module

Projects is the implementation standard for every module that follows
(PRD #10 §252). It carries the full stack:

```
lib/modules/projects/
  project.schema.ts       Zod — the same validation on form and server
  project.status.ts       transition table, schedule derivation
  project.repository.ts   queries, always scoped
  project.service.ts      permission → scope → validate → transaction → activity
  project.query.ts        URL parameters → a validated list query
  project.types.ts        explicit DTOs, never a raw Prisma model
```

Create, edit, archive, restore, project membership, tasks, documents and
activity — all transactional, all audited, all scope-checked, all reachable
through both server actions and `app/api/projects`.

### Database

The full core data model (PRD #8): `Company`, `User`, `CompanyMember`,
`Department`, `Role`, `Permission`, `RolePermission`, `Module`, `CompanyModule`,
`RoleModuleAccess`, `Project`, `ProjectMember`, `Client`, `Contact`, `Task`,
`Document`, `Activity`, `Session`, `PasswordResetToken`, `AuthEvent` — plus the
small module test records that make each department module's shell exercisable.

The role lives on `CompanyMember`, never on `User`, which is what lets one
person hold a different role in each company. Prisma foreign keys cannot
guarantee that two related records share a company, so the service layer
re-reads every related id inside the current company before writing.

### Project structure

```
app/
  (public)/
    (site)/           the public site — home, platform, pricing, security,
                      about, contact, faq, privacy, terms
    login/  forgot-password/  reset-password/
  (nesto)/            every authenticated route, inside the one AppShell
    dashboard/        one route, 16 role dashboards
    projects/         the reference module, fully functional
    finance/ hr/ …    department modules — three-line routes over the registry
    settings/         profile and appearance are personal; the rest is gated
  api/
    auth/             Auth.js route handler
    me/               the resolved user context
    projects/         the Projects REST surface
  workspace-unavailable/
components/
  ui/                 primitives and composites (Button … Toast)
  data/               DataTable, ListToolbar, Pagination
  layout/             AppShell, Sidebar, Topbar, drawers, dev role switcher
  charts/             Sparkline, MiniBars, BarChart, Donut, ProgressBar
  dashboard/          the dashboard engine
  modules/            ModulePage, RecordHeader, the generic section/record pages
  projects/           the Projects module's own components
  access/             Can, ReadOnlyGuard
  marketing/          the public site
config/               roles, access, permissions, role-defaults, modules,
                      navigation, widgets, kpis, quick-actions, dashboards,
                      demo-accounts, settings, theme, brand, marketing
lib/
  auth/               Auth.js, sessions, passwords, reset tokens, events
  context/            the one user-context resolver
  access/             can(), module access, scope builders, API guards
  modules/            projects/, records/, dashboard/, shared/
  database/  api/  mail/  layout/  hooks/  actions/  marketing/  utils/
styles/
  tokens.css          every colour, radius, shadow, duration, dimension
  globals.css         tokens mapped onto Tailwind + shell geometry
prisma/
  schema.prisma  migrations/  seed.ts  seed/
tests/
  unit/  integration/  api/  e2e/
scripts/              verify-roles.ts
```

---

## Design system

One visual system covers the public site and all 16 role workspaces. Nothing in
a page may invent its own colour, radius, shadow or duration.

### Tokens

`styles/tokens.css` is the single source. `styles/globals.css` maps it onto
Tailwind so components spend tokens (`bg-canvas`, `text-fg-muted`, `rounded-xl`,
`shadow-card`, `text-table`) rather than raw values. `config/theme.ts` is the
typed mirror for code that cannot read CSS — breakpoint maths and the
verification scripts.

| Group | Notes |
| --- | --- |
| Colour | White surfaces `#FFFFFF`, canvas `#F7F7F6`, stone `#F2F2F1`, graphite `#15171C`, one indigo accent `#465CFF`. Status colours only where they carry meaning. |
| Type | Geist for the interface, Instrument Serif for the wordmark and the dashboard heading — nothing else. `text-hero / display / page / section / card / body / table / meta / micro` — 56 / 36 / 28 / 20 / 16 / 14 / 13 / 12 / 11px. Nothing goes below 11px. |
| Radius | 8 buttons and inputs · 10 small cards · 12 dashboard cards · 14 dialogs · 16 feature cards. |
| Shadow | Three steps only: `shadow-card`, `shadow-menu`, `shadow-dialog`. |
| Motion | 150 / 180 / 220ms on `cubic-bezier(0.2, 0.8, 0.2, 1)`, applied as the default for every `transition-*`. Honours `prefers-reduced-motion`. |
| Breakpoints | Mobile < 768 · tablet 768–1199 · desktop ≥ 1200 · large ≥ 1440, plus a 1024 rail step. |

Every `--breakpoint-*` is declared, not just the changed ones: declaring any one
of them replaces Tailwind's namespace rather than merging with it, so a partial
list silently drops `sm:` from the build.

### Colour schemes

Both schemes are declared together, one line per token:

```css
--nesto-canvas: light-dark(#f7f7f6, #101215);
```

There is no second palette to keep in step, so a light value cannot drift from
its dark counterpart. Which half applies follows `color-scheme`: `light dark`
on `:root` follows the operating system, and `:root[data-theme="dark"]` or
`[data-theme="light"]` pins it in either direction.

`light-dark()` takes colours, not arbitrary values, so the three shadows keep a
fixed geometry and switch only their colour — dark grounds need a deeper shadow
to register at all.

The choice lives in the `nesto.theme` cookie and is rendered onto `<html>` by
the server, so the first paint is already correct: no flash of the wrong
scheme, and no blocking inline script. Settings → Appearance sets it.

Graphite inverts with the scheme. It is the wordmark, the sign-in panel and the
dashboard brand card — the one surface that opposes the current ground, so in
dark mode those become the single sheet of paper in the product.

### Contrast

Text tokens are tuned to clear WCAG AA on canvas, surface, stone and row-hover
**in both schemes**, because §56 requires AA and 11px metadata counts as
normal-size text. Every text token clears 4.5:1 against every ground it can sit
on; the tightest pairing is `fg-subtle` on stone at 4.51:1 in light and 4.66:1
in dark. Status colours therefore ship in two variants: the base is the brand
value and is used for fills — dots, bars, chart series, solid buttons — while
`-strong` is the same hue pushed until it passes as text, and is what badges
and figures use.

### Brand voice

The interface carries a small set of capitalised lines — under the wordmark, at
the foot of the navigation, beside the dashboard date, and on the graphite
feature card. They all come from `config/brand.ts`; no component types one out.
They are set with the `.nesto-eyebrow` utility so the tracking is identical
everywhere.

`NestoLogo` assembles three ways from that one source: mark plus wordmark for
compact headers, wordmark plus tagline for the sidebar and drawer, and the mark
alone for the 72px rail.

### Shell geometry

Navigation width is one custom property, `--nesto-nav-width`, resolved in CSS so
the server renders the correct layout and the sidebar never flashes at the wrong
width:

| Viewport | Navigation |
| --- | --- |
| < 1024px | Drawer, 88% of viewport capped at 340px |
| 1024–1199px | 72px icon rail with tooltips — tablet landscape keeps navigation visible |
| ≥ 1200px | 240px sidebar, collapsible to the same 72px rail |

The collapse preference lives in a cookie, so it is already correct in the first
byte of HTML. Settings → Appearance drives the same state.

### Component layers

```
Primitive   Button Input Textarea Select Checkbox Radio Switch Badge Avatar
            Icon Tooltip Divider
Composite   Card KpiCard Table Tabs Dropdown Dialog Drawer Toast SearchField
            FilterBar Breadcrumbs ConfirmDialog EmptyState ErrorState Skeleton
Charts      Sparkline MiniBars BarChart Donut ProgressBar — five colours,
            hard stop
Application AppShell Sidebar Topbar MobileHeader MobileDrawer PublicNav
            PageHeader ModuleHeader ModuleShell DetailHeader DashboardGrid
            DashboardWidget WelcomeHeader BrandFeatureCard UserMenu
            NotificationMenu
```

`ConfirmDialog` is the one component with no call site: V0.1 has no destructive
action to confirm. It is kept because §69 requires the pattern, and the first
delete in V0.2 should route through it rather than inventing a second one.

### Dashboard composition

One engine renders all 16 dashboards. A role selects KPI keys, widget keys and
quick-action keys from the registries in `config/kpis.ts`, `config/widgets.ts`
and `config/quick-actions.ts`; there is no per-role screen anywhere in the
codebase.

Each entry declares the permission that gates it, so a widget a role cannot
justify is never *loaded*, let alone rendered and hidden. A widget declares a
`kind`, and `DashboardWidget` owns the rendering for each:

| Kind | Shape |
| --- | --- |
| `alerts` | The attention area — critical, warning and info, sorted by priority |
| `approvals` | Only from modules where the user holds the granular approve permission |
| `list` | Rows with a title, a subtitle, a meta value and a status badge |
| `breakdown` | Counts or money by status, each a link into the filtered list |
| `activity` | Feed, filtered to modules the user can actually open |

The same widget shows different data to different people. "My Projects" is one
component and one query; the Owner's scope makes it company-wide and the
Architect's makes it their two assigned projects.

Widget cards and KPI cards are `min-w-0`, and both grids set `[&>*]:min-w-0`. A
grid item defaults to `min-width: auto`, so without it a single long line inside
a card grows the card to its content's intrinsic width and pushes the whole page
sideways on a phone. The widget grid uses dense flow so a full-width widget
followed by a half-width one does not leave a hole at the two-column stage.

A widget that fails to load says so in its own card and leaves the rest of the
dashboard working.

---

## Public site

Nine pages under `app/(public)/(site)` — home, Platform, Pricing, Security,
About, Contact, Questions, Privacy and Terms — sharing a header and footer
through a nested route group, so sign-in and password recovery stay bare. Every
one of them must also be listed in `PUBLIC_ROUTES` (`lib/permissions/route-access.ts`),
or middleware sends an anonymous visitor to `/login` instead of showing it. The
list is written out by hand rather than derived from the site navigation: a
marketing link is a design decision, a public route is a security one.

### Copy is configuration

`config/marketing.ts` holds every word the site says — navigation, hero, module
blurbs, lifecycle stages, pricing plans, questions and both legal summaries.
Pages render it; they do not contain it. Labels the product already owns are
read from `config/modules.ts` and `config/roles.ts` instead of being restated,
so the site cannot advertise a module that does not exist or miss one that does.

Three things live in `config/marketing.ts` that a launch needs to change:
`site.contact` (placeholder addresses), `pricing.plans` (the only place figures
are set) and `site.contact.replyTime`.

### Nothing is an image

The site ships no photography, no illustration files and no icon sprites. The
architectural drawings are inline SVG hairlines in `currentColor`
(`components/marketing/blueprint.tsx`), the drafting grid is two gradients from
the border token, and the product preview is the application's own `KpiCard`,
`ProgressBar`, `Donut` and demo records rendered at marketing scale — so it
cannot go stale, weighs nothing and never shifts the layout.

Every marketing page is statically prerendered. The only client JavaScript is
the navigation drawer and the contact form; the questions use `<details>`, so
they open with scripting switched off.

### The hairline grid

Cards separated by a single line are drawn with a border on each cell —
`hairlineGrid` / `hairlineCell` in `components/marketing/section.tsx` — rather
than a coloured gap in the container. A gap shows through wherever a row is not
full, which turns a missing card into a grey block. `gridColumns(count)` then
picks a column count that divides the number of cards, so eight modules never
sit in a grid of three.

### Contact

`lib/actions/contact.ts` validates with the same schema the browser used
(`lib/marketing/schema.ts`), discards submissions that fill the honeypot, and —
in V0.1 — records the enquiry in the server log. That log line is the one
temporary thing on the public site: replace it with a mail send, a table or a
CRM webhook, and add rate limiting by IP at the same time.

---

## What is real in V0.1

**Fully functional, against PostgreSQL, for all 16 roles:**

- The public site, authentication, sign-out, session persistence, deep-link
  return, session expiry, password reset
- Protected routes at edge, page and service level; access denied, module
  unavailable, workspace unavailable, 404
- The app shell, role navigation, active state, collapse, mobile drawer, top
  bar, user menu, development role switcher
- All 16 role dashboards — real KPIs, widgets, attention items, approvals and
  activity, every one of them scoped
- **Projects**: overview, list, search, filters, sort, pagination, detail,
  create, edit, archive, restore, team management, tasks, documents, activity,
  and a REST API
- Tasks, Clients, Contacts, Documents, Team, Company: lists and record detail
  over real records, scope-aware
- Finance, HR, Sales, Legal, Procurement, Inventory, QA/QC, HSE, Support:
  module overview, lists, record detail, filters, search, pagination and the
  approval shell, over seeded records
- Settings: profile, appearance, company, users, roles and modules

**Deliberately small:** the department module records are minimal shapes that
exercise the shell — lists, details, statuses, scope, approvals. They are not
final domain models, and each will be replaced when its own PRD lands
(PRD #9 §252, §67).

**Not built** (the PRDs' own non-goals): accounting ledgers, payroll, BOQ,
inventory valuation, real procurement or QA workflows, contract lifecycle,
document versioning, notifications, global search, reporting, exports,
integrations, multi-company switching UI, custom roles.

Global search and notifications render as visibly inert UI rather than
pretending to work — they say what they are instead of silently doing nothing.

---

## Verification

### Automated tests

```bash
pnpm test          # unit + integration + API
pnpm test:e2e      # browser journeys
```

| Layer | What it proves |
| --- | --- |
| **Unit** | The access matrix, the navigation resolver, the dashboard resolver, project validation and status transitions — pure, no database |
| **Integration** | Context resolution for all 16 accounts, every authentication failure state, data scope per role, document parent-context rules, cross-company isolation, password reset, seed/database agreement |
| **API** | Projects list/detail/create/update/archive/restore/team through the real service layer, per role |
| **E2E** | Sign-in, deep links, sign-out, per-role navigation, Projects end to end, every department module, approvals, and mobile browser behaviour |

Authorisation is never mocked in a test that exists to verify authorisation
(PRD #9 §223). The integration and API suites resolve a **real session row**
through the **real resolver** against the **real seeded database**; only the
cookie read is bypassed.

Because they share one database, `pnpm test` and `pnpm test:e2e` must not run at
the same time locally — CI runs them as sequential steps against a database
created for that run. Every suite that changes seeded state puts it back, so a
second run tests the same world as the first.

Current status: **209 unit / integration / API tests**, **62 browser journeys**
and **862 role-walk checks** passing, from a database created by
`pnpm db:reset:demo`.

### Role walk

`pnpm verify:roles` signs in as all 16 accounts over HTTP against a running
server and checks, for each: login redirects to `/dashboard`; the dashboard
renders that role's name and its permitted KPI cards; every module it may open
returns 200; every module it may not is refused with a real redirect; the
sidebar links to exactly its own modules; `/projects/new` matches whether the
role holds `project.create`; and sign-out re-protects `/dashboard`.

```bash
pnpm build && pnpm start
BASE_URL=http://localhost:3000 pnpm verify:roles
```

The public-route pass reads `PUBLIC_ROUTES` rather than a list kept in the
script, so a route added to what middleware admits is a route this walk loads.
A public page middleware allows but nobody ever opens is how a broken — or
unintended — one survives.

### CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs install → lint →
typecheck → PostgreSQL → migrations → seed → unit → integration → API → build →
E2E. Seed validation fails the run before the tests do, so a partially valid
test environment can never pass quietly.

### Responsive

Layout is verified at every viewport in the PRDs — 1920×1080 down to 360×800 —
across the public pages, the dashboard, module lists, record detail, settings
and the refusal states. The mobile suite additionally asserts what NESTO on a
phone must *not* be: no permanent bottom navigation, no horizontal page scroll,
tables replaced by record cards, and filters in a sheet.

---

## Next

V0.2 gives Tasks, Clients and Documents the same treatment Projects has here:
their own service layer, their own validation and their own create/edit flows,
replacing the shared record registry entry with a full module.

The department modules follow, one PRD at a time, each replacing its small test
record with a real domain model. None of that requires a new shell, a new
navigation engine, a new access system or a new design system — which is the
whole point of V0.1.
