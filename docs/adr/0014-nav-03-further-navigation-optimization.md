# ADR 0014: NAV-03 — further navigation optimization

**Status:** accepted, 24 September 2026
**Context:** PRD NAV-03 (phase 3 of 3 of navigation performance), after NAV-01
([ADR 0012](0012-nav-01-immediate-navigation-response.md)) and NAV-02
([ADR 0013](0013-nav-02-faster-server-loading.md)).

## Context

NAV-01 made a click answer at once, and NAV-02 made the server's part cheaper.
Four costs were left, all on the client or in how a page arrived:

- **Every panel shipped with every page.** The top bar statically imported
  Search (453 lines), + Create (757), the Activity menu (381) and the
  workspace switcher (323), whether anyone opened them or not.
- **The bell polled on a remounting effect.** One effect held the first
  count, a 45-second interval, focus handling and subscriptions, with
  `open` and `tab` among its dependencies. Every open or tab change fetched
  the count again, a hidden tab kept polling, and the full Activity page
  refreshed the route on every event.
- **Links prepared everything they could see.** Next's default prefetch fired
  for every sidebar link in view on every page load.
- **Five pages waited for their slowest read.** Dashboard, Clients, Tasks,
  Finance and the project home awaited every section together, and Finance
  and the project home read in a waterfall.

There was also no way to see any of this in production: no histograms, no
browser timings, no Web Vitals.

## Decisions

1. **Panels load on demand** (`lib/navigation/panel-host.ts`,
   `components/layout/panels/`).
   - **What stays in the shell:** each trigger, its shortcut (Ctrl/Cmd+K,
     `C`), the bell's count and the workspace label. They respond before any
     panel code exists.
   - **What loads on open:** the four panel bodies. Each comes through one
     stable `import()`, held in a module-level loader.
   - **When the code fails to load:** the panel says so and offers Reload
     page, after the unsaved-changes check, and Close. PANEL-03 asks for one
     in-page retry first, but that cannot work here. Turbopack's runtime, which
     builds production, keeps a chunk's failed load for the life of the
     document, so importing it again rejects without making a request. The
     evidence run found this, and a Try again that can never succeed would
     mislead. A failure to load data still offers Try again.
   - **One overlay at a time.** Opening one panel closes another.
   - **Warming:** a 200 ms hover or 150 ms focus on a trigger may fetch its
     code, at most twice a minute.
   - **Caches:** Search Home and Activity lists live in tab memory with a
     30-second lifetime. The sessionStorage copies, which had no expiry, are
     removed on first load.
2. **One Activity controller per tab** (`lib/activity/activity-controller.ts`).
   - **Cadence:** 120 s while the bell is closed and healthy; 45 s while it is
     open or something critical or needing attention is known.
   - **Coalescing:** focus, visibility and online events within 250 ms make
     one read, and only if the last one is stale.
   - **In-flight limit:** at most one read per resource; each read has an
     8-second deadline.
   - **Errors:** backoff of 15, 30, 60 and 120 s, and Retry-After is honoured.
     401/403 suspend polling.
   - **Hidden tab:** nothing new starts. A tab that missed changes refreshes
     once on return.
   - **Mutations:** each item's changes carry a sequence number, so an older
     response or a late rollback cannot undo a newer change.
   - **Cross-tab events:** they carry an ID, and the last 50 IDs are
     remembered to drop duplicates.
   - **Tab cache:** three list snapshots, 256 KiB in all.
   - **Full Activity page:** it follows the same policy. Its route refresh
     is debounced and waits while the tab is hidden.
3. **Search and Activity answers name their context** (§12).
   - **The key:** `withMeta` adds `meta.contextKey`, built by the same
     function as the shell's key and + Create's.
   - **The check:** a panel drops an answer whose key is not the current one.
     The key is a check against showing stale data, never authorization.
   - **Compatibility:** the `data` envelope is unchanged, so an older client
     keeps working.
4. **Prefetch on intent, for five destinations only**
   (`lib/navigation/intent-prefetch.ts`).
   - **Which links:** the sidebar links to Dashboard, Projects, Clients,
     Tasks and Finance opt in with `intent`, and so do the NESTO logos in the
     sidebar and the phone header, which also lead to Dashboard. Their
     automatic prefetch is off. The logo was found during the evidence run:
     with its default prefetch it fetched Dashboard on every page load, so the
     policy never applied to Dashboard.
   - **What counts as intent:** a 150 ms mouse hover or a 100 ms focus. Touch
     is not intent.
   - **Budget:** issues are 1.5 s apart, at most four in a rolling minute,
     and a destination is not asked again within 60 s.
   - **When it stops:** it asks nothing while hidden, offline, on Save-Data or
     2g, or during a navigation or workspace switch.
   - **What it asks for:** `router.prefetch(href, { kind: "auto" })`, the
     loading boundary, as a link would. `router.prefetch` alone defaults to a
     full prefetch, a complete server render per hover. The first NAV-03
     build did that, and the loading tests caught it.
   - **Reset:** a new context key clears the scheduler's own records. It never
     claims to clear Next's router cache.
   - **Turning it off:** `NESTO_INTENT_PREFETCH=off` removes the provider, and
     the links fall back to plain navigation.
   - **Every other link keeps its default.**
5. **The workspace boundary covers history too.**
   - **When it covers:** `WorkspaceSync` covers every page as it leaves
     (`pagehide`). The copy the browser keeps for Back and Forward is
     therefore stored covered.
   - **What happens on restore:** a copy restored from that cache reloads
     instead of being shown. The reload is a plain document load, so it
     reads the session's current workspace, and nothing is replayed.
   - **Effect:** an old workspace's page is never shown under a new
     identity.
6. **Pages stream by section** (`components/modules/page-section.tsx`).
   - **What renders first:** the guard, the page title, the tabs and the
     actions.
   - **What streams:** each section awaits its own promise inside its own
     Suspense and boundary. Shared reads are started once and passed down
     as promises, so no loader runs twice.
   - **Dashboard:** `planDashboard` decides the widgets from roles, modules
     and grants, then `loadPlanned*` reads them.
   - **Finance:** `planFinanceOverview` decides visibility first, then the
     domains load in parallel. Budgets start once eligibility is known.
   - **Project home:** it loads the project, then the rest in parallel.
   - **Failures:** a failed section says so and offers Retry. Retry is one
     `router.refresh` for the whole route, however many sections ask.
     Redirects, not-found and access denial pass through untouched.
   - **Markers:** `data-section="primary"` and the section skeleton/error test
     IDs are what the browser timings and the tests read.
7. **Telemetry: sampled, bounded, enums only.**
   - **In the browser** (`PerformanceGate`, `PerformanceRecorder`,
     `lib/navigation/performance-client.ts`, `telemetry-registry.ts`):
     - 10 % of documents are sampled (`NESTO_NAV_TELEMETRY_SAMPLE`), decided
       once per document;
     - only a sampled document downloads the recorder, Web Vitals and the
       transport. It times its own load from the start while that code
       arrives. An unsampled document carries only the small gate. The
       evidence run found that shipping the recorder to every document put
       the first load above the baseline;
     - it times five stages per navigation (feedback, commit, core, primary,
       settled), panel readiness and Web Vitals;
     - it holds at most 100 events and sends batches of at most 20 events
       and 16 KiB, twice a minute plus once on hide;
     - it never retries.
   - **On the server** (`POST /api/telemetry/navigation`):
     - signed in and same origin only;
     - the body is refused past 16 KiB while it is read;
     - six batches a minute per session, plus an instance ceiling;
     - a strict zod schema, so an unknown field rejects the batch.
   - **Storage:** accepted events only move in-memory histograms and counters,
     exported by the existing protected `/api/internal/metrics`. Labels come
     from fixed lists, and the series stay within a 4,000 budget.
   - **Bell reads:** they are timed on the server (`activity_read_ms`).
   - **Monitoring:** Prometheus scrape and alert rules are in
     `ops/monitoring/navigation-nav03/`.
   - **Turning it off:** `NESTO_NAV_TELEMETRY=off` stops both recording
     and ingestion.
8. **A test hook for one slow section.**
   - **What it does:** `testSectionDelay(name)` sits beside NAV-02's slot hook
     under the same `NESTO_TEST_SHELL_DELAYS=1` gate. A cookie rule delays or
     fails one page section.
   - **Guard:** `verify:production-guards` checks both hooks return first
     unless the variable is set.

## Consequences

- **Less code on first load, but not as much as the target.** The panels
  leave the first page load, but much of their weight was shared UI code that
  stays. See the evidence for the measured sizes.
- **The bell costs a third as much while idle.** A healthy, closed bell reads
  about six counts in ten minutes instead of fifteen, and nothing while
  hidden.
- **On phones, the five approved links no longer prefetch when the drawer
  opens.** A tap shows NAV-01's pending mark until the response arrives.
- **Streaming shows loading placeholders in the page's geometry.** A section's
  failure is visible in place instead of failing the page.
- **A streamed section waits for React's reveal hold.** React shows a
  resolved section no sooner than 300 ms after placeholders were last shown.
  When the frame is drawn before its sections, as in an unprepared
  navigation, a section lands about 300 ms after the frame. On Dashboard
  that puts the first widget about 45 ms later at p95 than the baseline in a
  sidebar navigation, over the 10 % limit. Drawing the first widget with the
  frame would break STREAM-02, so this is a recorded deviation.
- **Telemetry adds client code** within the 5 KiB budget. It does nothing in
  an unsampled document.

## Rollback

- **By build:** every change is client, page composition or additive API
  metadata. There is no migration, so a build rollback is complete.
- **By setting:**
  - `NESTO_INTENT_PREFETCH=off` stops intent prefetch;
  - `NESTO_NAV_TELEMETRY=off` stops recording and ingestion;
  - `NESTO_NAV_TELEMETRY_SAMPLE=0` stops recording only.
- **Streaming and lazy panels** have no runtime switch, by design: shipping
  the old implementations beside them would put the panel code back in the
  first load (PRD §19).
