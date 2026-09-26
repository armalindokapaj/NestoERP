# ADR 0018: One unsaved-work contract for every editor

**Status:** accepted, 26 September 2026
**Context:** AUD-03 Unsaved Work Protection ("AUD-03" below; §-numbers are its
own), after NAV-01 (the workspace switch's question), OW (the in-place switch)
and AUD-02 (task versions). The contract for developers is
[unsaved-work.md](../unsaved-work.md); the coverage is
[unsaved-work-manifest.md](../unsaved-work-manifest.md).

## Context

Protection was one module-level boolean in `lib/workspace/client.ts`. Four
editors wrote it — RecordForm, ClientForm, ProjectForm and TimesheetWeek — and
the last writer won: one form unmounting cleared another's flag. It was read by
the workspace switch and the breadcrumbs, but not by sidebar links, search,
the bell, browser Back, dialogs, sign-out or the demo user switch. The flag was
sticky (any `change` event), blind to rows added without one, and cleared by a
successful switch. Every editor with a dialog, a grid, a composer or its own
submit had nothing at all. Save outcomes were inferred: most form actions
ended in `redirect()`, which in Next 15.5 moves the router before the client
promise settles, so a form could not tell a commit from a thrown request.

## Decisions

1. **A tab-local coordinator with a registry, not a flag** (`lib/unsaved/coordinator.ts`).
   Each editor registers under `useId()` with a mount token, so React Strict
   Mode's double effects and one editor's unmount never touch another. An entry
   holds a label, flags (dirty, saving, pending uploads, unresolved outcome), a
   revision counter and adapters (save, focus, sync). No business values.

2. **Every departure is an intent, and asks first.** navigate, history,
   dismiss(scope), workspace, identity, reload. Dialog scopes make a dialog's
   close concern only the editors inside it; shell-mounted editors survive a
   route change. One prompt at a time: a second request while one is open is
   refused, never queued or allowed to replace the destination.

3. **Approvals are one-shot objects, not a flag.** `requestDeparture` answers an
   `Approval` bound to the approved editors' revisions and the signed-in
   identity. `run(continuation)` executes once; a new edit, a newly dirty
   editor or another identity voids it. `requestWorkspaceSwitch`'s
   `confirmed: true` is gone; it takes an approval, or asks. A later step of
   the same flow (Quick Create's company switch) passes the earlier approval as
   `prior` and is not asked twice about the same unchanged editors.

4. **Dirtiness is what the form would submit.** `useFormDirty` compares per
   field the values `FormData` would carry — exact strings, file name/size/time,
   checkbox presence, order — against a baseline taken after load. Until the
   first trusted gesture, changes are loading and move the baseline; after it, a
   change counts when it follows a gesture (a custom control writing a hidden
   input), and a change arriving on its own (a refresh) moves the baseline only
   of fields the person has not edited. A `MutationObserver` catches rows and
   hidden inputs; `sync()` does a full comparison before every decision. The
   baseline moves only after a committed save.

5. **Only a committed answer is a save.** Editor actions return
   `committed(href)` instead of redirecting; the form navigates itself — to that
   destination after an ordinary save, to the person's destination after Save
   and continue. `outcomeOf` separates committed, invalid, decision (a duplicate
   warning), conflict, refused, failed and unknown. A thrown request is
   *unknown*, never "failed", and marks the editor unresolved until a definite
   answer; the prompt then offers Stay or Leave anyway, never an automatic
   retry. The editor is disabled while its snapshot saves (`<fieldset
   disabled>`), and a submit lock allows one request per snapshot.

6. **Save and continue is the editor's own save.** Same validation,
   authorization, duplicate checks; a refusal cancels the departure and focuses
   the first invalid field once the prompt has closed. Editors whose only way
   forward is a workflow step register `saveKind: "none"` with the step's name:
   the prompt never sends, submits or approves.

7. **Links and routers ask at the boundary.** `NavLink` asks in `onNavigate`,
   which Next calls only for navigations it accepted — so modified and middle
   clicks, downloads and new tabs open as before, and prefetch never asks. The
   `useRouter` of `next/navigation` is replaced by a drop-in guarded one in
   every client component; `refresh()` is not guarded because it keeps the page
   and its values.

8. **Back/Forward by reconciliation.** `popstate` cannot be cancelled. A
   capture-phase listener runs before Next's bubble listener and stops it, so
   the router never renders the other page and the editor never unmounts; the
   guard then walks history back by the distance the Navigation API's
   `currentEntry.index` measured, and asks. Stay leaves URL and page as they
   were; Discard or a committed save replays the traversal once, allowed
   through. No state is written into `history.state` (Next owns it), no dummy
   entries are pushed.

9. **The server refuses a stale tab's write.** The host adds
   `x-nesto-workspace: <the workspace the tab renders>` to same-origin
   state-changing requests — the app's fetches and Next's server-action POSTs
   alike. `withContext` answers 409 `WORKSPACE_CHANGED`; `requireCompanyContext`
   throws an error whose `digest` (`NESTO_WORKSPACE_CHANGED`) survives Next's
   production sanitising, so the form reports a definite refusal. The header
   only ever makes a request fail; without it nothing changes.

10. **Context changes hold writes instead of reloading drafts away.** Another
    tab's switch reloads a clean tab as before; a tab with unsaved work is
    frozen with a notice — Return to the workspace this tab shows (a switch back
    that can only go there) or Discard and switch. A restore from the
    back/forward cache and, without `BroadcastChannel`, a return to the tab
    re-read `/api/workspace/context` before anything is written. Sign-out and
    the demo user switch ask before the identity changes; other tabs hear
    "signed-out" and "present" on an identity channel. Another person signing in
    reloads a tab at once (security over recovery); the same person signing in
    again lifts the hold after a re-read.

11. **One `beforeunload`, attached only while something would be lost**, and
    standing aside for an approved departure. No saving from unload handlers.

12. **No new storage.** Drafts stay in the mounted editor. Telemetry carries the
    guard event, departure kind, module and duration — never a value, title or
    attachment name.

## Alternatives rejected

- **A document-wide click listener** (the PRD rules it out): it cannot see
  programmatic navigation and fires after Next has decided.
- **Pushing a sentinel history entry while dirty**: it traps people, and
  accumulates entries Next does not know about.
- **Keeping `redirect()` and inferring success from the thrown redirect**: the
  router is already on its way to the module's destination, so Save and
  continue could not go where the person asked.
- **Checking the workspace in middleware**: it has no database, and a refused
  server action there cannot be told apart from a network error.

## Consequences and limitations

- Every editor must register; the manifest records each one or its exclusion.
- A Cancel that calls `setOpen(false)` directly bypasses a dialog's guard: use
  `DialogClose` or `useDialogClose()`.
- Where the Navigation API is missing the Back/Forward guard stands aside and the
  native unload prompt is all there is (all three supported engines have it:
  Chromium 153, Firefox 155, WebKit 26.6).
- Browsers decide whether `beforeunload` fires: mobile app switching, a killed
  process, or a crash lose the draft; cross-document Back follows native exit
  behaviour. A session that expires under a save redirects the server action to
  sign-in, which cannot be held — forced logout outranks the draft.
- Platform administration mounts the host without a workspace: its editors get
  the prompt, the unload guard and the identity channel, and no stale-workspace
  header. Anywhere no host is mounted, a departure falls back to the browser's
  own `confirm`.
- A dismissal (a dialog's close, an inline Cancel) never opens the leaving
  window: the page stays, so every other editor on it stays protected.
  Only a departure that carries the page away holds the guards aside.
- A download is a navigation to the browser, which asks `beforeunload` before
  it knows the answer is an attachment. `startDownload` lets that one request
  through for three seconds; download grants are always attachments.
- The browser-level Back/Forward guard and the bfcache restore cannot be
  driven by Playwright's Chromium beyond what the acceptance suite covers; the
  bfcache path is a manual check (release readiness §42).
