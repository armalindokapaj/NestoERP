# NAV-01 release evidence — Immediate Navigation Response

This is the release evidence §17 of the NAV-01 PRD asks for. The decisions
behind the change are in
[ADR 0012](../adr/0012-nav-01-immediate-navigation-response.md), and the route
inventory is in [NAV-01-route-inventory.md](NAV-01-route-inventory.md).

## Tested build

| | |
| --- | --- |
| Change | NAV-01 commits on `main` (see the release-readiness entry, §35) |
| Baseline | `23d3afbf`, `main` before NAV-01, built the same way on the same data |
| Build | `next build --turbopack` + `next start`: Next.js 15.5.25 with its bundled React 19.2.0-canary-0bdb9206-20250818 |
| Browser | Playwright 1.63.0: headless Chromium 153.0.8010.12 for the suite, benchmark and pictures; WebKit 26.6 for §15.4 |
| Machine | Apple M5, 10 cores, 16 GB, macOS; local, no remote region |
| Data | Isolated database `nesto_nav`: fresh `migrate deploy`, default seed and the ARMAAR seed; no background workers |

## 1. Route coverage and guard inventory

- **Pages:** `scripts/navigation/route-inventory.ts` lists 459 authenticated
  pages. Every one of them has a loading ancestor.
- **Boundaries:** 46 `loading.tsx` files, all built from one set of data-free
  skeletons.
- **Tests:** `tests/unit/navigation/route-inventory.test.ts` fails if a page
  loses its loading ancestor, and checks that each module and record journey
  named in §6 has its own shape.
- **Response contracts:** 9 redirect entry points, 2 outcome pages, and 10 pages
  whose specs assert a document 404. Those 10 answer it before streaming,
  through `app/(nesto)/pre-stream-guards.ts`. See ADR 0012, decision 3.

## 2. Test results

### Unit, API and architecture

`vitest run tests/unit/navigation tests/api/quick-create
tests/architecture/quick-create-summary.test.ts tests/api/workspace
tests/unit/workspace` runs 9 files, **92 passed**, on the isolated database.
It covers:
- the feedback store's lifecycle;
- the menu cache's TTL, capacity, joining, generation and context-key checks;
- the route inventory and the pre-stream route matching;
- the shell summary against the menu, for Finance, Viewer, Project Manager and
  the Group;
- the architecture test that keeps the summary free of database access.

### Gates

| Gate | Result |
| --- | --- |
| `verify:authorization` | Passed: 702 routes, 316 server actions |
| `verify:ownership` | Passed: 257 models, 928 write sites, 64 domains |
| `verify:production-guards` | Passed |
| `security:matrix --check` | Passed: 1 125 endpoints, none unguarded |
| `typecheck` | Clean |
| `lint` | One error, in `tests/unit/workspace/workspace-routes.test.ts`, which predates NAV-01 and is untouched by it |

### End-to-end, production build

The whole suite ran against `next start` on the isolated database, with one
worker: **527 passed, 0 failed, 13 skipped** (10.6 min). The 13 skips are the
eight opt-in NAV-01 benchmark and picture tests, and the five demo-user-switch
tests, which need `APP_ENV=development`. The query-count spec
(`tests/e2e/perf/navigation-query-count.spec.ts`) was added after that run and
is opt-in as well.

NAV-01's own specs are part of that run:
- `tests/e2e/shell/navigation-response.spec.ts`, 21 tests:
  - loading and pending feedback: held and unprefetched destinations, the
    B-over-A race, modified clicks, query-only links (including the #86151
    regression test);
  - responses and access: the denied screen, the pre-stream 404, API refusals;
  - + Create: no requests while closed, one request per key, the `c` shortcut,
    the Viewer, failure against empty, a stale context, late answers, a double
    launch, private responses, the launch into a company from the Group;
  - a Group record opening in its company.
- `tests/e2e/responsive/navigation-response-mobile.spec.ts`, 3 tests: the
  drawer tap, the loading surface at 320 px, and + Create's sheet states.

### WebKit (§15.4)

WebKit 26.6 (Playwright's `webkit` v2359) ran the same build:
- **Desktop Safari**, the auth specs and `navigation-response.spec.ts`:
  33 passed, 5 skipped (the development-only demo switch).
- **iPhone 14 Pro**, `navigation-response-mobile.spec.ts`: 3 passed.

Two things came up, neither caused by NAV-01:
- **WebKit needs https for a local production build.** The production
  content security policy includes `upgrade-insecure-requests`
  (`lib/core/security/csp.ts`). WebKit applies it on loopback too, so over
  `http://127.0.0.1` every script is upgraded to https and fails, and all 38
  WebKit tests fail at sign-in. Chromium doesn't upgrade loopback. The run
  therefore went through a local TLS proxy in front of `next start`, with a
  self-signed certificate and `ignoreHTTPSErrors`.
- **A race in one test.** "Choosing B while A is held" held only A's
  navigation request. WebKit's prefetch of A had arrived before the click, so
  A committed at once with its skeleton, as designed, and the test's
  pending-shell check found nothing. The test now holds A from the start,
  prefetch included. It passes 3 of 3 in both engines.

## 3. Timing (§14)

### How it was measured

- **Builds.** The baseline (`23d3afbf`) and NAV-01 were built the same way
  and served by `next start` on the same machine and database. They ran side
  by side, one pair of runs per profile, so both saw the same load.
- **Spec.** `NAV_BENCH=1 playwright test
  tests/e2e/perf/navigation-benchmark.spec.ts`, in Chromium, with 30 samples
  per scenario and category.
- **Profiles.** The §14.3 profiles are applied through the DevTools protocol:
  - desktop: 1440×900, 100 ms latency, 10/5 Mbps, no CPU slowdown;
  - mobile: 390×844, 150 ms latency, 4/1 Mbps, 4× CPU slowdown.
- **Transitions.** Each starts on an origin page that was loaded as a
  document. It waits 400 ms for the link's default prefetch, then clicks from
  inside the page. Timing starts at that click.
- **Categories.**
  - *Warm:* the link's default prefetch has arrived before the click.
  - *Uncached:* the tab reports a crawler user agent, so the router prefetches
    nothing; the run records 0 prefetch requests. The server renders as
    usual.
- **Baseline feedback.** The baseline has no pending feedback, so its "first
  feedback" is the destination itself.
- **Sign-in.** Each role signs in in a new browser context. A second sign-in
  in the same tab fails against a local http production build, in both builds:
  the production HSTS header and `upgrade-insecure-requests` move that tab's
  requests to https. Deployments are https, so users are not affected.
- **Raw results.** `docs/navigation/benchmarks/nav-benchmark-{before,after}-{desktop,mobile}.json`.

### Desktop

Warm: the default prefetch has arrived. Median / p95 in ms, baseline → NAV-01, 30 samples each:

| Scenario | First feedback | Route committed | Content usable | Content median |
| --- | --- | --- | --- | --- |
| Dashboard → Projects | 124 / 135 → **1 / 2** | 124 / 134 → 7 / 9 | 124 / 135 → 413 / 431 | +233 % |
| Projects → project detail | 331 / 349 → **1 / 1** | 26 / 38 → 51 / 63 | 331 / 349 → 357 / 378 | +8 % |
| Project → Units | 444 / 460 → **1 / 1** | 18 / 30 → 41 / 65 | 444 / 460 → 345 / 374 | -22 % |
| Finance → Invoices | 469 / 503 → **1 / 1** | 167 / 191 → 57 / 71 | 469 / 503 → 364 / 381 | -22 % |
| Clients → client detail | 152 / 178 → **1 / 1** | 151 / 178 → 56 / 71 | 152 / 178 → 358 / 379 | +136 % |
| Tasks → task detail | 231 / 248 → **1 / 2** | 231 / 248 → 116 / 121 | 231 / 248 → 419 / 435 | +81 % |

Uncached: nothing prefetched. Median / p95 in ms, baseline → NAV-01, 30 samples each:

| Scenario | First feedback | Route committed | Content usable | Content median |
| --- | --- | --- | --- | --- |
| Dashboard → Projects | 120 / 129 → **2 / 3** | 120 / 129 → 121 / 126 | 120 / 129 → 128 / 429 | +7 % |
| Projects → project detail | 420 / 429 → **2 / 3** | 117 / 122 → 117 / 122 | 420 / 429 → 139 / 434 | -67 % |
| Project → Units | 138 / 151 → **2 / 3** | 116 / 124 → 120 / 128 | 138 / 151 → 148 / 429 | +7 % |
| Finance → Invoices | 431 / 446 → **2 / 4** | 120 / 128 → 119 / 126 | 431 / 446 → 130 / 429 | -70 % |
| Clients → client detail | 124 / 131 → **3 / 3** | 123 / 131 → 120 / 129 | 124 / 131 → 128 / 141 | +3 % |
| Tasks → task detail | 122 / 130 → **2 / 4** | 122 / 130 → 118 / 125 | 122 / 130 → 125 / 137 | +2 % |

+ Create. Median / p95 in ms, baseline → NAV-01:

| Case | Panel visible | Actions shown | Actions requests, 30 opens |
| --- | --- | --- | --- |
| First open on a page | 10 / 11 → **10 / 11** | 10 / 11 → 209 / 242 | 30 → 30 |
| Reopen | 11 / 16 → **6 / 15** | | |

Group record → company record, which switches the workspace. Median / p95 in ms, baseline → NAV-01:

| First feedback | Route committed | Content usable | Landed on the record |
| --- | --- | --- | --- |
| 45 / 93 → 41 / 89 | — → 254 / 263 | — → 308 / 321 | 0/30 → **30/30** |

Document loads. Median / p95 in ms, baseline → NAV-01:

| Case | Time to first byte | Content usable | Content median |
| --- | --- | --- | --- |
| Cold entry, /dashboard | 37 / 64 → 35 / 44 | 326 / 352 → 314 / 353 | -4 % |
| Cold entry, /projects | 27 / 34 → 21 / 29 | 203 / 259 → 229 / 258 | +13 % |
| Cold entry, /finance/invoices | 28 / 39 → 22 / 31 | 255 / 291 → 260 / 280 | +2 % |
| Workspace switch → dashboard usable | — → — | 272 / 421 → 268 / 308 | -1 % |

### Mobile

Dashboard → Projects is desktop-only: the phone reaches Projects through the drawer, which `navigation-response-mobile.spec.ts` covers.

Warm: the default prefetch has arrived. Median / p95 in ms, baseline → NAV-01, 30 samples each:

| Scenario | First feedback | Route committed | Content usable | Content median |
| --- | --- | --- | --- | --- |
| Projects → project detail | 319 / 379 → **4 / 6** | 16 / 18 → 22 / 26 | 319 / 379 → 331 / 338 | +4 % |
| Project → Units | 515 / 525 → **4 / 5** | 15 / 17 → 23 / 25 | 515 / 525 → 338 / 347 | -34 % |
| Finance → Invoices | 490 / 504 → **5 / 5** | 200 / 206 → 22 / 24 | 490 / 504 → 328 / 496 | -33 % |
| Clients → client detail | 204 / 211 → **4 / 5** | 203 / 210 → 21 / 22 | 204 / 211 → 330 / 339 | +62 % |
| Tasks → task detail | 206 / 214 → **5 / 5** | 205 / 213 → 25 / 27 | 206 / 214 → 330 / 338 | +60 % |

Uncached: nothing prefetched. Median / p95 in ms, baseline → NAV-01, 30 samples each:

| Scenario | First feedback | Route committed | Content usable | Content median |
| --- | --- | --- | --- | --- |
| Projects → project detail | 204 / 217 → **5 / 6** | 184 / 195 → 191 / 201 | 204 / 217 → 210 / 220 | +3 % |
| Project → Units | 262 / 273 → **5 / 6** | 192 / 199 → 196 / 271 | 262 / 273 → 274 / 288 | +5 % |
| Finance → Invoices | 201 / 503 → **5 / 6** | 194 / 202 → 189 / 197 | 201 / 503 → 214 / 502 | +6 % |
| Clients → client detail | 200 / 206 → **5 / 6** | 199 / 205 → 187 / 193 | 200 / 206 → 209 / 214 | +4 % |
| Tasks → task detail | 200 / 210 → **6 / 7** | 199 / 209 → 192 / 199 | 200 / 210 → 213 / 220 | +6 % |

+ Create. Median / p95 in ms, baseline → NAV-01:

| Case | Panel visible | Actions shown | Actions requests, 30 opens |
| --- | --- | --- | --- |
| First open on a page | 8 / 13 → **9 / 10** | 9 / 13 → 313 / 320 | 30 → 30 |
| Reopen | 5 / 14 → **6 / 14** | | |

Group record → company record, which switches the workspace. Median / p95 in ms, baseline → NAV-01:

| First feedback | Route committed | Content usable | Landed on the record |
| --- | --- | --- | --- |
| 115 / 127 → 114 / 119 | — → 393 / 410 | — → 596 / 623 | 0/30 → **30/30** |

Document loads. Median / p95 in ms, baseline → NAV-01:

| Case | Time to first byte | Content usable | Content median |
| --- | --- | --- | --- |
| Cold entry, /dashboard | 32 / 43 → 35 / 46 | 410 / 437 → 426 / 470 | +4 % |
| Cold entry, /projects | 21 / 26 → 18 / 23 | 404 / 423 → 407 / 428 | +1 % |
| Cold entry, /finance/invoices | 21 / 26 → 22 / 27 | 322 / 341 → 332 / 372 | +3 % |
| Workspace switch → dashboard usable | — → — | 512 / 556 → 533 / 578 | +4 % |

### Against the §14.2 budgets

| §14.2 budget | Target (desktop / mobile) | Desktop | Mobile | Result |
| --- | --- | --- | --- | --- |
| Accepted navigation → first visible feedback, p95 | 100 / 150 ms | 1–4 ms; the Group hop 89 ms | 5–7 ms; the Group hop 119 ms | Met |
| Skeleton or content when the fallback is prefetched, p95 | 200 / 300 ms | Skeleton with the route commit at 9–121 ms | 22–27 ms | Met |
| + Create activation → visible panel, p95 | 100 / 150 ms | 11 ms first open, 15 ms reopen | 10 ms, 14 ms | Met |
| Actions requests in 10 route changes with the panel closed | 0 | 0 (§4) | Not measured separately; same code at every width | Met |
| Project-choice requests without a project flow | 0 | 0 (E2E) | | Met |
| Repeated open on a fresh same-key cache | 0 more | 0: 30 requests for 30 first opens and 30 reopens | 0 | Met |
| First open on an uncached key | exactly 1 | 1, with repeated `C` presses during the load (E2E) | | Met |
| Same-workspace transitions | no document reload, no shell remount | 0 document loads in 10 navigations (§4) | | Met |
| Shell displacement from loading or pending UI | none | Checked in the §6 pictures, not by a bounding-box test: the bar is fixed, the dot uses the link's own space | | Met by inspection |
| + Create summary overhead | 0 shell queries | 26.25 statements per shell list, before and after (§5) | | Met |
| Content usable, against the baseline | at most +10 % median or p95 | Warm: +233 %, +136 %, +81 % on three rows, −22 % on two. Uncached p95 up to about 430 ms on four rows. Cold `/projects` median +13 % (p95 unchanged) | Warm: +62 %, +60 % on two rows, −33 % and −34 % on two. Uncached within +6 %. Document loads within +4 % | **Not met; accepted deviation, see below** |

### Why prefetched content can arrive later

Five warm transitions break the "no more than 10 %" content rule.

| Profile | Transition | Content usable, median |
| --- | --- | --- |
| Desktop | Dashboard → Projects | 124 → 413 ms |
| Desktop | Clients → client detail | 152 → 358 ms |
| Desktop | Tasks → task detail | 231 → 419 ms |
| Phone | Clients → client detail | 204 → 330 ms |
| Phone | Tasks → task detail | 206 → 330 ms |

Project → Units and Finance → Invoices got 22–34 % faster in both profiles.
Uncached medians hold or improve, but four desktop uncached p95s rise to about
430 ms.

**Cause.** React 19.2 holds content back once it has shown a Suspense
fallback. A boundary's content is revealed no sooner than 300 ms after the
last fallback appeared (`FALLBACK_THROTTLE_MS` in the React bundled with
Next.js 15.5). A prefetched `loading.tsx` commits its skeleton at once, so
every warm transition pays that wait, however fast the server answers.

**Timed on the NAV-01 build**, unthrottled, Finance → Invoices, five runs:

| Skeleton on screen | Server answer complete | Content shown |
| --- | --- | --- |
| 7–8 ms | 18–29 ms | 306–321 ms |

**Same cause, other rows:**
- **Baseline slow rows.** The baseline's slow rows (Units, Invoices,
  uncached project and invoice pages) already had Suspense boundaries of
  their own inside those pages, and show the same ~300 ms step. On those
  rows, NAV-01 is faster.
- **Uncached p95s.** Some uncached answers stream the skeleton before the
  page, so they pay the step too.

**Why it is not fixed here.** Two PRD rules decide this. §5.1 asks that a
skeleton is never held on screen for a minimum time, and NAV-03 (pending
lifecycle) forbids patching Next.js internals. The constant can only be changed by patching the React
inside Next.js. Nothing in the application's public APIs flushes the held
content earlier: the reveal watchdog's re-renders do not reach it, because
React commits it as a separately scheduled retry.

**Decision (product owner, 24 September 2026): ship NAV-01 and record the
deviation.**
- Feedback is now immediate everywhere (1–4 ms, against 124–469 ms before).
- The fix belongs to later work:
  - NAV-03's intent prefetch can prepare the whole page for its five
    approved routes, which would let those skip the skeleton;
  - a React release that shortens or drops the hold would fix the rest.

  See §7.

## 4. Network evidence: Quick Create stays quiet

**Measured.** `tests/e2e/perf/navigation-query-count.spec.ts` signs in as the
Owner and clicks ten sidebar items in turn with + Create closed:

| | Baseline | NAV-01 |
| --- | --- | --- |
| `/api/quick-create/*` requests | 10, one per navigation | **0** |
| Router prefetches | 70 | 69 |
| Navigation requests (RSC) | 11 | 11 |
| Document loads | 0 | 0 |

**Asserted.** `tests/e2e/shell/navigation-response.spec.ts` asserts these in
every run:
- "ordinary browsing with Create closed makes no Quick Create request": ten
  sidebar navigations and a reload, zero requests.
- "the first `C` opens the panel before any menu exists": one actions request
  for the first open, none for a reopen, and no project request.
- "a viewer with nothing to create has no button, no shortcut and no request".
- "menu responses are private and uncached, and nothing of the menu is kept in
  browser storage".

## 5. Query-count evidence: the capability summary

`NAV_QUERY_COUNT=1 playwright test tests/e2e/perf/navigation-query-count.spec.ts`
ran against each build in turn, with nothing else connected to the database.
It counts Postgres transaction commits for the whole database. Prisma commits
each statement it sends outside a transaction on its own, so a commit is one
statement. Backends report their counts up to 10 s late, so each measured
window has 11 s of quiet on either side. Figures are medians of three rounds;
the raw output is `docs/navigation/benchmarks/nav-query-count-{before,after}.json`.

| Statements | Baseline | NAV-01 |
| --- | --- | --- |
| Per `GET /api/workspaces`, which carries + Create's summary (rounds) | 27.15 (27.15, 27.25, 26.25) | 26.25 (27.7, 26.25, 26.25) |
| `/dashboard` document load, prefetching off | 731 | 800 |
| `/dashboard` document load, with its 23 prefetches | 767 | 1 077 |
| Per prefetch | 1.6 | 12.0 |
| Ten sidebar navigations, + Create closed | 1 935 | 2 123 |

An earlier run of the same measurement, before it became the spec, gave the
same picture:
- 26.25 per workspace list in both builds;
- 5.6 against 13.0 per prefetch;
- 1 812 against 2 079 for the ten navigations.

The exact figures move by a few percent between runs; the direction does not.

- **The summary adds no queries.**
  - Warm, the workspace list costs 26.25 statements in both builds. The first
    round is about one statement higher in both.
  - `tests/architecture/quick-create-summary.test.ts` keeps it that way: the
    summary is built from pure helpers over the contexts `listWorkspaces`
    already has, and the client never imports the menu service.
- **The ten navigations cost 10–15 % more.**
  - The ten menu requests are gone, but a router prefetch now costs about 12
    statements, against 2–6 before.
  - The cause is the loading boundary. It gives a dynamic route something to
    prefetch, so the prefetch runs the `(nesto)` layout — session, workspace
    and shell — before stopping at the skeleton. Without a boundary, it
    stopped earlier.
  - The PRD (NAV-05) keeps the framework's default prefetch in this phase. Making the layout
    cheaper is NAV-02's work (request scope and deferred shell slots), and
    choosing what to prefetch is NAV-03's. See §7.

## 6. Pictures

Captured by `NAV_EVIDENCE=1 playwright test tests/e2e/perf/navigation-evidence.spec.ts`
against the production build. Destinations were held with test-only route
delays, as §14.3 step 6 allows.

| Desktop, 1440×900 | Phone, Pixel 7 |
| --- | --- |
| [Loading skeleton and top bar](evidence/desktop-01-loading-skeleton.jpg) | [Loading skeleton after a drawer tap](evidence/phone-01-loading-skeleton.jpg) |
| [Pending mark on an unprefetched item](evidence/desktop-02-pending-mark.jpg) | [+ Create loading](evidence/phone-02-quick-create-loading.jpg) |
| [+ Create loading](evidence/desktop-03-quick-create-loading.jpg) | [+ Create retry](evidence/phone-02-quick-create-retry.jpg) |
| [+ Create retry](evidence/desktop-03-quick-create-retry.jpg) | [+ Create empty](evidence/phone-02-quick-create-empty.jpg) |
| [+ Create empty](evidence/desktop-03-quick-create-empty.jpg) | [Denied module](evidence/phone-03-denied.jpg) |
| [Denied module](evidence/desktop-04-denied.jpg) | |

## 7. Waits left for Phase 2

**The `(nesto)` layout sends nothing until it has settled everything below.**
That covers every document load, every prefetch and every workspace switch.
Its waits, in order:

1. **`requireUserContext()`:** the session, membership, organization access
   and modules.
2. **Maintenance and the pre-stream guard,** in parallel. The guard only
   waits for the ten routes with a 404 contract.
3. **`AppShell`,** which waits for four reads together: the navigation, the
   announcement state (unread count plus the critical banner), the
   development-only organization access, and `listWorkspaces`. The last one
   builds the full workspace chooser, and + Create's summary rides along with
   no queries of its own.

**What it costs**, measured in §3 and §5:

| Measure | Result |
| --- | --- |
| Time to first byte, cold entry, local database | 21–35 ms median, 29–44 ms p95; about the same before |
| Cold entry, content usable (desktop) | 229–314 ms median |
| Workspace switch to a usable dashboard (desktop) | 268 ms median, 308 ms p95 |
| Statements per `GET /api/workspaces` | 26.25 |
| Statements per router prefetch | 12–13, against 2–6 before |

The prefetch cost rose because each prefetch now renders the layout down to
its loading boundary. On a remote database, every one of those statements
also pays a round trip.

**For NAV-02:**
- Stream the chooser, the banner and the development panel in their own
  slots.
- Drop the shell's unread COUNT.
- Resolve organization access, modules and company contexts once per
  request.
- Serve maintenance from a short page cache.

Together these shorten both the first byte and the price of every prefetch.
NAV-01's summary is already free of queries, and it moves into NAV-02's
`ShellCoreDTO` unchanged.

**For NAV-03:**
- The 300 ms reveal hold (§3) on warm transitions. Selective full prefetch of
  the approved routes lets them skip the skeleton.
- Choosing which links are worth their 12-statement prefetch at all.

## Findings from the release run, fixed in this change

1. **Status contracts.**
   - **Problem:** the global loading boundary turned every asserted record 404
     into a 200 with a streamed not-found page.
   - **Fix:** the ten routes with such a contract answer before streaming
     (ADR 0012, decision 3). The full run also found
     `/qaqc/inspections/[inspectionId]`, whose assertion sits inside a boolean
     expression.
2. **Same-tab workspace echo.**
   - **Problem:** a tab's own `WORKSPACE_CHANGED` broadcast reloaded the page
     it was leaving, before its navigation committed. So a Quick Create launch
     into another company, and a record opened from a Group list, landed back
     where they started.
   - **Fix:** every switch-then-go flow suppresses its own echo and loads its
     destination (ADR 0012, decision 7). The benchmark's Group-record scenario
     checks where each hop ends.
3. **Navigations the framework leaves waiting** —
   [vercel/next.js#86151](https://github.com/vercel/next.js/issues/86151).
   - **Problem:** with loading boundaries, some soft navigations had their page
     and did not show it for 10–44 s.
   - **Fix:** a watchdog wakes them (ADR 0012, decision 8). A regression test
     clicks a query-only HR report tab and expects the commit within 3 s.
4. **Streaming duplicates in E2E.**
   - **Problem:** on a document load, a hidden server copy of the page briefly
     sits beside the client-rendered one. That happened on 9 of 32 loads,
     against 0 of 32 before NAV-01. It is inherent to streaming boundaries in
     this Next.js version (ADR 0012, Consequences).
   - **Fix:** the E2E sign-in helper deletes the orphaned copy as soon as its
     boundary's placeholder is gone, and the same probe then sees 0 of 32. The
     specs that failed on it are also scoped to `mainRegion(page)`.
5. **The phone's + Create sheet sat above the screen.** This predates NAV-01;
   the pictures for §17 item 6 showed it.
   - **Problem:** the top bar's `backdrop-filter` makes the bar the box that
     `position: fixed` children are placed in. So the sheet's `bottom: 0` was
     the bar's lower edge: on a Pixel 7 the sheet's top sat at −500 px, and
     only its last 55 px showed, over the bar.
   - **Fix:** the blur moved to a layer behind the bar's content, so the bar
     looks the same and the sheet rests on the bottom of the screen. The Q24
     phone test now also checks that the whole sheet is on screen, which fails
     without the fix.

## Rollback

Revert the NAV-01 commits. There is no migration. The additive `contextKey` on
`/api/quick-create/actions` is ignored by older clients, and the older client
does not need the shell summary. Server authorization is unchanged by the
revert either way.
