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
  (public)/           home, login, forgot-password
  (nesto)/            every authenticated route, inside the one AppShell
  api/auth/           Auth.js route handler
components/
  ui/                 primitives and composites (Button … Toast)
  layout/             AppShell, Sidebar, Topbar, drawers, dev role switcher
  charts/             Sparkline, BarChart, Donut, ProgressBar
  dashboard/          the dashboard engine
  modules/            module page standard, detail page standard
  settings/           settings controls
config/               roles, modules, navigation, permissions, dashboards, theme
styles/
  tokens.css          every colour, radius, shadow, duration, dimension
  globals.css         tokens mapped onto Tailwind + shell geometry
lib/
  auth/  database/  permissions/  layout/  hooks/  actions/  mock/  utils/
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
| Colour | Warm white `#F7F6F2`, stone `#F1F0EC`, graphite `#171A21`, one indigo accent `#465CFF`. Status colours only where they carry meaning. |
| Type | `text-display / page / section / card / body / table / meta / micro` — 36 / 28 / 20 / 16 / 14 / 13 / 12 / 11px. Nothing goes below 11px. |
| Radius | 8 buttons and inputs · 10 small cards · 12 dashboard cards · 14 dialogs · 16 feature cards. |
| Shadow | Three steps only: `shadow-card`, `shadow-menu`, `shadow-dialog`. |
| Motion | 150 / 180 / 220ms on `cubic-bezier(0.2, 0.8, 0.2, 1)`, applied as the default for every `transition-*`. Honours `prefers-reduced-motion`. |
| Breakpoints | Mobile < 768 · tablet 768–1199 · desktop ≥ 1200 · large ≥ 1440, plus a 1024 rail step. |

Every `--breakpoint-*` is declared, not just the changed ones: declaring any one
of them replaces Tailwind's namespace rather than merging with it, so a partial
list silently drops `sm:` from the build.

### Contrast

Text tokens are tuned to clear WCAG AA on canvas, surface and stone, because
§56 requires AA and 11px metadata counts as normal-size text. Status colours
therefore ship in two variants: the base is the brand value and is used for
fills — dots, bars, chart series, solid buttons — while `-strong` is the same
hue darkened until it passes as text, and is what badges and figures use.

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
Charts      Sparkline BarChart Donut ProgressBar — five colours, hard stop
Application AppShell Sidebar Topbar MobileHeader MobileDrawer PublicNav
            PageHeader ModuleHeader ModuleShell DetailHeader DashboardGrid
            DashboardWidget UserMenu NotificationMenu
```

`ConfirmDialog` is the one component with no call site: V0.1 has no destructive
action to confirm. It is kept because §69 requires the pattern, and the first
delete in V0.2 should route through it rather than inventing a second one.

---

## What is real in V0.1

Working: authentication, logout, session persistence, protected routes,
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

```bash
pnpm build && pnpm start        # or pnpm dev
BASE_URL=http://localhost:3000 pnpm verify:roles
```

Current status: **685/685 checks passing.**

### Responsive and interaction checks

The layout is verified in a real browser at every target in the design spec —
1920×1080, 1440×900, 1366×768, 1180×820, 1024×1366, 768×1024, 430×932, 393×852,
390×844 and 360×800 — across the public pages, the dashboard, a data module, a
detail page, settings, a placeholder module and the unauthorized state: **110
page renders, zero horizontal overflow, zero clipped labels, navigation always
reachable.**

Interaction checks cover the ⌘K search, sidebar collapse and its persistence
across navigation, rail tooltips, the tablet-landscape rail, drawer dimensions
and close-on-navigate, the mobile filter drawer, breadcrumbs and the detail page
architecture, the copy toast, and the public drawer staying separate from the
ERP one: **16/16 passing.**

---

## Next

V0.2 makes Clients, Projects, Tasks, Team and Documents functional. Every new
feature plugs into an existing module — the shell, the design system and the role
configuration stay as they are.
