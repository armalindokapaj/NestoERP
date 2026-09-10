# NESTO V0.1

**ERP Foundation, Role Dashboards & Navigation System**

V0.1 is not the functional ERP. It is the structural foundation: one application,
one design system, one app shell, one module system, one role configuration
system. All 16 company roles can sign in and experience NESTO from their own
perspective, and every module has a real route, header, navigation and
placeholder state waiting for its functionality.

---

## Getting started

Requirements: Node 20+, pnpm, PostgreSQL 14+.

```bash
pnpm install

cp .env.example .env          # then fill in DATABASE_URL and AUTH_SECRET
#   AUTH_SECRET: openssl rand -base64 32

createdb nesto_erp            # or point DATABASE_URL at an existing database
pnpm db:migrate               # apply prisma/migrations
pnpm db:seed                  # demo company + 16 role accounts

pnpm dev                      # http://localhost:3000
```

### Scripts

| Script | Purpose |
| --- | --- |
| `pnpm dev` | Development server |
| `pnpm build` / `pnpm start` | Production build and server |
| `pnpm typecheck` | TypeScript, no emit |
| `pnpm lint` | ESLint |
| `pnpm db:migrate` | Apply / create Prisma migrations |
| `pnpm db:seed` | Seed the demo company and 16 accounts |
| `pnpm db:studio` | Prisma Studio |
| `pnpm db:reset` | Drop, re-migrate and re-seed |
| `pnpm verify:roles` | Walk the spec §70 test flow for all 16 roles against a running server |

---

## Development accounts

One demo company — **NESTO Demo Construction** — with one account per role, all
defined in [`config/demo-company.ts`](config/demo-company.ts). Password for all
of them: `nesto1234`.

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

That file is the single source of the roster: the seed creates these records,
the login page offers them, and `pnpm verify:roles` signs in as each of them.
They cannot drift apart, and `pnpm db:seed` fails loudly if any role is left
without an account.

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

1. Add the key to `ROLE_KEYS` and `roles` in `config/roles.ts`, and to the
   `Role` enum in `prisma/schema.prisma`.
2. Give it a sidebar in `config/navigation.ts` and a dashboard in
   `config/dashboards.ts`.
3. Add its demo account to `config/demo-company.ts`.
4. `pnpm db:migrate && pnpm db:seed`.

It then appears in the sidebar, the login picker, the role switcher, the Roles
settings page and `pnpm verify:roles` — without touching a component.

---

## Architecture

```
Public site  →  Login  →  Session  →  Company + Role  →  App shell
                                                            ├── Sidebar (role navigation)
                                                            ├── Top bar
                                                            └── Dashboard / Modules
```

### Configuration is the product

Nothing about a role is hard-coded in a component. Everything a role sees comes
from `config/`:

| File | Owns |
| --- | --- |
| `config/roles.ts` | The 16 roles |
| `config/modules.ts` | Module registry: routes, icons, tabs, sidebar zone, required permissions |
| `config/navigation.ts` | Role → sidebar modules |
| `config/permissions.ts` | Role → permissions, and the `can()` check |
| `config/dashboards.ts` | Role → KPI cards, widgets, quick actions |
| `config/settings.ts` | Settings sections |

Adding a role, moving a module between sidebar zones or changing a dashboard is
a change to these files — not a new screen. There is exactly **one** dashboard
page (`app/(nesto)/dashboard/page.tsx`) rendering all 16 role dashboards through
`RoleDashboard`.

**Navigation is the single source of truth for access.** `buildRolePermissions()`
grants each role the view permission for every module in its own navigation, then
adds the extra write grants — and *drops* any grant for a module the role cannot
see. A route that is hidden from the sidebar is therefore also refused by the
router; the two cannot drift apart.

### Permissions

Permissions are `MODULE.ACTION` strings. Feature code asks
`can(user, "team.manage")` — never `if (role === "ADMIN")`. Read-only roles have
every non-`.view` grant stripped in `buildRolePermissions`, whatever the tables
say, so a Viewer cannot reach a write route such as `/projects/new`.

Enforcement runs twice, on purpose:

1. **`middleware.ts`** — edge, reads the session token and role configuration,
   redirects anonymous users to `/login` (keeping a `callbackUrl`) and rewrites
   unauthorised requests to `/access-denied`.
2. **`requirePermission()`** in each page — so a route added without a middleware
   rule fails closed rather than open.

### Auth

Auth.js v5 with a Credentials provider and JWT sessions. The config is split so
middleware never imports Prisma or bcrypt:

- `lib/auth/auth.config.ts` — edge-safe (pages, session, callbacks)
- `lib/auth/index.ts` — the Credentials provider and the database lookup
- `lib/auth/session.ts` — `getCurrentUser()`, `requireUser()`, `requirePermission()`

Sign-in resolves user, company and role in one query. The session token carries
that context, and permissions are derived from the role, so no request needs a
database round-trip to answer "may they open this?".

### Database

Deliberately small (spec §53): `Company`, `User`, `CompanyMember`, `Module`,
`CompanyModule`. The role lives on `CompanyMember`, not on `User`, which leaves
room for one user to belong to several companies with a different role in each.

### Project structure

```
app/
  (public)/
    (site)/           the public site — home, platform, pricing, security,
                      about, contact, faq, privacy, terms
    login/  forgot-password/
  (nesto)/            every authenticated route, inside the one AppShell
  api/auth/           Auth.js route handler
  sitemap.ts  robots.ts
components/
  ui/                 primitives and composites (Button … Toast)
  layout/             AppShell, Sidebar, Topbar, drawers, dev role switcher
  charts/             Sparkline, MiniBars, BarChart, Donut, ProgressBar
  dashboard/          the dashboard engine
  marketing/          the public site — sections, blueprints, workspace preview
  modules/            module page standard, detail page standard
  settings/           settings controls
config/               roles, modules, navigation, permissions, dashboards,
                      theme, brand, marketing
styles/
  tokens.css          every colour, radius, shadow, duration, dimension
  globals.css         tokens mapped onto Tailwind + shell geometry
lib/
  auth/  database/  permissions/  layout/  hooks/  actions/  marketing/
  mock/  utils/
prisma/               schema, migrations, seed
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

One engine renders all 16 dashboards. A role selects KPI keys and widget keys
from the catalogues in `config/dashboards.ts`; there is no per-role screen. A
widget declares a `type`, and `DashboardWidget` owns the rendering for each:

| Type | Shape |
| --- | --- |
| `projects` / `departments` | Overview tables — status as a badge or a dot plus a word, never colour alone |
| `activity` | Feed with a tinted round icon derived from the verb, so twelve department feeds are iconographed identically |
| `share` | Donut — count in the centre, counts in the legend, shares in the accessible name |
| `bars` / `progress` / `breakdown` / `list` | The plain data shapes |

| `feature` | The graphite brand card. Carries no data and no link, so it cannot go stale |

Widget cards are `min-w-0`. A grid item defaults to `min-width: auto`, so
without it a card holding a wide table grows to the table's intrinsic width and
pushes the whole page sideways instead of letting the table scroll inside it.
The widget grid uses dense flow so a full-width widget followed by a half-width
one does not leave a hole at the two-column stage.

KPI trends separate arithmetic from meaning: `direction` picks the arrow,
`tone` picks the colour. More open tasks is a rise and an improvement; rising
costs is a rise and a problem.

Overview tables drop columns by priority rather than scrolling sideways on a
desktop: status and progress never leave, the due date returns at 1200px and
the client at 1440px. Those are the widths at which the card is actually wide
enough — measured, not guessed.

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

Working: the public site, authentication, logout, session persistence, protected routes,
permission-based route refusal, the app shell, role sidebars, active navigation
state, mobile navigation drawer, the user menu, all 16 role dashboards, the Team
directory, Company profile, Users and Roles settings, and the Profile page —
these read live data from PostgreSQL.

Demo data: dashboard widgets, and the Projects / Tasks / Clients / Documents
lists. These live in `lib/mock/demo-data.ts` and `config/dashboards.ts`. Counts a
user can check for themselves — active projects, open tasks, clients, documents —
are derived from those same records, so a dashboard figure never contradicts the
table one click away.

Structure only: Finance, HR, Sales, Contracts, Procurement, Inventory, QA/QC,
HSE and Support. Each has its route, header, tabs, permissions and placeholder.
Making one functional means replacing a single `PlaceholderModulePage` call.

Not built (spec §68): accounting, payroll, invoicing, scheduling, timesheets,
approvals, notifications, search, reporting, file upload, integrations.

Search and notifications render as visibly inert UI rather than pretending to
work. Global search opens on ⌘K with its result categories already in place;
filter bars render the real toolbar with disabled controls. Both say what they
are rather than silently doing nothing.

---

## Verification

`pnpm verify:roles` signs in as all 16 accounts against a running server and
checks, for each: login redirects to `/dashboard`; the dashboard renders that
role's name and its configured KPI cards; every module in its navigation opens;
every module outside it is refused; the sidebar links to exactly its own
modules; `/projects/new` matches whether the role holds `project.create`; and
logout re-protects `/dashboard`. It also covers the public routes, the
`callbackUrl` on a protected deep link, and rejection of a wrong password.

The public-route pass reads `PUBLIC_ROUTES` rather than a list kept in the
script, so a route added to what middleware admits is a route this walk loads.
A public page middleware allows but nobody ever opens is how a broken — or
unintended — one survives.

```bash
pnpm build && pnpm start        # or pnpm dev
BASE_URL=http://localhost:3000 pnpm verify:roles
```

Current status: **693/693 checks passing.**

### Responsive and interaction checks

The layout is verified in a real browser at every target in the design spec —
1920×1080, 1440×900, 1366×768, 1180×820, 1024×1366, 768×1024, 430×932, 393×852,
390×844 and 360×800 — across the public pages, the dashboard, a data module, a
detail page, settings, a placeholder module and the unauthorized state: **110
page renders, zero horizontal overflow, zero clipped labels, navigation always
reachable.**

Those contexts are driven at a true layout viewport. Chromium's `isMobile`
emulation lays a page out wider and scales it down to fit, which hides genuine
horizontal overflow — the sweep runs without it so an overflow fails rather than
shrinking out of sight.

All 16 role dashboards are checked at desktop, tablet and mobile for overflow,
collapsed cards and console errors: **48 renders, zero problems.** The nine
public pages are checked in both colour schemes at desktop and mobile: **36
renders, zero problems.**

Colour scheme behaviour is verified end to end — the system default, pinning a
light OS to dark and a dark OS to light, and survival across navigation and a
full reload: **10/10.** Dashboard tables are measured for clipping at 1200,
1280, 1366, 1440, 1600 and 1920: **zero clipped columns.**

Interaction checks cover the ⌘K search, sidebar collapse and its persistence
across navigation, rail tooltips, the tablet-landscape rail, drawer dimensions
and close-on-navigate, the mobile filter drawer, breadcrumbs and the detail page
architecture, the copy toast, and the public drawer staying separate from the
ERP one. A second suite covers the reworked shell: the sidebar assemblies at
each width, the rail's mark-only lockup and content offset, ⌘K, and a wide table
scrolling inside its card rather than moving the page: **16/16 passing.**

---

## Next

V0.2 makes Clients, Projects, Tasks, Team and Documents functional. Every new
feature plugs into an existing module — the shell, the design system and the role
configuration stay as they are.
