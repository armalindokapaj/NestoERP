# NESTO V0.1

**ERP Foundation: Access, Shell, Dashboards, Module System, Projects, Tasks, Clients, Documents, Team, Finance, HR & Sales**

V0.1 is not the finished ERP. It is the permanent foundation: one application,
one design system, one app shell, one navigation engine, one access system, one
core data model and one reusable module shell. All 16 company roles sign in and
meet NESTO from their own perspective, every module has a real route with real
scoped data, and Projects is fully functional as the reference implementation
every later module follows.

Implements PRDs #1–#15.

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
| #11 Tasks Module | `lib/modules/tasks`, `app/(nesto)/tasks`, `app/api/tasks` |
| #12 Clients Module | `lib/modules/clients`, `app/(nesto)/clients`, `app/api/clients` |
| #13 Documents Module | `lib/modules/documents`, `lib/storage`, `app/(nesto)/documents`, `app/api/documents` |
| #14 Team Module | `lib/modules/team`, `app/(nesto)/team`, `app/(public)/invite`, `app/api/{team,departments}` |
| #15 Finance Module | `lib/modules/finance`, `app/(nesto)/finance`, `app/api/finance` |
| #16 HR Module | `lib/modules/hr`, `app/(nesto)/hr`, `app/api/hr` |
| #17 Sales Module | `lib/modules/sales`, `app/(nesto)/sales`, `app/api/sales` |

---

## Getting started

Requirements: Node 20+, pnpm, PostgreSQL 14+.

```bash
pnpm install

cp .env.example .env          # then fill in DATABASE_URL and AUTH_SECRET
#   AUTH_SECRET: openssl rand -base64 32

createdb nesto_erp            # or point DATABASE_URL at an existing database
pnpm db:migrate               # apply prisma/migrations
pnpm db:seed                  # two demo companies, 18 role accounts, full dataset

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
| `pnpm db:seed` | Seed the demo dataset and validate it (the ARMAAR demo tenant included) |
| `pnpm seed:armaar` | Add or update the ARMAAR demo tenant in an existing database ([docs/demo-armaar.md](docs/demo-armaar.md)) |
| `pnpm verify:demo` | Hold the ARMAAR demo tenant to D-01: public facts, companies, people, provenance |
| `pnpm db:reset:demo` | Drop, re-migrate and re-seed |
| `pnpm db:studio` | Prisma Studio |
| `pnpm test` | Unit + integration + API (vitest) |
| `pnpm test:unit` | Pure resolver logic — no database needed |
| `pnpm test:integration` | Context, scope and isolation against PostgreSQL |
| `pnpm test:api` | Projects authorisation through the real service layer |
| `pnpm test:e2e` | Browser journeys (Playwright) |
| `pnpm test:e2e:all-browsers` | …plus Firefox, WebKit and mobile Safari |
| `pnpm verify:roles` | Walk every demo persona over HTTP against a running server |

---

## Development accounts

One demo parent group, **NESTO Demo Group**, owns five companies, and each
company has exactly one project:

| Company | Project |
| --- | --- |
| Aurelia Construction | Riverside Residences |
| Meridian Developments | Central Office Tower |
| Terra Infrastructure | East Gate Logistics Hub |
| Forma Engineering | Marina Apartments |
| Nova Hospitality Development | Adriatic Hotel & Residences |

The group's people are members of all five companies; every company has its own
CEO, project manager and a few local people besides. Aurelia carries the
deepest data — procurement, inventory, QA/QC, HSE, timesheets, daily logs,
planning, structure and the unit pages all live on Riverside Residences — while
finance, sales, contracts, HR, tasks, documents, meetings and engineering are
spread across the five.

The roster lives in [`config/demo-accounts.ts`](config/demo-accounts.ts) and the
people behind it in [`prisma/seed/demo/users.ts`](prisma/seed/demo/users.ts); the
seed, the login page and the test helpers all read them, so they cannot
disagree. Sign-in is by username. The password comes from
`NESTO_DEMO_PASSWORD` and defaults to `nesto1234` in development.

| Username | Who | | Username | Who |
| --- | --- | --- | --- | --- |
| `platform-admin` | Platform Admin, in no group | | `group-legal` | Head of Group Legal |
| `owner` | Group Owner | | `group-sales` | Head of Group Sales, manages Meridian's branch |
| `group-it` | Head of Group IT | | `group-procurement` | Head of Group Procurement |
| `group-hr` | Head of Group HR | | `group-inventory` | Head of Group Inventory |
| `group-architecture` | Head of Group Architecture, manages Aurelia's branch | | `group-qaqc` | Head of Group QA/QC |
| `group-engineering` | Head of Group Engineering | | `group-hse` | Head of Group HSE, manages Nova's branch |
| `group-finance` | Head of Group Finance, manages Terra's branch | | `ceo-a` | CEO of Aurelia |
| `pm-a` | Project Manager, Riverside Residences | | `architect-a` | Architect, Aurelia |
| `viewer-a` | Viewer, Riverside Residences | | `pm-b` | Project Manager, Central Office Tower |
| `finance-c` | Finance, Terra | | `architect-d` | Architect, Forma |
| `hse-e` | HSE, Nova | | | |

Every other company has `ceo-b` … `ceo-e` and `pm-b` … `pm-e`, plus local
people such as `architecture-manager-b`, `finance-manager-d` and
`legal-manager-e`, who manage one company's branch and head nothing.
`multi-architect` is an Architect in Aurelia and in Forma: one account, two
memberships, never a second login. Anybody with more than one company switches
between them from the top bar.

The people behind the organization's workflows are seeded in every state
([`docs/organization.md`](docs/organization.md)). Elira Hoxha is a candidate
for Meridian with no login (HR → Recruitment). Adrian Kola is selected for
Terra, and the approved account request waits in Organization → User
provisioning for `group-it` to create the login. Ermira Tafa (`finance-c`)
went all the way. `platform-admin` signs in to `/platform-admin`, where a new
group is created, given companies and people, and activated.

**The ARMAAR Group demo tenant** sits beside it: ARMAAR GROUP sh.p.k., its
thirteen companies, eleven public projects and a working day of synthetic
operations, for presenting NESTO to that client (Demo PRD D-01, ADR 0005). Its
people sign in as `armaar.owner`, `bci.director`, `bci.pm` and so on, with
`ARMAAR_DEMO_PASSWORD` or, in development, the demo's password; every page says
it is a demo. The guide, logins and walkthrough are in
[docs/demo-armaar.md](docs/demo-armaar.md).

**Test fixtures are not demo data.** They live in a hidden fixture group, never
in the demo: `tenant-owner` and `tenant-viewer` in a second tenant with seven
modules switched off, `fixture-owner` in Fixture Works with the pending, expired
and accepted invitations, and the accounts that exist to be refused —
`inactive-user`, `suspended-user`, `inactive-membership`,
`suspended-membership` and `suspended-company`. Each fails authentication in its
own specific way, and each has a test that says so.

### Signing in quickly

In development the login page shows a **demo account picker**, grouped as
Platform, Group, Aurelia Construction and Other companies — one click signs you
in as that persona, no typing. Once inside, the **role switcher** in the top bar re-renders the
workspace as any of the company roles without signing out.

Both are gated on `NODE_ENV`. In a production build the picker is not rendered,
the switcher is not rendered, and the demo sign-in action refuses. The picker
sends only a curated username to the server — the demo password is resolved in
[`lib/actions/demo.ts`](lib/actions/demo.ts) and never enters the browser
bundle, so no credential ships to the client in any build.

### Adding a role

1. Add the key to `ROLE_KEYS` and `roles` in `config/roles.ts`.
2. Add its row to the access matrix in `config/role-defaults.ts` — that one
   table decides its navigation, its module access, its data scope and every
   granular permission it holds.
3. Give it a dashboard in `config/dashboards.ts`.
4. Add its demo account to `config/demo-accounts.ts`, and its label and
   description to `lib/i18n/messages/en.ts` and `sq.ts`.
5. Add it to the per-role test tables: `EMAIL_FOR_ROLE` in `tests/helpers.ts`,
   `DEMO_USERNAME` in `tests/e2e/fixtures.ts` and `EXPECTED_APPROVALS` in
   `tests/unit/permissions/role-boundaries.test.ts` — each is typed over every
   role, so typecheck names what is missing.
6. `pnpm db:seed`.

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
| `config/roles.ts` | The 16 roles, and the positions they are held at |
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

There is exactly **one** dashboard page rendering all 18 role dashboards, and
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

### Tasks: the canonical work item

Tasks (PRD #11) is the second full module and the first one built on top of
another: it is the single work-item system the whole product shares. A task
shown on the dashboard, in `/tasks` and inside a project is one record with one
id and one URL — there is no `ProjectTask`, and there will be no `FinanceTask`.

```
lib/modules/tasks/
  task.schema.ts        Zod — create, update, list query, reopen
  task.status.ts        transition table, derived overdue, week/day bounds
  task.repository.ts    queries and counters, always scoped
  task.service.ts       permission → scope → validate → transaction → activity
  task.query.ts         URL parameters → a validated list query
  task.options.ts       form options, narrowed to what the service will accept
  task.types.ts         explicit DTOs, never a raw Prisma model
```

Two rules are worth calling out, because both are places a task system usually
leaks:

**Status changes are verbs, not a dropdown.** Start, Mark Blocked, Complete,
Reopen, Archive and Restore are separate endpoints, each checking the permission
that owns it. `completedAt` is set and cleared by the server, `ARCHIVED` is not
a status a `PATCH` may set, and an archived task remembers where it was so
restoring puts it back rather than resetting it to To Do.

**A project task needs project access.** Being the assignee — or the person who
created it — does not hand somebody the project context they never had or have
since lost (PRD #11 §176, §177). `buildTaskScopeWhere` therefore applies a
project gate on top of the task scope, and it can only narrow the result.

Assignment follows the same instinct: with `task.create` but not `task.assign` a
person may take work themselves or leave it unassigned, but not hand it to a
colleague — and the assignee picker offers exactly the people the service will
accept, which for project work is the project team.

### Clients: one customer identity

Clients (PRD #12) is the canonical customer record. Sales will not create a
`SalesAccount`, Finance will not create a `FinanceCustomer` and Legal will not
create a contract counterparty — they all reference this `Client`.

```
lib/modules/clients/
  client.schema.ts      Zod — client, contact, duplicate check, list query
  client.status.ts      transition tables for clients and contacts
  client.duplicate.ts   normalisation and soft-match detection
  client.repository.ts  queries and counters, always scoped
  client.service.ts     permission → scope → validate → transaction → activity
  client.query.ts       URL parameters → a validated list query
  client.types.ts       explicit DTOs, never a raw Prisma model
```

**Duplicates get two different answers.** A clashing client code is a database
constraint and is refused outright. An identical name, legal name, email or
phone is a *soft* match: the save is interrupted once, the matches are shown
with a link to each, and "Create anyway" proceeds — because "ACME Development"
and "ACME Developments" might be two real companies and only a person can say
(PRD #12 §52, §53). Comparison runs on a stored `normalizedName`, so it is an
indexed lookup rather than a scan.

**A client may hold exactly one primary contact.** Promoting somebody stands
the previous one down in the same transaction, and a partial unique index
(`WHERE isPrimary = true AND archivedAt IS NULL`) makes two simultaneous
promotions impossible rather than merely unlikely. Archiving the primary leaves
the client without one instead of picking a replacement — that is a person's
decision (PRD #12 §83–§88).

Counts follow the reader, not the record: a client with four projects shows
"2 active projects" to somebody who can open two of them, because the number
itself would otherwise leak (PRD #12 §93).

### Documents: one file system, one access rule

Documents (PRD #13) is the canonical file layer. There is no `ProjectDocument`,
no `FinanceAttachment` and no `HRFile` — one `Document` record and one stored
object, with visibility decided entirely by who is asking.

```
lib/storage/
  storage.interface.ts      the contract: put, get, exists, delete
  local.storage.ts          filesystem adapter — private, path-traversal safe
  index.ts                  selection and the test seam
lib/modules/documents/
  document.files.ts         allowlist, size ceiling, name sanitisation
  document.parent-access.ts the resolver registry — the security core
  document.repository.ts    queries, always through the access clause
  document.service.ts       permission → parent → validate → store → row
```

**The invariant this module exists to hold** is one line, and it is enforced in
one place:

```
document permission + parent module permission + parent record access
+ company isolation = document access
```

A generic `document.view` never reaches a Finance or HR file. A company-level
document has no project or client to narrow it, so it requires *company-level*
access to the module it was filed under — which is what keeps
`Company Financial Summary.pdf` away from an Architect whose Finance access is
scoped to their own projects, and away from Group IT, which has no Finance access
at all. Both are E2E release blockers.

**Unregistered parents fail closed.** A document filed under an `entityType`
whose module has not registered a resolver is excluded from every list and
refused on detail, rather than quietly assumed safe.

**Files are private.** Nothing is served statically and there is no signed URL
to copy: `/api/documents/[id]/download` re-runs session, company, permission,
parent access and document state on every request before a byte is sent, forces
`attachment` for anything that could execute in a browser, and sets `nosniff`.
Archiving keeps the object; only a failed upload deletes one.

V0.1 ships the filesystem adapter, rooted at `DOCUMENT_STORAGE_ROOT`. An
S3-compatible adapter belongs beside it and is deliberately not pretended into
existence — the interface, the tenant-safe key layout (`companies/{companyId}/…`)
and the `storageProvider` column are in place so adding one is a new file, not a
redesign.

### Team: membership is the access surface

Team (PRD #14) is the company's people directory, and it is the only module
whose records *are* the access control system. Changing a role here changes what
somebody can see everywhere else, so three rules are enforced in
`lib/modules/team/team.service.ts` and nowhere else:

```
lib/modules/team/
  membership.status.ts          the lifecycle table (no ACTIVE → INVITED)
  team.scope.ts                 who a reader may see: company / department / project / self
  team.service.ts               the three rules below
  invitations/invite.token.ts   32 random bytes; only the SHA-256 is stored
  invitations/invite.service.ts invite, resend, cancel, preview, accept
  departments/department.service.ts   the company's departments, read only (E-13)
  departments/branch.doors.ts         the organization's door onto a branch row
  team.placement.ts                   the door type Team hands a department move to
```

A company's departments are branches of its group's departments, activated,
staffed and given managers from Organization (E-13, ADR 0003); Team reads them.

1. **The company never loses its last active Owner.** Demoting, deactivating or
   suspending the only active Owner is refused, and the reason is stated in the
   confirmation before the press rather than as an error after it (§93).
2. **Only an Owner may create another Owner.** `team.owner.assign` is an
   override on the Owner role alone, so a Head of Group IT who manages accounts
   still cannot mint an Owner (§95, §96). The role picker hides what the service
   would refuse, and the service refuses regardless.
3. **Removing access takes effect now.** Deactivate and suspend delete the
   member's `Session` rows inside the same transaction. Access ends when the
   decision is made, not when a token happens to expire (§242, §243).

Nobody can change their own role or their own access — that is somebody else's
decision to take (§167, §168).

**Invitations.** The raw token exists in exactly one place: the emailed link.
What is stored is its SHA-256, so a database leak cannot be replayed into a
membership, and the activity trail records the address but never the token.
Delivery is attempted *after* the invitation is committed, so a mail-provider
outage leaves something a manager can resend rather than a half-created member.
Every invalid token — unknown, expired, cancelled, already used, suspended
company — gets the same answer, so `/invite/<token>` cannot be used to discover
which addresses have been invited.

An address that already has a NESTO account is claimed by **signing in**, never
by choosing a fresh password: otherwise anybody holding the link could attach
that person to a company without their knowledge.

**What Team is not.** Salary, bank details, national identifiers, home address
and medical data belong to HR and never appear in a Team DTO, whoever is asking.
Last-login is behind its own grant, because "when did they last sign in" is a
different question from "who works here".

The record URL is `/team/<membershipId>`, not a user id: the same person can
belong to several companies, and this page is about their membership of *this*
one.

### Finance: the numbers have to be right

Finance (PRD #15) is operational finance, not a general ledger: project budgets,
customer invoices, expenses, payments, commitments and the approvals that gate
them. It deliberately does not claim to be accounting — no double entry, no
chart of accounts, no tax filing, and no credit notes.

```
lib/modules/finance/
  finance.money.ts        Decimal arithmetic and one rounding rule
  finance.currency.ts     the supported-currency allowlist
  finance.scope.ts        company vs project, reusing the Projects resolver
  finance.settlement.ts   what has actually been paid, in grouped aggregates
  invoices/               invoice.calculation.ts is the totals authority
  expenses/ budgets/ commitments/ payments/
  approvals/              one approval cycle per submission, never reopened
  budgets/budget.summary.ts  the one budget-vs-actual calculation
  reports/ overview/
```

**No financial figure ever passes through a JavaScript float.** Every amount is
a `Prisma.Decimal` in the database and a decimal string across the API —
`"12500.50"`, never `12500.4999999997`. Rounding happens in exactly one place,
and each invoice line is rounded to the cent *before* the totals are summed, so
an invoice's lines always add up to its total.

**The server owns the numbers.** `subtotal`, `taxAmount`, `totalAmount`,
`paidAmount` and every variance are absent from every input schema. There is
nothing for a crafted request to inflate, because there is no field to put it
in.

**Workflow and settlement are separate facts.** `status` says where an invoice
is in its approval; whether the money arrived is derived from its payments at
read time. A fully paid invoice stays `SENT`. Storing one inside the other is
how a paid invoice ends up impossible to cancel for the wrong reason.

**Separation of duties is enforced, not suggested.** MANAGE is the top rung of
the ladder and still does not include approval: the Finance role raises every
invoice and signs off none of them. And the person who submitted a record
cannot decide it unless they hold `finance.approval.self` — a grant only the
Owner has by default, because in a company where they are the only approver the
alternative is a record nobody can ever decide.

**Money can never be paid twice.** The outstanding balance is recalculated
*inside* the payment transaction, not read beforehand, so two people paying the
last €500 of an invoice at the same moment cannot both be told there is room. A
payment is never deleted: voiding leaves the row and its reason behind and stops
it counting.

**One budget-vs-actual calculation.** Actual cost is approved expenses —
approval is when a cost is recognised, payment is a cash event that happens
later. Forecast adds open commitments. Every screen that shows a variance reads
it from `budget.summary.ts`, so a project cannot show one number on its Finance
tab and a different one in the report.

**Currencies are reported, never added.** V0.1 has no FX engine, so EUR and USD
appear side by side and are never summed. A project's expenses and commitments
must match its approved budget's currency, because otherwise its actual cost
would be unaddable.

**Finance is confidential.** Group IT has no Finance access at all:
administering NESTO is not financial authorisation. An Architect sees a project
budget summary and never a payee, an invoice or company cashflow.


### HR: employment is not access

HR (PRD #16) is the employment record — who works here, on what terms, what they
are paid, when they are off and whether they were in. It is not payroll, not
recruiting, not performance reviews and not benefits: those are named as
non-goals so that nothing here quietly grows into half of one.

```
lib/modules/hr/
  hr.calendar.ts      working days, business dates — no Prisma, so the form shares it
  hr.date.ts          the one place a day count becomes a stored Decimal
  hr.scope.ts         SELF / DEPARTMENT / COMPANY, with PROJECT folded into SELF
  hr.status.ts        employment, leave and attendance lifecycles
  employees/          the employment record, and onboarding/offboarding readiness
  employment/         its history: dated changes, corrections, scheduled changes,
                      reads and reports as of a date (E-03, docs/employment-history.md)
  compensation/       effective-dated pay, behind its own permission
  leave/              requests, decisions, and leave.balance.ts
  attendance/         days worked, and attendance.sync.ts for approved leave
  overview/ reports/
```

**Employment is not access.** Ending somebody's employment does not deactivate
their membership, and deactivating a membership does not end their employment.
They are different facts, owned by different modules, changed by different
people: HR records that somebody left, and a Team manager removes their access
deliberately. Neither ever happens as a side effect of the other.

**History is never overwritten.** Department, title, manager, location, type
and status change only as dated changes: the old period closes, the new one
opens, and the employment's current fields are recomputed from the rows. A
wrong row is corrected with a reason, and the original stays beside it. For
somebody employed, the membership's department and title follow the
employment, and a Team or Organization edit of them is recorded as a change
rather than lost (E-03, ADR 0004).

**Pay is never part of an employee DTO.** Compensation has its own service, its
own route and its own permission, and `hr.compensation.view` sits on no rung of
the access ladder — not even MANAGE. Owner and HR hold it explicitly; everybody
else, Group IT and the CEO included, does not. Without it the compensation tab does
not render at all, because a locked placeholder still confirms that a salary is
on file. Amounts never reach the activity trail either: it records that pay
changed and who changed it, never what anybody earns.

**Nobody decides their own leave.** Not the HR manager who holds
`hr.leave.approve` over the whole company, and not the Owner — there is no
self-approval grant here, unlike Finance. Approval also takes the balance row's
lock before reading it, so two approvers signing off the last few days at the
same moment cannot both be told there is room: checking a figure another
transaction is about to change is the same as not checking it.

**A leave reason is absent, not null.** It may be medical. Unless the reader is
the person who wrote it or holds `hr.leave.reason.view`, the field is not in the
DTO at all — there is nothing to leak through a log, a cache or a serialiser.

**Approved leave writes the attendance days it covers**, tagged with the request
that created them, so cancelling that leave takes exactly those rows back out
and never touches a day somebody entered by hand. If attendance already records
the person as *working* on one of those days, approval fails rather than
silently skipping it: two records of the same day disagreeing is worse than an
approval that has to wait for a correction.

**One working-day calculation.** Monday to Friday, no public-holiday calendar in
V0.1 — stated once in `hr.calendar.ts` rather than assumed at four call sites.
The leave form counts the days it is about to request with the same function the
server uses to store them; the browser's figure is a courtesy, and the server
counts again regardless.

**An export is the list, not a second query.** CSV export parses the same
search parameters and calls the same list service, so it inherits the same
scope, permissions and filters by construction — and it carries no leave reason
and no pay, because a file on somebody's laptop is where data stops being
governed.

**Scope is not the same as permission.** A self-scoped reader holds
`hr.employee.view` and `hr.leave.balance.view` — what stops them reading
somebody else's record is scope, and it answers 404 rather than 403 so the
response cannot confirm that person works here. PROJECT scope is deliberately
folded into SELF: running a project tells you who is on it, which is Team's job,
and must not become access to those people's employment files.


### Sales: the pipeline, not a second CRM

Sales (PRD #17) is the commercial pipeline — a lead somebody has not qualified
yet, an opportunity being worked, a proposal the client has to say yes to, and
the moment a deal becomes a customer and a job. It is not a second customer
database, a second project table or a second invoice.

```
lib/modules/sales/
  sales.scope.ts        SELF / DEPARTMENT / COMPANY, plus PROJECT for won work
  sales.dto.ts          one member reference, carrying whether they still work here
  sales.export.ts       CSV built on the list services
  leads/                capture, qualify, disqualify, convert — and lead.duplicate.ts
  opportunities/        the deal, opportunity.stage.ts and opportunity.forecast.ts
  proposals/            the offer, its line items and proposal.calculation.ts
  approvals/            one approval cycle per submission
  overview/ reports/
```

**A lead is not a client, and an opportunity is not a project.** The canonical
records are created at conversion, by the Clients and Projects services, in the
*same transaction* — `createClientRecord` and `createProjectRecord` exist for
exactly that. Sales owns no customer table and no project table, so the client
a deal created is the same row `/clients` serves, with the same id.

**A deal cannot be won without a canonical client.** A won opportunity is a
customer relationship, and Finance, Legal and delivery all need one record to
point at. Winning offers "keep", "link an existing" or "create a new" — and the
options a person is shown are only the ones their permissions actually reach:
`sales.project.convert` lets somebody hand a deal to a project, `project.create`
lets them make one, and those are different answers.

**Closing happens once.** Mark-won, mark-lost, lead conversion, approval
decisions and stage moves are all conditional updates checked by row count, so
two people pressing at the same moment produce one outcome and one conflict.
Accepting a proposal additionally takes the opportunity's row lock first, so two
acceptances cannot both find "nothing accepted yet" and leave one deal with two
agreed prices.

**Winning is not a stage.** The stage table has no transition into WON or LOST
from anywhere: closing a deal needs a close date, a client, a reason, and its
own permission, so it can never happen as a side effect of a drag between two
Kanban columns. The board has no drag-and-drop at all — PRD §297 requires a
keyboard alternative, and once the control exists it is the better one on every
device, because it is explicit and cannot half-happen on a touch screen.

**The forecast is the server's.** Probability is the stage default unless
somebody overrode it, weighted value is `estimate × probability ÷ 100` in
Decimal, and both are derived on every read. Nothing arrives from the browser,
so a crafted request cannot forecast one number while the database holds
another.

**Currencies are grouped, never summed.** As in Finance, and for the same
reason: V0.1 has no FX engine, so "€400,000 + $200,000 = 600,000" is not a
number this product is allowed to print. Every pipeline total, report and KPI
lists each currency separately.

**Approval is separate from operation.** The sales desk manages the pipeline and
quotes the price; the CEO and Owner sign it off. `sales.proposal.approve` is
denied to the Sales role even at MANAGE, and `sales.approval.self` sits on no
rung at all — the Owner holds it explicitly, because in a company where they are
the only approver the alternative is a proposal nobody can ever decide.

**A proposal is not an invoice.** It carries no receivable and settles nothing,
and Finance never reads one as one — though it shares the invoice's arithmetic
exactly, because a proposal for €395,000 that becomes an invoice for €395,000.01
is the kind of discrepancy a client writes in about.

**A project manager receives the deal, not the pipeline.** PROJECT scope reaches
a won opportunity whose converted project they can open, and nothing else: being
handed a job is not a reason to be handed the company's commercial position.
Finance and Legal read opportunity and proposal values without `sales.lead.view`
— commercial context is not the sales workspace.

**History is preserved, not replaced.** A converted lead stays as the record of
where the deal came from and becomes read-only; a won opportunity stays and
cannot be archived; an accepted proposal can be neither edited nor cancelled.
Archiving an opportunity keeps its stage in `preArchiveStage` rather than
overwriting it, because filing something away is not the same fact as how it
ended.

### Database

The full core data model (PRD #8): `Company`, `User`, `CompanyMember`,
`Department`, `Role`, `Permission`, `RolePermission`, `Module`, `CompanyModule`,
`RoleModuleAccess`, `Project`, `ProjectMember`, `Client`, `Contact`, `Task`,
`Document`, `CompanyInvite`, `FinanceSettings`, `Invoice`, `InvoiceLineItem`,
`Expense`, `Payment`, `ProjectBudget`, `ProjectBudgetLineItem`, `Commitment`,
`FinanceApproval`, `EmployeeProfile`, `Compensation`, `LeaveRequest`,
`LeaveBalance`, `AttendanceRecord`, `Lead`, `Opportunity`, `Proposal`,
`ProposalLineItem`, `SalesApproval`, `Activity`, `Session`, `PasswordResetToken`,
`AuthEvent` —
plus the
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
    dashboard/        one route, 18 role dashboards
    projects/         the reference module, fully functional
    finance/ hr/ sales/   real modules, each with its own services and pages
    procurement/ …    department modules still on the shell registry
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

One visual system covers the public site and all 18 role workspaces. Nothing in
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
compact headers, wordmark plus tagline for the drawer, and the wordmark or the
mark alone for the sidebar and its 72px rail, where a second line would overrun
the width.

### Shell geometry

Navigation width is one custom property, `--nesto-nav-width`, resolved in CSS so
the server renders the correct layout and the sidebar never flashes at the wrong
width:

| Viewport | Navigation |
| --- | --- |
| < 1024px | Drawer, 88% of viewport capped at 340px |
| 1024–1199px | 72px icon rail with tooltips — tablet landscape keeps navigation visible |
| ≥ 1200px | 240px sidebar, collapsible to the same 72px rail |

The collapse control sits at the left of the top bar, not in the sidebar: the
rail header has one slot and the mark already owns it as the link home. The
preference lives in a cookie, so it is already correct in the first byte of HTML.
Settings → Appearance drives the same state.

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
- All 18 role dashboards — real KPIs, widgets, attention items, approvals and
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
pnpm build && pnpm start   # port 3000
pnpm verify:roles
```

Everything in NESTO listens on **port 3000** and nothing else: `pnpm dev`,
`pnpm start`, `pnpm test:e2e` and `pnpm verify:roles` all agree, so a URL
copied out of one is valid in the others. `-p 3000` is explicit in the scripts
so a busy port fails loudly instead of Next quietly moving to 3001. Override
with `BASE_URL` or `E2E_PORT` if you must; the default never moves.

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

Every core entity now has its own module. `lib/modules/records` — the generic
shell registry — holds no core sections at all any more, which is exactly what
it was for.

The department modules follow, one PRD at a time, each replacing its small test
record with a real domain model: Team (#14), Finance (#15) and HR (#16) are
done; Sales (#17), Legal (#18), Procurement (#19), Inventory (#20), QA/QC (#21) and HSE
(#22). None of that requires a new shell, a new
navigation engine, a new access system or a new design system — which is the
whole point of V0.1.
