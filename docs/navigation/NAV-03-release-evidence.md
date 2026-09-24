# NAV-03 release evidence — Further Navigation Optimization

This is the review evidence NAV-03 §18.3 asks for, in its order. The
decisions are in [ADR 0014](../adr/0014-nav-03-further-navigation-optimization.md).
The phases before it are in [NAV-01](NAV-01-release-evidence.md) and
[NAV-02](NAV-02-release-evidence.md).

Every number below says which build produced it. **Baseline** is the NAV-02
release, `e27d6735`. **NAV-03** is the change in this release. The raw
results are in [benchmarks/](benchmarks/), in files named `nav03-*` that say
`baseline` or `nav03`.

## Tested build

| | |
| --- | --- |
| Change | NAV-03 commits on `main` (release-readiness §37) |
| Baseline | `e27d6735`, `main` after NAV-02, built the same way and run on the same data |
| Build | `next build --turbopack` + `next start`: Next.js 15.5.25, React 19.1.0 |
| Browser | Playwright 1.63.0, headless Chromium 153.0.8010.12; WebKit for the critical flows (§8) |
| Machine | Apple M5, 10 cores, 16 GB, macOS. Local Postgres 16.15, no remote region |
| Data | Isolated database `nesto_nav`: `migrate deploy`, the default seed and the ARMAAR seed. No background workers |
| Instances | One `next start` per build: baseline on :3100, NAV-03 on :3200 with `NESTO_TEST_SHELL_DELAYS=1` |
| Flags | Intent prefetch on. Telemetry sampling 0 % for every byte and statement count, so a randomly sampled document cannot add requests to one run and not another; 100 % for the telemetry evidence (§7); the default 10 % for the timings (§2) |

## 1. Initial JavaScript and panel code (§18.3 item 1)

**How it was measured.** `tests/e2e/perf/nav03-evidence.spec.ts` with
`NAV03_CHUNKS=1`:
- a signed-in cold document load, in a new browser context with an empty HTTP
  cache, panels closed and nothing hovered;
- every script from resource timing, with transfer (compressed, as served)
  and decoded sizes;
- then each panel opened in turn, counting only the files that open added.

**`/dashboard`, panels closed:**

| | Files | Transfer | Decoded |
| --- | --- | --- | --- |
| Baseline | 23 | 263,458 B | 835,363 B |
| NAV-03 | 23 | **261,486 B (−1,972 B, −0.75 %)** | 819,106 B (−16,257 B) |

**What each panel adds when first opened (NAV-03).** The baseline adds
nothing, because all four were already in the first load.

| Panel | Files | Transfer |
| --- | --- | --- |
| Search | 1 | 4,405 B |
| + Create | 1 | 4,868 B |
| Activity | 1 | 4,411 B |
| Workspace | 1 | 2,346 B |
| **All four opened** | | **277,516 B, +5.34 % on the baseline's 263,458 B** |

**Every required page, cold, panels closed:**

| Page | Baseline | NAV-03 | Change |
| --- | --- | --- | --- |
| `/dashboard` | 263,458 B | 261,486 B | −1,972 B |
| `/clients` | 263,131 B | 261,127 B | −2,004 B |
| `/tasks` | 263,554 B | 261,572 B | −1,982 B |
| `/finance` | 263,554 B | 261,572 B | −1,982 B |
| `/projects/project_a` | 285,192 B | 284,069 B | −1,123 B |

**Against the gates (PERF-01, PERF-02):**

| Gate | Result |
| --- | --- |
| No panel-specific chunk before a first open or warm | **Pass.** Each body arrives as its own file on first open |
| Initial JS must decrease on Dashboard, panels closed | **Pass,** −0.75 % |
| No required page grows by more than 5 KiB | **Pass.** All five shrink |
| All panels cumulative within +10 % | **Pass,** +5.34 % |
| New telemetry JS within 5 KiB, initial | **Pass.** An unsampled document carries only the gate and registry, and every page still shrinks. A sampled document downloads the recorder after its page is up (§7) |
| Target: 20 % less shell-attributable initial JS | **Missed.** See below |

**Why the reduction is small.**
- **The panel split alone:** measured after WP2–4, it took Dashboard to
  258,571 B, 4,887 B (−1.9 %) under the baseline. The four bodies are
  16,030 B of transfer as separate files. The same code compressed together
  with the rest of the first load weighed far less.
- **The later work:** intent prefetch, the section boundary with its Retry
  (a new 1.85 KB chunk on every streamed page) and the telemetry gate added
  2,915 B back, to 261,486 B.
- **What is left in the shell:** the panels' triggers, shortcuts, the bell's
  count and the workspace label stay, as §6 requires. The 20 % target would
  need most of the shared UI (dialog, popover and form parts) to leave the
  first load as well, which NAV-03 did not attempt.

**How the telemetry gate came about.** The first NAV-03 build shipped the
recorder, Web Vitals and the transport to every document. That put Dashboard
at 265,231 B, +0.67 % on the baseline, and failed the gate. Loading them
only in a sampled document fixed it (ADR 0014, decision 7).

## 2. Page and panel timings (§18.3 item 2)

**How it was measured.** `tests/e2e/perf/nav03-benchmark.spec.ts` with
`NAV03_BENCH=1`:
- **Profile:** the desktop profile (1440×900, 40 ms round trip, 20 Mbps down,
  no CPU slowdown), OWNER, 30 samples per cohort.
- **One build at a time:** the baseline, then NAV-03, with nothing else
  running. A first run benchmarked both builds at the same moment and was
  discarded: they slowed each other unevenly. It showed the project home's
  document core at +32 %; run alone, the same build is 20 % faster.
- **Stages,** timed in the page from navigation start (document) or the
  click (sidebar):
  - *core:* the loading skeleton is gone and the page title is drawn;
  - *primary:* the page's primary section is drawn, with nothing pending
    inside it. The baseline has no section markers, so there primary is the
    same moment as core;
  - *settled:* no section placeholder is left.
- **Sidebar cohorts:** *hovered* rests the pointer on the link for 400 ms
  before clicking, as a person with a mouse does; *unprepared* clicks with
  no pointer on the link. The baseline prepares every sidebar link on sight,
  so both its cohorts are prepared. Project home is reached from the
  Projects list, whose record links keep the default prefetch in both builds.
- **The constrained mobile profile was not run** (§10).

**Document loads, median / p95:**

| Page | Core, baseline | Core, NAV-03 | Primary, baseline | Primary, NAV-03 | Primary p95 |
| --- | --- | --- | --- | --- | --- |
| `/dashboard` | 149 / 301 | 123 / 190 | 149 / 301 | 186 / 197 | −35 % |
| `/clients` | 86 / 97 | 91 / 105 | 86 / 97 | 91 / 105 | +8 % |
| `/tasks` | 136 / 145 | 90 / 101 | 136 / 145 | 90 / 132 | −9 % |
| `/finance` | 138 / 148 | 92 / 108 | 138 / 148 | 93 / 139 | −6 % |
| `/projects/project_a` | 299 / 333 | 175 / 265 | 299 / 333 | 175 / 265 | −20 % |

Settled is the same as primary except on the project home: 299 / 333 against
437 / 453. Its optional sections (media, the 3D tab) now arrive after its
frame.

**Sidebar navigations, primary section drawn, median / p95:**

| Page | Baseline | NAV-03, hovered | NAV-03, unprepared |
| --- | --- | --- | --- |
| Dashboard | 312 / 314 | 313 / 359 | 364 / 367 |
| Clients | 312 / 314 | 312 / 314 | 60 / 63 |
| Tasks | 311 / 313 | 311 / 316 | 60 / 63 |
| Finance | 312 / 313 | 312 / 314 | 61 / 63 |
| Project home | 355 / 362 | 356 / 360 | 356 / 359 |

The baseline column is its hovered cohort; its unprepared cohort is within
3 ms of it on every page. NAV-03's core on an unprepared Dashboard is 63 / 67.

**Panels, open to first usable content, median / p95:**

| Panel | Cold, baseline | Cold, NAV-03 | Warm, baseline | Warm, NAV-03 |
| --- | --- | --- | --- | --- |
| Search | 41 / 49 | 115 / 120 | 35 / 40 | 44 / 49 |
| + Create | 130 / 147 | 135 / 151 | 56 / 63 | 53 / 77 |
| Activity | 61 / 106 | 134 / 151 | 62 / 71 | 58 / 73 |
| Workspace | 69 / 88 | 73 / 93 | 69 / 73 | 73 / 83 |

A cold NAV-03 panel fetches its own code first, which the baseline had in
its first load. The time includes Playwright's action, the same in both
builds.

**Against the gates (PERF-02):**

| Gate | Result |
| --- | --- |
| Core ready: at most +10 % on any required page | **Pass.** The worst is Clients' document p95, +8 % (97 → 105 ms) |
| Primary ready: at most +10 % in any comparable cohort | **Fails on Dashboard's sidebar navigation:** p95 +14 % hovered (314 → 359 ms), +15 % unprepared (318 → 367 ms). Every other page and cohort passes |
| Primary ready: 20 % p95 improvement where the baseline exceeds 500 ms | Not applicable on desktop: no baseline p95 exceeds 500 ms |
| Cold panel p95 at most 1.5 s | **Pass,** 151 ms at most |
| Warm panel p95 at most 300 ms | **Pass,** 83 ms at most |
| Feedback p95 at most 100 ms | **Pass:** 24 ms in the telemetry sample (§7); NAV-01's feedback specs pass (§8) |

**Why Dashboard misses.** React reveals a resolved Suspense boundary no
sooner than 300 ms after placeholders were last shown (the hold NAV-01
recorded).
- **In the baseline,** the loading skeleton is shown at the click, so the
  whole page lands at about 312 ms.
- **In NAV-03,** an unprepared Dashboard's frame is drawn at 63 ms with the
  widgets' placeholders, so the first widget lands 300 ms after that, at
  364 ms. The hovered p95 is the same case: a click that came before the
  hover's prefetch answered.
- **The fix the number suggests,** drawing the first widget with the frame,
  would break STREAM-02, where every widget is its own section. It is
  recorded as a deviation (§10, ADR 0014).

**Where preparing a route helps (PREFETCH, §13).** On Dashboard, a hovered
click draws the first widget at 313 ms, not 364 ms (−14 % median), and shows
the loading skeleton at the click. On Clients, Tasks and Finance, this lab
link answers an unprepared click in about 60 ms, sooner than the 300 ms hold
that a prepared route's skeleton starts. Preparing pays when the page takes
longer than that hold to arrive, which a local server does not show.

**The same click without network throttling** (§3's streaming run) draws
Tasks' Priority work at 330 ms, not 60 ms. Unthrottled, the frame arrives
before the sections, and the sections wait for the hold. Throttled, the
whole answer arrives at once.


## 3. Streaming trace (§18.3 item 3)

**The hook.** `testSectionDelay("tasks-stats")` holds Tasks' counters section
(Open, Due today, Overdue, Blocked) when a cookie asks for it. It works only
in a build started with `NESTO_TEST_SHELL_DELAYS=1`. Priority work, the
page's primary section, reads separately.

**How it was measured.** `NAV03_STREAMING=1`, 30 samples per cohort, cohorts
interleaved, NAV-03 build, no network throttling. Time is from navigation
start (document) or the click (sidebar, from Calendar) until Priority work,
then the counters, are first in the page. Each is timed in the page, on the
mutation that adds it.

| Tasks, n = 30 per cohort | Priority work drawn, median / p95 | Counters drawn, median / p95 |
| --- | --- | --- |
| Document, nothing held | 62 / 84 ms | 62 / 70 ms |
| Document, counters held 1.5 s | 79 / 104 ms | 1,541 / 1,551 ms |
| **Added to Priority work** | **+17 ms median, +20 ms p95** | |
| Sidebar navigation, nothing held | 330 / 344 ms | 330 / 344 ms |
| Sidebar navigation, counters held 1.5 s | 326 / 348 ms | 1,527 / 1,573 ms |
| **Added to Priority work** | **−4 ms median, +4 ms p95** | |

**The gate** (an injected 1.5 s in one optional section adds at most 150 ms
to an unrelated ready section): **pass,** at +17 ms and −4 ms. The held
section still finishes correctly, after its hold.

**Why the sidebar navigation takes 330 ms.** Nothing was held; it is React's
300 ms reveal hold after the frame's placeholders (§2).

**An earlier run measured 835 ms for the same click.** It waited with
Playwright locators, which re-check at widening intervals, up to 500 ms
apart. Priority work appeared at about 350 ms, just after one check, and was
seen at the next. The spec now times each section in the page.

The same hook drives `tests/e2e/shell/progressive-sections.spec.ts`:
- a held section keeps its placeholder while title, tabs and Priority work
  are usable (S01);
- a failed section fails alone, in place, with "Couldn't load this section."
  and Retry, and its siblings render (S03, S14);
- two presses of Retry in the same moment make one route refresh, and the
  section recovers (S11).

## 4. Activity traces (§18.3 item 4)

**How it was measured.** `NAV03_ACTIVITY=1`, 16 minutes of real time per run:
the bell's requests over ten visible minutes with the panel closed, then five
minutes with the page hidden.
- **A healthy bell** is VIEWER in the demo data: no critical or attention
  count.
- **The attention cadence** (A06) is PROJECT_MANAGER, who has items needing
  attention.

| Scenario | Baseline | NAV-03 | Gate |
| --- | --- | --- | --- |
| Healthy, closed, 10 visible min: count reads | 14 (every 45 s) | **6** (at 2, 118, 234, 349, 465, 576 s) | ≤ 6: **pass** (A01) |
| Healthy, closed: list reads | 0 | 0 | 0: **pass** |
| Attention, closed, 10 visible min: count reads | 15, two of them at 0 s | 14, every 41–45 s, one at the start | 45 s cadence (A06): **pass** |
| Hidden 5 min: count and list reads (both roles) | 0 | 0 | 0: **pass** (A02) |

**Timer and race cases** are in
`tests/unit/activity/activity-controller.test.ts`, 17 tests on fake timers:
- A03: coalesced focus, visibility and online events;
- A04: open before the first count;
- A05: tab switches with reordered answers;
- A06: cadence;
- A07: one read in flight per resource, with deadline and backoff;
- A08: 429, offline and 401/403;
- A09: first-failure and stale counts;
- A11: an old read against a mutation;
- A12: duplicate local and cross-tab events;
- A16: no BroadcastChannel, and an oversized payload.

## 5. Prefetch (§18.3 item 5)

**Issue counts and the budget** are unit-tested in
`tests/unit/navigation/intent-prefetch.test.ts`:
- F01: one issue after the dwell;
- F02: leaving cancels, one candidate, 1.5 s spacing and four a minute;
- F03: hidden, offline, Save-Data and 2g;
- F04: the exact allowlist;
- F06: no refill after a failure.

**Business side effects (F07, PREFETCH-04).** `NAV03_SIDE_EFFECTS=1`
compares two windows of the same signed-in page, `/calendar`, OWNER:
- **Control:** idle for 75 s.
- **Hover:** all five destinations hovered past the dwell, the fifth after
  the one-minute budget reopens.

Each window has 11 s of quiet on both sides. Rows inserted, updated and
deleted come from Postgres' `pg_stat_user_tables` for the whole database.

| | Result |
| --- | --- |
| Destinations requested | `/clients`, `/dashboard`, `/finance`, `/projects`, `/tasks`: all five |
| Tables written during the hover window | **None** |
| Tables written during the control window | None |
| Tables checked by name | `recent_items`, `announcement_reads`, `announcement_acknowledgments`, `notifications`, `user_favorites`, `sessions`, `audit_events`, `unit_reservations`: all unchanged |

The first run showed that `/dashboard` was never requested on hover. The
NESTO logo, in the sidebar and the phone header, links to Dashboard with the
framework's default prefetch, so Dashboard was fetched on every page load
before any hover. Both logos now take part in the policy (ADR 0014, decision
4).

**Abandoned intent and SQL load (PERF-02 prefetch server load, F12).**
`NAV03_PREFETCH_LOAD=1`:
- a document load of `/dashboard`;
- then ten steps, each hovering one sidebar link 400 ms and leaving, then
  clicking a different one, five of them approved destinations;
- three rounds per build; statements are Postgres transaction commits for
  the whole database.

| | Baseline | NAV-03 |
| --- | --- | --- |
| Statements, median of 3 | 3,528 | **3,277 (−7.1 %)** |
| Statements, each round | 3,793 · 3,528 · 3,354 | 3,548 · 3,277 · 3,250 |
| Prefetch requests per round | 70 | 76 |
| Prefetches of a page not visited in that step | 64 | 70 |
| Navigation requests | 11 | 10 |

**The gate** (at most +10 % in total SQL): **pass,** −7.1 %.
- **Connection pool:** neither server logged a pool timeout (`P2024`)
  during the runs.
- **Rounds vary** by about ±8 % within one build, so the comparison is
  medians only.
- **Why NAV-03 makes six more prefetches:**
  - most prefetches in both builds come from ordinary links inside pages
    (records, tabs, cards), which keep the framework's viewport prefetch;
  - NAV-03's abandoned hovers issue within the budget;
  - the baseline had prepared the five approved links on sight once per
    document, and NAV-03 does not.
- **Net:** fewer statements despite six more prefetches. The document load
  and each of the ten navigations read less per page (§6).
- **An earlier run of the same script** gave NAV-03 +2.0 % (3,400 against
  3,333). It had telemetry sampling at 10 %, so one of its rounds sent
  telemetry batches, and it was built before the logo fix. The rerun above
  replaces it.

**Workspace boundary.**
- **F08–F11:** NAV-01's `tests/e2e/modules/workspace-context.spec.ts` still
  passes. Every switch there is a document transition, and a new context key
  resets the scheduler (unit-tested, PREFETCH-05).
- **F12 (history restore):** `tests/e2e/shell/history-cover.spec.ts` checks
  that a page leaving is covered, and that a copy restored from the
  back/forward cache reloads instead of being shown. Automated Chromium keeps
  no back/forward cache, so the test dispatches the browser's
  `pagehide`/`pageshow` events.

## 6. Query counts (§18.3 item 6)

**How it was measured.** `NAV03_PAGE_QUERIES=1`:
- each streamed page loaded three times as a document, OWNER, with every
  section arrived before the window closes;
- a crawler user agent, so the router prefetches nothing;
- statements per load, from Postgres' commits, with 11 s of quiet around
  each page's window.

The window covers everything the first seconds of the page run against the
database: the page and its sections, the shell's slots, and the bell's first
count.

| Page | Baseline | NAV-03 | Change |
| --- | --- | --- | --- |
| `/dashboard` | 725.0 | 647.3 | −10.7 % |
| `/clients` | 142.3 | 89.7 | −37.0 % |
| `/tasks` | 131.0 | 54.0 | −58.8 % |
| `/finance` | 194.0 | 111.3 | −42.6 % |
| `/projects/project_a` | 694.7 | 616.3 | −11.3 % |

**The gate** (no duplicated shared loader; settled count no higher than the
baseline): **pass** on every page. Tasks' counters and Your week share one
overview read (S05), Finance decides visibility once before its domains
load, and Dashboard plans its widgets once.

**What is not attributed.** How much of each drop is the bell's single first
count (the baseline makes two at once, §4) rather than the page's own reads.

## 7. Telemetry and monitoring (§18.3 item 7)

**How it was measured.** `NAV03_TELEMETRY=1`, against the NAV-03 build with
`NESTO_NAV_TELEMETRY_SAMPLE=1` and a `METRICS_TOKEN`:
- sign in, five sidebar navigations, open Search and Activity, then hide the
  page;
- the batches the browser sent are captured from the network;
- the protected scrape is read before and after.

The window opens after sign-in. Sign-in lands on a page before opening
Dashboard, and at 100 % sampling that page flushes its own batch while it
unloads. The server counts that batch, but the browser reports no request for
it, so the "before" scrape is read once it has arrived. A first run that
opened the window earlier counted three accepted batches against two
captured.

**Batches.** Two batches: 20 events (2,608 B) and 13 events (1,757 B).
- **Accepted:** the server's `telemetry_batch_total{outcome="accepted"}`
  rose by exactly two.
- **Events:** navigation stages (feedback 5, commit 5, core 6, primary 5,
  settled 6), panel readiness 2, and Web Vitals LCP, FCP, TTFB and INP.
- **CLS:** no CLS sample was reported in this short run.
- **Primary stage:** one navigation, to the Projects list, has no primary
  stage. That page has no `data-section="primary"`, and a commit or a title
  alone never counts as primary (T01).

**The first batch, as sent** (its first four events):

```json
{
  "schemaVersion": 1,
  "events": [
    { "kind": "navigation", "route": "dashboard", "stage": "core", "navigationKind": "document", "outcome": "success", "durationMs": 153, "device": "wide" },
    { "kind": "navigation", "route": "dashboard", "stage": "primary", "navigationKind": "document", "outcome": "success", "durationMs": 204, "device": "wide" },
    { "kind": "navigation", "route": "dashboard", "stage": "settled", "navigationKind": "document", "outcome": "success", "durationMs": 204, "device": "wide" },
    { "kind": "web_vital", "route": "dashboard", "metric": "FCP", "value": 108, "outcome": "success", "device": "wide" }
  ]
}
```

**Privacy (T07).** Every string in every event of both batches is from the
fixed vocabulary. The test fails on anything else, and it found nothing
else: no id, URL, title, query text or error text.

**Histogram query.** A p95 from the scraped buckets, summed across routes
the way `navigation-rules.yml` sums them, with Prometheus'
`histogram_quantile` interpolation. The scrape covers everything the freshly
started server accepted: the two batches above and three from sign-in's
pages.

| Series | n | p50 | p95 |
| --- | --- | --- | --- |
| `navigation_duration_ms{stage="feedback",kind="spa"}` | 9 | 12 ms | 24 ms |
| `navigation_duration_ms{stage="commit",kind="spa"}` | 9 | 14 ms | 39 ms |
| `navigation_duration_ms{stage="primary",kind="spa"}` | 7 | 375 ms | 488 ms |
| `navigation_duration_ms{stage="primary",kind="document"}` | 2 | 250 ms | 475 ms |
| `activity_read_ms{family="count",outcome="success"}` | 2 | 38 ms | 49 ms |

These are a few samples on one machine, as proof the export works. They are
not a timing result; §2 has those.

**Monitoring configuration.** The Prometheus scrape job, recording rules
and alerts are in `ops/monitoring/navigation-nav03/`.
- **Not run against a live Prometheus:** `promtool` is not installed here,
  and the local Docker daemon was not running. The rules were checked by
  reading.
- **Before production:** run one Prometheus against staging and check the
  rules with `promtool` (the README's staging step).

**The bounds in unit and API tests:**
- `tests/unit/observability/navigation-telemetry.test.ts`: the strict schema
  (T07, T08), bucket, sum and count export, and label injection against the
  4,000-series budget (T10, T11); the recorder's 100-event queue, 20-event
  batches, two sends a minute and one final flush, and no work unsampled
  (T05, T06).
- `tests/api/telemetry/navigation-telemetry.test.ts`:
  - a valid batch answers 204 with private caching and is recorded;
  - signed-out and cross-site callers are refused;
  - an oversized body is refused while it is read, and nothing of a bad one
    is echoed (T08);
  - six batches a minute per session, then 429 with Retry-After (T09);
  - with ingestion switched off, the batch is dropped harmlessly (T12).

## 8. Test results

### Vitest

**`vitest run`, all 245 files, on a freshly seeded copy of the isolated
database** (`migrate deploy`, the default seed and the ARMAAR seed):
4,423 passed, 1 failed, 11 skipped.
- **The failed test** is `procurement-service.test.ts` › "allows the same
  order number in another company". It fails on fresh data at the NAV-01
  and NAV-02 baselines too.
- **One file did not load:** `tests/integration/auth/demo-user-switch.test.ts`.
  Its `next/cache` mock has no `unstable_cache`, which `lib/auth/demo-tenants.ts`
  has used since `730220c4` ("cache the demo roster"). That commit is not
  part of NAV-03; the mock needs `unstable_cache` added.

**The NAV-03 suites, all passing:**

| Suite | Tests | Cases |
| --- | --- | --- |
| `tests/unit/activity/activity-controller.test.ts` | 17 | A03–A09, A11, A12, A16 |
| `tests/unit/navigation/intent-prefetch.test.ts` | 7 | F01–F04, F06, PREFETCH-05 |
| `tests/unit/navigation/panel-host.test.ts` | 11 | P05, P07, P13 |
| `tests/unit/observability/navigation-telemetry.test.ts` | 10 | T05–T08, T10, T11 |
| `tests/api/telemetry/navigation-telemetry.test.ts` | 6 | T08, T09, T12 |
| `tests/api/shell/context-meta.test.ts` | 2 | §12 context key, A14 in part |

### End-to-end, production build

**The whole suite against the NAV-03 build**, Chromium and the Pixel 7
project, with `NESTO_TEST_SHELL_DELAYS=1` in both the server and the runner:
**547 passed, 2 failed, 30 skipped** (opt-in and environment-gated tests).
Both failures reproduce on the NAV-02 build:
- `documents.spec.ts:154` (a PDF preview), failing since before NAV-01;
- `projects.spec.ts:113` expects a project manager's project home to have
  no "Project sections" tabs. The tabs render in both builds on the current
  lane data; an earlier NAV-03 run of the whole suite passed it.

The NAV-03 specs in it, all passing: `lazy-panels.spec.ts`,
`progressive-sections.spec.ts`, `history-cover.spec.ts` and the
`navigation-response` specs. `lazy-panels` and `history-cover` also passed
three repeats in a row (21 of 21).

**Flags off** (`NESTO_INTENT_PREFETCH=off`, `NESTO_NAV_TELEMETRY=off`): the
navigation, shell and workspace specs, 60 passed, 3 skipped.

### WebKit

WebKit 26.6, Desktop Safari: the auth specs and `navigation-response.spec.ts`
against the NAV-03 build, **33 passed, 5 skipped** (the development-only demo
switch), as in NAV-01.
- **Through a local TLS proxy.** The production content security policy's
  `upgrade-insecure-requests` makes WebKit upgrade loopback requests too, so
  over plain `http://127.0.0.1` every WebKit test fails at sign-in. NAV-01
  found the same and used the same proxy, with a self-signed certificate
  and `ignoreHTTPSErrors`.
- **Not run:** iPhone Safari.

### Gates

| Gate | Result |
| --- | --- |
| `typecheck` | Clean |
| `lint` | One error, in `tests/unit/workspace/workspace-routes.test.ts`, which predates NAV-01; none in a NAV-03 file |
| `verify:authorization` | Passed: 705 routes, 316 server actions |
| `verify:ownership` | Passed: 257 models, 928 write sites, 64 domains, no cycle |
| `verify:production-guards` | Passed. The shell-slot check now covers the page-section hook too |
| `security:matrix --check` | Passed: 1,128 endpoints, none unguarded. `POST /api/telemetry/navigation` is new |

## 9. Acceptance-case mapping (§18.3 item 8)

**Covered:** a test or measurement asserts the expected result.
**Partial:** part of it is asserted, or it rests on an older suite that
still passes.
**Not covered:** no test asserts it yet.

### Lazy panels

| Case | Evidence | Status |
| --- | --- | --- |
| P01 | §1: every body is its own file on first open | Covered |
| P02 | §2 cold and warm panel timings. No trace proves code and data do not run in series | Partial |
| P03 | `lazy-panels.spec`: the shortcut opens at once; typing before the body arrives is kept, with focus | Covered |
| P04 | `navigation-response.spec` Q04: `c` typed in a field opens nothing. Composition and another dialog are not tested apart | Partial |
| P05 | `panel-host.test`: one attempt, a loaded body kept; `navigation-response.spec` Q11: close while loading, then reopen | Covered |
| P06 | `lazy-panels.spec`: a data failure is a local alert, and the code is not fetched again | Covered |
| P07 | `lazy-panels.spec`, `panel-host.test`: a code failure says so and offers Reload, which loads it. **Deviation:** Reload is offered at once, not after one in-page retry (§10) | Covered, with deviation |
| P08 | `lazy-panels.spec`: one overlay at a time, and Escape closes; `top-bar-mobile.spec` covers the sheets. Background interaction behind a sheet is not tested | Partial |
| P09 | NAV-02's `shell-slots.spec`, 12 tests, unchanged and passing | Covered |
| P10 | `navigation-response.spec`: no Quick Create request while closed, one on open, launch tickets (Q01–Q23) | Covered |
| P11 | The query generation and context key guard is in code; `context-meta.test` asserts the key. No test orders two answers | Partial |
| P12 | `lazy-panels.spec`: legacy `nesto-search-home:` and `nesto-activity:` entries are removed on load; sign-out clears the memory caches (code) | Covered |
| P13 | `panel-host.test`: two warms a minute, 1.5 s apart, none offline, on Save-Data, 2g or hidden, code only | Covered |
| P14 | Listener and subscription growth over repeated mounts is not measured | Not covered |

### Prefetch and workspace boundary

| Case | Evidence | Status |
| --- | --- | --- |
| F01 | `intent-prefetch.test` | Covered |
| F02 | `intent-prefetch.test` | Covered |
| F03 | `intent-prefetch.test`; touch is not intent (`NavLink` takes mouse pointers only); mobile L06 | Covered |
| F04 | `intent-prefetch.test`: the five exact paths only | Covered |
| F05 | `navigation-response.spec`: a modified click and the current page begin nothing | Covered |
| F06 | `intent-prefetch.test`: no refill | Covered |
| F07 | §5: all five hovered, no table written | Covered |
| F08–F11 | NAV-01's `workspace-context.spec` still passes: a switch is a document transition. The scheduler reset is unit-tested. No test prefetches under company A and then switches | Partial |
| F12 | `history-cover.spec` with dispatched events; §5 load gate | Covered, with synthetic events |

### Progressive sections

| Case | Evidence | Status |
| --- | --- | --- |
| S01 | §3: +17 ms and −4 ms; `progressive-sections.spec` | Covered |
| S02 | The existing dashboard authorization, group dashboard and resolver suites pass | Partial |
| S03 | `progressive-sections.spec` on Tasks. Dashboard's NOT_FOR_READER omission rests on the resolver suite | Partial |
| S04 | Clients streams its counters and two lists separately. No test finishes them in a chosen order | Partial |
| S05 | The counters and Your week share one promise (code); §6 shows Tasks reading less | Partial |
| S06–S08 | The finance service and group-workspace suites pass. Section order and one failing domain are not tested in the browser | Partial |
| S09–S10 | `projects.spec` and `project-workspace.spec` pass. A delayed media, planning or Activity section is not injected | Partial |
| S11 | `progressive-sections.spec`: two presses, one refresh, recovery | Covered |
| S12 | §6: no page reads more than the baseline | Covered |
| S13 | The recorder drops a superseded ticket (code). Not tested in the browser | Not covered |
| S14 | `progressive-sections.spec`: a failed section is not success, and its siblings render | Covered |

### Activity controller

| Case | Evidence | Status |
| --- | --- | --- |
| A01, A02 | §4, real time | Covered |
| A03–A09, A11, A12, A16 | `activity-controller.test` | Covered |
| A10 | The existing `activity-center.test` covers read, mark-all and acknowledge on the server. The panel's optimistic path is not tested in the browser | Partial |
| A13 | Per-item sequence numbers (code); A11's race test covers an older read, not an older failure | Partial |
| A14 | `context-meta.test`: answers carry the key, and a changed key discards them | Partial |
| A15 | The full Activity page's debounced, hidden-aware refresh is not tested | Not covered |

### Monitoring

| Case | Evidence | Status |
| --- | --- | --- |
| T01 | §3 and §7: primary ends only at the page's marker, never at commit or title | Partial |
| T02 | Supersede, backgrounding and 60 s timeout are in the recorder. No browser test drives them | Not covered |
| T03 | Panel `cold`/`warm` is recorded (§7). Prefetch is never reported as a hit, since none is recorded | Partial |
| T04 | Web Vitals deduplicated per metric ID (code); §7 shows one sample each | Partial |
| T05, T06 | `navigation-telemetry.test`; an unsampled document downloads no recorder (§1) | Covered |
| T07 | §7, and the unit schema | Covered |
| T08, T09, T12 | API suite | Covered |
| T10, T11 | Unit suite; §7 quantiles from summed buckets. Two instances are not scraped together | Partial |

### Combined release

| Case | Evidence | Status |
| --- | --- | --- |
| R01 | The full E2E suite, NAV-01 and NAV-02 specs included (§8) | Covered |
| R02 | §1, §5 and §6; §2 on the desktop profile. The constrained mobile timings were not run (§10) | Partial |
| R03 | Existing keyboard, mobile and reduced-motion specs pass. No screen-reader smoke test | Partial |
| R04 | Chromium's full suite with the Pixel 7 project (§8); desktop WebKit's critical flows, 33 passed. iPhone Safari and the constrained mobile timings were not run | Partial |
| R05 | 20 concurrent users on two instances: **not run** | Not covered |
| R06 | Flags off: 60 navigation, shell and workspace specs pass. Build rollback: the NAV-02 build ran on the same database throughout | Covered |

## 10. Limits and known issues

- **Dashboard's primary section misses the 10 % regression limit in sidebar
  navigations,** at +14 % and +15 % p95 (about +45 ms). React holds a
  streamed section's reveal 300 ms after the frame's placeholders, and
  STREAM-02 requires each widget to stream. Recorded as a deviation (§2,
  ADR 0014).
- **P07 deviation.** A panel whose code fails offers Reload at once, not after
  one in-page retry. The production bundler keeps a failed chunk load for the
  life of the document, so a retry could never succeed (ADR 0014).
- **The 20 % shell-JS target was missed.** The first load shrank by 0.75 %
  on Dashboard and on every required page. §1 explains why.
- **Phones do not prefetch the five approved destinations.** A tap is not
  intent, so they arrive without a prepared route and show NAV-01's pending
  mark. §2's unprepared desktop cohort shows the cost on a fast link; on the
  constrained phone profile it is not measured.
- **The constrained mobile benchmark was not run.** §2 has the desktop
  profile only. It was dropped to finish the release sooner. The spec runs it
  unchanged with `NAV_BENCH_PROFILE=mobile`.
- **The test hooks ship in the build,** as NAV-02's did. `testSectionDelay`
  sits beside the slot hook under `NESTO_TEST_SHELL_DELAYS=1`, and
  `verify:production-guards` checks both.
- **Not done in this release:**
  - R05, 20 concurrent users on two instances;
  - the constrained mobile timings (§2);
  - NAV-02's open phone item: at 320 px the top bar is 26 px too wide for a
    person with a workspace choice. NAV-02 handed it to NAV-03; it is
    unchanged and still open;
  - a live Prometheus with `promtool` (§7);
  - the cases marked Not covered in §9.
- **Series count.** The telemetry label sets fit about 2,500 histogram
  series per instance against a 4,000 budget. Adding a route family or a
  stage needs that budget checked again.

## Rollback

- **No migration.** The API changes are additions (`meta.contextKey`), and
  the NAV-02 client reads them unchanged. A build rollback is complete.
- **Runtime switches:** see ADR 0014 and the monitoring README.
  - `NESTO_INTENT_PREFETCH=off`: the approved links go back to the
    framework's default prefetch. Rehearsed in §9 R06.
  - `NESTO_NAV_TELEMETRY=off`: nothing is recorded, and batches are
    dropped.



