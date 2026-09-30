# Mobile routing, context and back (MOB-02)

## Same routes

There are no `/mobile/*` routes. `/projects/{id}/units/{id}` is the same URL on
a phone, a tablet and a desktop; only the shell around it differs. Shared links,
email links and future push, Universal Links and App Links all land on the
canonical page.

## Back

The breadcrumb bar shows `‹ parent   current` on phones. Back uses the tab's
record history when there is one and otherwise the nearest parent route, so a
deep link never strands the person. The system back gesture is the browser's
own history; nothing keeps a separate stack. Dirty-form protection applies to
every path: bar links, More, the workspace sheet, the header search results,
sign-out and browser back all go through the same `unsaved` coordinator.

## Deep links and denied access

Authorisation is decided on the server for the requested URL. A person without
access gets the canonical denied response before any of the page renders, and a
module switched off for the company is refused the same way. The navigation
only hides links; it is never the guard.

## Workspace switching

The context header opens the existing workspace sheet. A switch validates
access on the server, keeps the route when it exists in the target workspace
and falls back safely when it does not (the record is not there, or the module
is off), then re-renders the shell, so navigation, More, Create and search
scope all follow the new workspace. Stale pages are keyed by workspace and
remount. Client presentation state (More open, search open) is not persisted.

## Loading and errors

The shell is persistent: header, bar and breadcrumb stay while the content shows
its skeleton or error. Navigation acknowledges a tap at once (pending dot and
progress bar) and ignores duplicate activation. Scroll goes to the top on a new
destination and Next restores it on back.

## Demo impersonation

Switching demo user is logout plus login, so identity, permissions,
memberships, navigation, More, Create and dashboard are all the target user's.
The dev switcher sits at the foot of More below `sm`.
