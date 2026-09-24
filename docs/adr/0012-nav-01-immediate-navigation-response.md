# ADR 0012 — Immediate navigation response: streamed routes, pre-stream status contracts, lazy Quick Create

- **Status:** Accepted
- **Date:** 2026-09-23
- **Affected PRDs:** NESTO V0.1 Immediate Navigation Response PRD NAV-01
  (§-numbers below are its); PRD #5 §128 (no permission flashing, and the
  dashboard as the only loading boundary — superseded here); the Quick Create
  PRD (the `+ Create` menu and its launch); Workspace Context
  ([ADR 0011](0011-workspace-context.md): the switch and its cross-tab event)

## Context

A click in NESTO painted nothing until the whole destination had rendered on
the server. The only `loading.tsx` was the dashboard's, so every other route
held the old page — sidebar highlight, URL and content — for as long as its
slowest query took. On top of that, `+ Create` fetched its menu in an effect on
every route change, whether or not anybody opened it.

NAV-01 is phase 1 of 3. It asks for feedback that arrives before the data,
for a Quick Create that loads only when opened, and for both without weakening
any authorization answer.

## Decisions

1. **One authenticated loading boundary beside the shell's layout, and module
   and record boundaries below it.** `app/(nesto)/loading.tsx` wraps every
   authenticated page, but not `app/(nesto)/layout.tsx` in the same segment. So
   sign-in, the session's workspace and maintenance are still settled before a
   byte is sent. 45 more boundaries give the modules and the record journeys
   named in §6 their own shapes. The shapes come from one file,
   `components/layout/page-skeletons.tsx`: server components that read no
   data, announce once through a visually hidden status and mark the shapes
   `aria-hidden`. `scripts/navigation/route-inventory.ts` lists every page and
   its nearest boundary. A unit test fails when a page has none.

   This supersedes PRD #5 §128's rule that the dashboard is the only boundary.
   The rule existed to prevent permission flashing. It still holds: a skeleton
   renders no protected data, and every page checks access before it renders
   any.

2. **The streaming contract (§2.1): a streamed 200 is not evidence of access.**
   Once a boundary exists, the HTTP status is fixed when React flushes the
   shell. A `notFound()` or `redirect()` thrown below the boundary after that
   point still reaches the browser, as a streamed not-found screen or a
   client-side redirect. The document's status, however, stays 200. For
   ordinary pages we accept that. The page, its services and every mutation
   still check access, nothing protected renders before the check, and API
   routes keep their real status codes.

3. **Routes with a documented status keep it: pre-stream guards.** Ten routes
   have E2E specs that assert a real 404 on the document. Measured on a
   production build, the global boundary turned them into 200s. The tenth,
   `/qaqc/inspections/[inspectionId]`, was found by the full E2E run, because
   its assertion sits inside a boolean expression.
   `app/(nesto)/pre-stream-routes.ts` lists them, and
   `app/(nesto)/pre-stream-guards.ts` maps each to its own loader.
   The (nesto) layout reads the middleware-set request path, runs that one
   guard in parallel with the maintenance check, and throws before streaming.
   The loaders are wrapped in React `cache()`, so the page reuses the answer
   rather than asking twice. Static sibling pages such as `/clients/new` are
   excluded by name, and a test fails when a new sibling directory appears
   without being listed. Adding a route to the list adds a status contract, so
   the list stays short.

   Two consequences:
   - A layout-level `notFound()` renders the **root** not-found page, with no
     shell, on a hard load. Client-side navigation does not re-render the
     layout, so it keeps the in-shell not-found.
   - The root not-found page's links are plain `<a>` elements. A soft
     navigation away from Next's error payload left the not-found tree on
     screen.

4. **Errors are recovered inside the shell.** `app/(nesto)/error.tsx` keeps
   the sidebar and top bar, offers a retry (`router.refresh()` then `reset()`
   in one transition) and a way back to the dashboard. It also clears any
   navigation ticket still pending.

5. **Feedback belongs to the navigation that the app accepted.**
   `lib/navigation/feedback-store.ts` is a pure store of one ticket at a time:
   the destination, its source and when it started. A route commit, a failure
   or a newer navigation settles it. After 10 s it shows a "taking longer"
   message.
   - `components/navigation/nav-link.tsx` is a drop-in `next/link`. Link's
     `onNavigate` fires only for navigations the app accepted, never for a
     modified click, a new tab or a cancelled one. The link opens the ticket
     there and settles it from `useLinkStatus`. It replaced `next/link` in 343
     files. Marketing, Platform Admin and the platform 3D pages keep
     `next/link`; they are outside the shell.
   - Programmatic navigation goes through `useFeedbackRouter()`. It pushes
     inside a transition and settles the ticket when the transition ends. The
     record navigation, company-record links, the Activity Center, search and
     list toolbars use it.
   - The shell draws a thin top bar that fades in after 150 ms, marks the
     pending sidebar item or tab with a dot, and exposes a single `role=status`
     line. Reduced motion stops the animation but keeps the marks.

6. **Quick Create: the shell decides whether it exists, and the menu loads on
   open.**
   - `WorkspacesDTO.quickCreate = { canOpen, contextKey }` is computed from the
     contexts that `listWorkspaces` already resolved: zero added queries,
     enforced by an architecture test.
   - The eligibility rule the menu uses (`eligibility.ts`) is the one the
     button and the `C` shortcut use, so they never disagree.
   - `contextKey` is a truncated SHA-256 of the session, the user, the
     workspace and each candidate company's membership and actions. It never
     contains the session id itself. The additive `contextKey` on
     `/api/quick-create/actions` lets the client refuse a menu drawn for
     another context.
   - The client cache (`menu-cache.ts`) keeps a menu for 30 s, holds 10 keys,
     joins repeated opens to one request, never stores a failure and fences
     every answer by generation. A cancel, a context change or a newer open
     drops a late answer.
   - A closed menu makes no requests at all.

7. **A tab that switches its workspace goes on to the destination itself.**
   A switch broadcasts `WORKSPACE_CHANGED` on a BroadcastChannel, so other tabs
   reload. That channel also delivers to the sending tab's own
   `WorkspaceSync`, which reloaded the page being left. The reload raced the
   caller's `router.replace`, and the old page usually won:
   - a Quick Create launch into a company landed on `/dashboard` instead of
     the create form;
   - a record opened from a Group list reloaded the list, measured on a
     production build.

   The switcher had the same race whenever the server's destination differed
   from the current page.

   The fix:
   - `requestWorkspaceSwitch` accepts `echoToThisTab: false`. Each tab has a
     `WORKSPACE_TAB_ID`, and `WorkspaceSync` ignores its own non-echo
     messages. `publish()` still dispatches `WORKSPACE_CHANGED` in the tab
     itself, so local listeners hear the switch exactly once.
   - Every caller that switches and then navigates calls
     `openInSwitchedWorkspace(destination)`, which loads the destination as a
     new document. Those callers are the switcher, the Quick Create launch,
     `CompanyRecordLink`, `ChooseCompany`, `useOpenRecord`, `EnterCompany`,
     cross-workspace record history, and the workspace breadcrumb. A document
     load keeps Workspace Context §29/§93: nothing of the old workspace, and no
     client cache, survives under the new header.
   - The in-app unsaved-changes question has already been answered for that
     action, so the forms that take part in it skip their `beforeunload`
     prompt while `isLeavingForWorkspaceSwitch()` is true. That keeps it to
     one prompt per action (NAV-05).
   - An unanswered switch request is reported as `ambiguous`, because it may
     have committed. The launch then drops the cached menus and reloads to
     read the canonical workspace rather than guessing.

8. **A beat wakes navigations that the framework leaves waiting.** On this
   Next.js 15.5 (bundled React 19.2 canary), loading boundaries expose
   [vercel/next.js#86151](https://github.com/vercel/next.js/issues/86151). A
   soft navigation sometimes has its page from the server and never shows it,
   until some unrelated update reaches React's root.

   Measured on a production build:
   - the HR attendance, compensation and organization report tabs, which are
     query-only navigations to pages of many rows, held the old page for
     10–44 s;
   - a plain `router.push` hung the same way;
   - the pre-NAV-01 tree with two plain `loading.tsx` files added was enough
     to reproduce it;
   - the navigation's own response had finished in under a second.

   The E2E failures that stayed on a skeleton (people tabs, department pages)
   are the same bug.

   `components/navigation/reveal-watchdog.tsx` works around it. Any update
   that reaches the root makes React retry the waiting render, so a component
   that draws nothing re-renders itself at the moments a stall can be ended:
   - a few times in the 600 ms after each server-component response lands
     (`_rsc=` in the browser's resource timing), which covers every navigation,
     a component's own `router.push` included;
   - every 250 ms while the shell has a navigation pending or a skeleton is on
     screen, as the fallback.

   Nothing beats while nothing loads. Remove it with the upgrade that fixes the
   bug.

## Consequences

- **E2E locators must be scoped to `#nesto-main`.** Almost every page now
  streams, and on a document load React sometimes client-renders a boundary
  whose content has arrived but is still queued for reveal. For a moment the
  server's copy then stays in a hidden `div#S:n` at the end of `<body>`, and
  Playwright's strict mode sees two copies. Role locators skip hidden elements;
  test-id, CSS and text locators don't.

  The rate was measured with the same probe on eight pages, 32 document loads
  each:

  | Build | Loads with a streaming duplicate |
  | --- | --- |
  | Pre-NAV-01 | 0/32 |
  | Pre-NAV-01 plus two plain `loading.tsx` | 10/32 |
  | This change | 9/32 |

  So it comes with streaming boundaries in this Next.js version, not with the
  new shell code. Making the sidebar's and record history's context values
  stable did not change the rate, so those changes were not kept.

  The copy is an orphan once its boundary's `B:n` placeholder is gone, and
  React's reveal script would only delete it. So `signIn` in
  `tests/e2e/fixtures.ts` installs `dropOrphanedStreamSegments`, which deletes
  it at once. With it, the same probe sees 0/32. `mainRegion(page)` stays the
  convention for page content. Dialogs render outside the main region and
  don't need it.
- A hard load of a denied record on one of the ten routes shows the bare
  root not-found page rather than the shell.
- Routes outside the ten may answer 200 to a document request for a record
  that does not exist, and show the not-found screen in the stream. That is
  intended. Tests that need a status assert on the API.
- **A skeleton, once shown, holds its content for about 300 ms.** React
  reveals a Suspense boundary's content no sooner than 300 ms after the last
  fallback appeared (`FALLBACK_THROTTLE_MS` in the bundled React 19.2). A
  prefetched `loading.tsx` commits its skeleton at once, so a warm transition
  to a fast page shows content at about 310 ms, where it used to show it at
  120–230 ms. Feedback, meanwhile, is immediate.
  - The constant lives in Next.js's bundled React, and the PRD rules out
    patching Next.js internals.
  - The product owner accepted this as a recorded deviation (release evidence
    §3).
  - NAV-03's selective full prefetch, or a React release without the hold,
    is the way out.
- Parent-layout waits are unchanged. The (nesto) layout and the shell still
  resolve the user, maintenance, navigation, announcements, the organization
  and the workspaces before the boundary can show,
  so cold entry and workspace switches wait for them. Measurements are in
  `docs/navigation/NAV-01-release-evidence.md`. Parallelizing and caching them
  is phase 2.
- Rollback is a revert. There is no migration, and the additive `contextKey`
  field is ignored by older clients.
