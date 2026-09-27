# AUD-07 performance route manifest (§2, PS-01)

The machine-readable copy is `tests/e2e/perf/aud07-manifest.ts`. The benchmark (`tests/e2e/perf/aud07-baseline.spec.ts`) measures what it lists. When a route, selector or origin changes, update both files.

- **Status.** The timing columns are filled from the lead's runs. The instrument was fixed first (defects I-01..I-05 below), so the 324a3ca9 numbers in `scratchpad/aud07/summary.md` do not compare with the new ones. Re-run 324a3ca9 with this spec to get the "before" figures.
- **Usable (§4).** The browser is on the route's own path. `#nesto-main` has no skeleton and no `aria-busy` region. At least *min* of the route's records are visible, hydrated (React props attached, so a click works) and not left over from the origin page. Where the route has one, the primary control is visible, enabled and hydrated. A heading, a skeleton, a URL change or an empty state never counts. A timeout is kept as a failed sample, recorded with what the page was still waiting for.
- **Modes (§3).** *Cold* is a document load with the server already warm. *Warm* is a click on the in-app link after its prefetch arrived, and each attempt records `prefetched`. *Uncached* is the same click with prefetch off (a crawler user agent), and each attempt records that nothing was prefetched. A report flags an attempt that did not match its mode (`modeVerified`, `attemptsNotMatchingMode`); the attempt stays in the results. Warm and uncached start from a different page. On a phone, the navigation drawer opens before the measured click.
- **Samples.** 5 warm-ups (excluded), then 30 measured attempts for core routes and 10 for the others. Every attempt is kept.
- **SQL (PS-04).** Exact counts come from the request-correlated statement counter. It is opt-in (`NESTO_PERF_SQL_COUNT=1`) and never runs on Vercel, or where `APP_ENV` is production or staging. The `xact_commit` delta in `navigation-query-count.spec.ts` is a database-wide proxy, labelled as such, and counts as supporting evidence only.
- **Fixtures.** D1 is the demo seed; its exact counts are written into every report (`counts`). D10 comes from `scripts/perf/d10-generate.ts` (see [D10 cohort](#d10-cohort)).
- **Owner.** Every row is owned by AUD-07 (agent K for the instrument, the lead for runs). A regression opens a defect, and its ID goes in the *Defect* column.

## Core routes: deep tests, Company and Group

Company-scope identities are the Aurelia (company_demo_a) demo users. Group rows use the same people in the Group workspace. Statement counts are exact, from `tests/api/perf/aud07-list-query-growth.test.ts` on the lane database at D1+60 rows per family. They cover the list service that the route calls, per read, at a page of 10 and a page of 50. The whole-route counts (layout, shell and page per request kind) come from the lead's SQL pass.

| ID | Module | Role / workspace | Fixture | Route (warm/uncached: from → link) | Service / API | Data-ready marker | Primary interaction | List SQL, page 10 → 50 (exact) | Route SQL / requests / bytes | Cold p50/p95 desktop · phone | Warm p50/p95 desktop · phone | Uncached p50/p95 desktop · phone | Before → after | Defect |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| dashboard | dashboard | owner / Company | D1, D10 | `/dashboard` (from `/projects` → sidebar Dashboard) | dashboard.service widgets | ≥5 widget links in `#nesto-main`, hydrated | open a widget link | n/a (widget fan-out, route pass) | lead run | lead run | lead run | lead run | lead run | I-03 |
| projects | projects | owner / Company | D1, D10 | `/projects` (from `/dashboard` → sidebar Projects) | `listPortfolioProjects`, `GET /api/projects` | ≥1 `project-card-link`, hydrated | open a project card | 5 → 5 (`listProjects`, Project×2). Portfolio 12 → 60: tests/perf/projects-page.perf.test.ts | lead run | lead run | lead run | lead run | lead run | I-03 |
| project-units | projects | pm / Company | D1, D10 (units) | `/projects/project_a/units` (from project overview → Units tab) | `listProjectUnits` | ≥1 `unit-row` (desktop) or `unit-card` (phone) | filter / open a unit | constant, 5 → 10,000 units: tests/perf/project-structure.perf.test.ts | lead run | lead run | lead run | lead run | lead run | I-01 |
| tasks | tasks | owner / Company | D1, D10 | `/tasks/all` (from `/tasks` → All tab) | `listTasksForWorkspace`, `GET /api/tasks` | ≥5 task row or card links + search field, hydrated | search / open a task | **9 → 9** (ops 3 → 3) | lead run | lead run | lead run | lead run | lead run | I-01, I-02 |
| invoices | finance | finance / Company | D1, D10 | `/finance/invoices` (from `/finance` → Invoices) | `listInvoicesForWorkspace`, `GET /api/finance/invoices` | ≥3 invoice row or card links + search field | search / open an invoice | **10 → 10** (ops 4 → 4) | lead run | lead run | lead run | lead run | lead run | I-01 |
| expenses | finance | finance / Company | D1, D10 | `/finance/expenses` (from `/finance` → Expenses) | `listExpensesForWorkspace`, `GET /api/finance/expenses` | ≥3 expense row or card links + search field | search / open an expense | **9 → 9** (ops 4 → 4) | lead run | lead run | lead run | lead run | lead run | I-01 |
| documents | documents | owner / Company | D1, D10 | `/documents/all` (from `/documents` → All tab) | `listDocumentsForWorkspace`, `GET /api/documents` | ≥3 document row or card links + search field | search / open a document | **35 → 35** (ops 28: one attachment-parent read per record type, not per row) | lead run | lead run | lead run | lead run | lead run | — |
| approvals | approvals | owner / Company | D1, D10 | `/approvals` (from `/dashboard` → sidebar Approvals) | `listApprovalsForWorkspace`, `GET /api/approvals` | ≥1 `approval-row`, hydrated (an empty state is a failure) | open an approval | **89 → 89** (ops 56, eleven providers) | lead run | lead run | lead run | lead run | lead run | I-05 |
| daily-logs | daily logs | pm / Company | D1, D10 | `/daily-logs` (from `/dashboard` → sidebar Daily logs) | `listDailyLogs`, `GET /api/daily-logs` | ≥1 `daily-log-row` + search field | search / open a log | **12 → 12** (one run gave 12 → 11: a relation read Prisma skipped) | lead run | lead run | lead run | lead run | lead run | — |
| group-dashboard | dashboard | owner / Group | D1, Group 1/5/10 | `/dashboard` (from `/projects` → sidebar) | dashboard.group | ≥5 widget links | open a widget link | n/a (route pass) | lead run | lead run | lead run | lead run | lead run | I-03 |
| group-projects | projects | owner / Group | D1 | `/projects` (from `/dashboard` → sidebar) | `listPortfolioProjects` (group) | ≥3 `project-card-link` | open a project | route pass | lead run | lead run | lead run | lead run | lead run | I-03 |
| group-tasks | tasks | owner / Group | D1 | `/tasks/all` (from `/tasks` → All tab) | `listTasksForContexts` (one union query) | ≥5 task links + search | search / open | **9 → 9** (ops 7: CompanySettings ×5, one per company, bounded) | lead run | lead run | lead run | lead run | lead run | I-01, I-02 |
| group-invoices | finance | finance / Group | D1 | `/finance/invoices` (from `/finance`) | register union | ≥3 invoice links + search | search / open | **10 → 10** | lead run | lead run | lead run | lead run | lead run | I-01 |
| group-expenses | finance | finance / Group | D1 | service only | register union | — | — | **9 → 9** | — | — | — | — | — | — |
| group-documents | documents | owner / Group | D1 | service only | `listDocumentsAcross` | — | — | **49 → 49** (per company and record type, not per row) | — | — | — | — | — | — |
| group-approvals | approvals | owner / Group | D1 | `/approvals` (from `/dashboard`) | `listApprovalsForWorkspace` (group) | ≥1 `approval-row` | open an approval | **175 → 175** (5 companies × 11 sources, bounded; CW-23 ceiling 250) | lead run | lead run | lead run | lead run | lead run | I-05 |

## Every other enabled module (document entry, 10 samples)

The selectors for team, organization, company, settings, support and announcements are new. Confirm them with the discover pass (`AUD07_DISCOVER=1`) before timing.

| ID | Module | Role / workspace | Route | Data-ready marker | Primary interaction | Cold p50/p95 desktop · phone | Defect |
|---|---|---|---|---|---|---|---|
| clients | clients | sales / Company | `/clients/all` | ≥2 client row or card links + search field | search / open (list SQL **7 → 7**) | lead run | I-01 |
| sales | sales | sales / Company | `/sales` | ≥1 link under `/sales/` | open pipeline | lead run | I-04 (1 of 10 phone samples) |
| contracts | contracts | legal / Company | `/contracts` | ≥1 link under `/contracts/` | open a contract | lead run | — |
| procurement | procurement | procurement / Company | `/procurement` | ≥1 link under `/procurement/` | open a request | lead run | — |
| inventory | inventory | inventory / Company | `/inventory` | ≥1 link under `/inventory/` | open an item | lead run | — |
| hse | hse | hse / Company | `/hse` | ≥1 link under `/hse/` | open an inspection | lead run | — |
| qaqc | qaqc | qaqc / Company | `/qaqc` | ≥1 link under `/qaqc/` | open an inspection | lead run | — |
| hr | hr | hr / Company | `/hr` | ≥1 link under `/hr/` | open employees | lead run | — |
| meetings | meetings | pm / Company | `/meetings` | ≥1 link under `/meetings/` | open a meeting | lead run | — |
| calendar | calendar | pm / Company | `/calendar` | ≥1 `calendar-*` element | open an event | lead run | — |
| timesheets | timesheets | pm / Company | `/timesheets` | ≥1 `timesheet*` element | edit the week | lead run | — |
| engineering | engineering | engineer / Company | `/engineering` | ≥1 engineering link | open a drawing | lead run | — |
| contractors | contractors | pm / Company | `/contractors` | ≥1 link under `/contractors/` | open a contractor | lead run | — |
| workforce | workforce | hr / Company | `/workforce` | ≥1 link under `/workforce/` | open a worker | lead run | — |
| people | people | owner / Company | `/people` | ≥3 links under `/people/` | open a person | lead run | — |
| activity | announcements | owner / Company | `/activity` | ≥3 `activity-row` | open an item | lead run | — |
| announcements | announcements | owner / Company | `/announcements` | ≥1 announcement link | open an announcement | lead run | — |
| team | team | owner / Company | `/team` | ≥3 team row or card links + search field | search / open a member | lead run | — |
| organization | organization | owner / Company | `/organization` | ≥1 `department-metric` | open a department | lead run | — |
| company | company | owner / Company | `/company` | ≥1 link under `/company/` | open a section | lead run | — |
| settings | settings | owner / Company | `/settings` | ≥3 links under `/settings/` | open a section | lead run | — |
| support | support | owner / Company | `/support` | ≥1 link under `/support/` | open a section | lead run | — |

Heavy previews, 3D assets and long exports need their own manifest-specific budgets (§4). They are not timed here. The finance CSV export is measured in `tests/perf/finance-registers.perf.test.ts` (10,000 invoices, bounded memory).

## Instrument defects closed (baseline at 324a3ca9)

| ID | Defect | Fix |
|---|---|---|
| I-01 | Phone cold scenarios recorded 0 usable samples for tasks, invoices, expenses, project-units, group-tasks, group-invoices and clients. The selectors expected desktop table rows, but phones render DataTable cards (`[data-record-card]`) and unit cards. | `list()` matches a table row link or a record-card link. Project units match `unit-row` or `unit-card`. |
| I-02 | Desktop tasks and group-tasks recorded 0 of 30 warm and uncached samples. The sidebar Tasks entry opens the overview (`/tasks`), not `/tasks/all`, so the page never reached the list. | Start from `/tasks` and click the All tab. Readiness also requires the route's own path, so a wrong destination now fails with `blocker: "at /tasks"`. |
| I-03 | Warm and uncached dashboard and projects measured about 0 ms. The origin page already showed elements that matched the destination's selector, and the check resolved before the navigation. | Records on the origin page are marked stale before the click, readiness requires the destination path, and projects match `project-card-link` only. |
| I-04 | Sometimes `MutationObserver … parameter 1 is not of type 'Node'` when the check ran while the document was being replaced. | The check polls until `documentElement` exists and then observes it, guarded. |
| I-05 | An approvals "empty" state counted as usable (fake-empty success, PS-02). | Only `approval-row` counts. |
| I-06 | "Usable" did not require hydration or the primary control. | Records and the control must carry React props, and the control must be enabled. |
| I-07 | Warm and uncached did not show that prefetch did or did not happen per attempt. | Each attempt records `prefetched` for the destination path, and each scenario reports `modeVerified`. |
| I-08 | Phone warm and uncached were not measured. | Measured on phones too; the drawer opens before the measured click. |

## Commands

The benchmark itself is run by the lead only. It needs a production build on a disposable database.

```sh
# 1. Discover pass: selectors and readiness checked, nothing timed.
AUD07_DISCOVER=1 AUD07_PROFILE=desktop E2E_BASE_URL=http://127.0.0.1:3100 AUD07_OUT=<dir> \
  npx playwright test tests/e2e/perf/aud07-baseline.spec.ts --project=chromium

# 2. Timing pass: once per profile (desktop, mobile), per build (324a3ca9 worktree, HEAD), three times.
AUD07_BENCH=1 AUD07_LABEL=<build>-r<n> AUD07_PROFILE=desktop|mobile AUD07_COHORT=D1 \
  E2E_BASE_URL=http://127.0.0.1:<port> AUD07_BUILD_COMMIT=<sha> AUD07_OUT=<dir> \
  DATABASE_URL=<that server's database> \
  npx playwright test tests/e2e/perf/aud07-baseline.spec.ts --project=chromium
#    → <dir>/aud07-<label>-<profile>.json

# 3. SQL pass (PS-04): the server started with the counter on and its stdout kept.
NESTO_PERF_SQL_COUNT=1 npx next start -p <port> > <dir>/server-<build>.log 2>&1 &
AUD07_BENCH=1 AUD07_LABEL=<build>-sql AUD07_SAMPLES=5 AUD07_WARMUP=1 AUD07_OTHER_SAMPLES=3 \
  AUD07_SERVER_LOG=<dir>/server-<build>.log E2E_BASE_URL=http://127.0.0.1:<port> AUD07_OUT=<dir> \
  npx playwright test tests/e2e/perf/aud07-baseline.spec.ts --project=chromium
#    → "sql" in the report: primary and prefetch statements, operations and ms per attempt.

# 4. PS-05 query growth (vitest, any lane):
DATABASE_URL=<lane> npx vitest run tests/api/perf/aud07-list-query-growth.test.ts
```

Optional env: `AUD07_ONLY=tasks,invoices` limits the routes, and `AUD07_MODES=cold` or `warm,uncached` limits the modes. `E2E_BASE_URL` is required: it also stops playwright.config.ts from starting its own server. `AUD07_BASE_URL` overrides the address for this spec only.

## D10 cohort

For each company, `scripts/perf/d10-generate.ts` adds (factor − 1) × that company's D1 rows to each of these families: projects, clients, tasks, invoices, expenses, pending finance approvals, documents (metadata only, with byte sizes reported separately) and daily logs, plus units on one fixture project. It uses the company's existing members, so no identity is created. Business numbers are unique and carry the prefix. The output is deterministic: two runs give the same checksum. It refuses `nesto_erp` by name, and refuses any database that is not local, not listed in `NESTO_DISPOSABLE_DATABASES`, or in production or staging (`lib/core/database/target.ts`).

```sh
NESTO_DISPOSABLE_DATABASES=<db> DATABASE_URL="postgresql://mnrv@localhost:5432/<db>?schema=public" \
  npx tsx scripts/perf/d10-generate.ts --factor=10 --prefix=d10 --out=<dir>/d10-fixture.json
#    → row counts per company and family, D1 and added totals, family and fixture checksums,
#      expected invoice and expense totals per currency, document bytes, seed revision.
... --remove    # deletes exactly this prefix's rows
```

Measured on the lane copy of D1 (2026-09-27): D1 had projects 20, clients 97, tasks 125, invoices 37, expenses 30, pending approvals 10, documents 542, daily logs 27 and units 334. The run added 181, 878, 1,125, 333, 279, 90, 4,878, 243 and 3,006 of those, with checksum `cd7369df9bfa76c6` (identical on a second run). `--remove` restored the D1 counts.

The Group cohort with 1, 5 and 10 granted company contexts (§3) is not generated yet. The demo Group has 5 companies, so the "5" case is the D1 Group row.
