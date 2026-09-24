# ADR 0013: NAV-02 — faster server loading

**Status:** accepted, 24 September 2026
**Context:** PRD NAV-02 (phase 2 of 3 of navigation performance), after NAV-01 ([ADR 0012](0012-nav-01-immediate-navigation-response.md)).

## Context

NAV-01 made a click answer at once. What was left was the server work behind
it: a document load, a workspace switch and every API call.

**Before NAV-02** (release evidence §1):
- **One request read the same access data again and again.** The context,
  then the group's company contexts for the chooser, the bell or search. Each
  time it read the person's organization access (grants, department
  assignments) and the company's modules afresh: two to four times per request.
- **The shell awaited everything together** before drawing anything: the
  navigation, the full workspace chooser, the critical banner with an unread
  COUNT it never displayed, and the development access panel.
- **Maintenance was read after authentication,** outside the API error
  translation, on every page and every call.
- **Route handlers had no reuse at all,** because React's `cache` does nothing
  outside a render. `/api/search/home` resolved the person's access four times.

## Decisions

1. **A request scope** (`lib/core/observability/request-scope.ts`).
   - **What it keeps:** a promise per key for one request, cached before it is
     awaited. Concurrent callers join it, and a failure is shared for that
     request only.
   - **Where it comes from:**
     - route handlers, platform handlers, job attempts and notification rows
       get one through AsyncLocalStorage (`withContext`,
       `withPlatformContext`, the job runner);
     - a server render gets one from React's `cache`;
     - anything else reads fresh.
   - **Detection:** there is no API that says whether `cache` is live, so the
     scope asks for its render scope twice. Only a live render hands back the
     same object.
   - **Keys:** every primitive the answer depends on: `org:{group}:{user}`,
     `modules:{company}`, `group-contexts:{group}:{user}:{session}`,
     `user-context`, `productivity-settings:{company}`, and
     `maintenance:fresh`.
   - **Location:** it lives in `core/observability` rather than `context`
     because the ownership gate forbids a `core/jobs → context` cycle.
2. **Reuse without new rules.**
   - The session resolver's organization access and module set are the ones
     `loadGroupMemberContexts` reads; its module batch covers only the
     companies the request has not already resolved.
   - `assembleContext` is unchanged. An integration test compares the group's
     contexts with and without a scope for three roles, and they are equal
     (C14).
3. **Invalidate after commit.**
   - The request forgets what it read after these writes: a workspace switch,
     grants and assignments, member role and status changes, module toggles,
     and productivity settings.
   - The next request always starts empty. There is no cross-request cache of
     access anywhere (CACHE-05).
4. **A shell core, then slots.**
   - **`ShellCoreDTO`** holds the context key, the active workspace's label,
     whether a workspace choice exists, + Create's summary, and Group entry.
     It is built from the session and, in the Group view, from the group
     contexts that Group navigation needs anyway. It costs one count query.
   - **`AppShell`** awaits only that core and the navigation. The chooser, the
     banner and the development panel are started as promises and read in
     their own slots.
   - **A client host** (`components/layout/shell-slots.tsx`) settles each
     slot's promise after hydration and owns each slot's generation and
     context key. A Retry replaces the promise the slot reads, so a late
     first answer cannot publish over it.
   - **Nothing suspends.** The first version wrapped each slot in its own
     Suspense boundary, and it made the slowest document loads slower (+13 to
     +20 % at p95 on the phone profile). React reveals server-rendered
     boundaries in batches, so a slot that resolved first held the page's
     content back to the next batch. No slot is usable before hydration
     anyway, so the host now settles the slots only after hydration.
   - **Group entry** is published from the chooser's answer, not suspended
     on, so record navigation is never blocked or remounted.
5. **A banner-only announcement read.** `criticalAnnouncementBanner` has no
   COUNT and a `publishedAt desc, id desc` order; `announcementShellState` is
   gone.
6. **Two maintenance paths.**
   - **Enforcement** reads the database per request: APIs, sign-in, uploads,
     3D and the platform.
   - **Pages** use a per-process snapshot for at most five seconds from the
     start of its read, on the monotonic clock.
   - **Snapshot rules:**
     - one read is in flight per generation;
     - a read that a committed change overtook is discarded;
     - a late read cannot refill the snapshot, and failures are never cached;
     - an "enabled" snapshot is confirmed live before a redirect, so
       instances that disagree cannot bounce a page;
     - `NESTO_MAINTENANCE_PAGE_CACHE=off` bypasses the snapshot.
   - **Saves:** `saveMaintenanceSetting` invalidates after commit and reports
     `pageRefresh: complete | pending`.
7. **One per process, not one per module copy.**
   - A production Next.js server loads a module once for its pages and again
     for its route handlers. Kept in module scope, each copy had its own:
     - Prisma client, so one server held two connection pools (43
       connections against 21);
     - cache store;
     - metric counters;
     - request-scope storage;
     - maintenance snapshot.
   - All five now live on `globalThis`.

## Consequences

- **Where the gains land:** document loads, workspace switches and API calls.
  - Soft navigation and prefetch never ran the `(nesto)` layout or the shell on
    the server; they pay only the page's own context resolution.
  - That resolution is 12 physical statements, 7 of them Prisma's split of one
    nested `include`. It is recorded as a residual for later work, not changed
    here.
- **People with one workspace see no switcher, as before.** People with a
  choice see their workspace's name in the switcher's own box until it
  arrives.
- **The banner's height is reserved** in place of the main area's top padding,
  so a page's content starts 45 px below the bar at every width, where it was
  24 or 32 px.
- **A streamed document's `load` event** fires after its last slot. Tests that
  look at a pending state wait for `commit`, not `load`.
- **The slot test hook** (`NESTO_TEST_SHELL_DELAYS`, a cookie) exists in the
  production build. It is inert unless that variable is set at start, and
  `verify:production-guards` checks the guard and that no deployment sets it.
- **Rollback:**
  - Revert the NAV-02 commits. There is no migration.
  - `ok` stays in the maintenance save response for older callers.
  - `NESTO_MAINTENANCE_PAGE_CACHE=off` switches the page snapshot off without a
    deploy.
