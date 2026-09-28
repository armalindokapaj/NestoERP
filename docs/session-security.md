# Session security

What a session is, how long it lasts, and what ends it. PRD #50 §32-§54,
§222, §252.

## The cookie is a pointer; the row is the authority

Auth.js is configured with `strategy: "jwt"`, so the cookie is a signed token —
but what it carries is deliberately minimal: the user id, the username, and a
**session id**. No role, no company, no permissions.

Everything that decides access is read from the `sessions` row and the rows it
points at, on the request. That is the property the rest of this document
depends on: **revocation is immediate**. Deleting the session row ends the
session on the very next request, even though the signed cookie in the
browser is still cryptographically valid and will remain so until it expires.
A cookie carrying claims would have to be waited out instead.

It also means a tampered or stale cookie cannot widen access: the worst it can
name is a session id, and a session id that no longer resolves is no session.

Sessions last eight hours — one working day (`SESSION_TTL_MS`).

## What ends a session

| Event | Effect |
|---|---|
| Sign out | That session's row is deleted. |
| Sign out everywhere | Every row for the user is deleted. |
| Password change | Every other session goes; the one making the change stays. |
| Administrator password reset | Every session goes, including the holder's. |
| Member deactivated or suspended | Refused on the very next request. |
| User suspended | Refused on the very next request. |
| Company suspended | Refused on the very next request. |
| Expiry | The row is past `expiresAt` and resolves to nothing. |

The last four do not wait for the session row to be removed. The context
resolver reads the membership, the user and the company on **every** request,
so a status changed between two requests shows on the second one. That is
verified from the outside in `tests/security/session-lifecycle.test.ts`, which
changes status mid-flight and asserts the next call is refused.

## Revalidation on every request

There is no cached session context. Each request resolves: session row →
user → membership → company → role → permissions → module access. It costs a
query and buys the property above — no window in which revoked access still
works.

## Cookies

Auth.js's own cookie defaults apply: `httpOnly` so script cannot read it,
`secure` when served over HTTPS, and `sameSite=lax` so it does not ride along
on cross-site requests. NESTO adds nothing to the cookie beyond the three
fields above.

## Caching

Every `/api/*` response is sent `private, no-store, max-age=0`
(`next.config.ts`), so nothing authenticated is held by a shared proxy or
replayed from a browser cache after sign-out.

## What is not implemented

Concurrent-session limits, device inventory beyond what the sessions list
shows, and session binding to an IP or user agent. A changing address is
normal — mobile networks, VPNs, office WiFi — and refusing on it would sign
honest people out all day for no attacker cost.

## Deterministic authentication lifecycle

`lib/auth/client-lifecycle.ts` owns browser logout. Account menus, standalone
sign-out buttons, current-session settings actions and 3D controls use it.
`POST /api/auth/lifecycle` validates the request origin and invokes
`endSessionAction`, which revokes the signed cookie's own session without
resolving any membership, company, project or role. Cookie removal runs even
when revocation fails. Auth.js's built-in sign-out event also revokes the row.

The browser immediately clears its context, application caches and NESTO
storage, cancels tracked same-origin requests, covers the old document, and
announces logout through BroadcastChannel and a storage event. A full
`location.replace` drops React state and the router cache. The request has a
five-second timeout; failure never leaves the user in the application.
A non-credential `nesto.signed-out` denial cookie prevents the old browser
cookie from reopening protected routes after an offline logout. Only a
successful sign-in removes this marker. JavaScript cannot erase HttpOnly
cookies or revoke an unreachable server's session: if the request never
reaches the server, a previously copied credential remains subject to the
original server-enforced eight-hour deadline.

`SessionLifecycle`, mounted above all layouts, checks an uncached server
endpoint on entry, focus, reconnect and at most once per minute. Its expiry
schedule uses the server's remaining duration, not the device's clock.
Protected fetch responses with status 401 trigger the same expiry handling.
The server checks the fixed `expiresAt` independently on every protected
request; checking a session never extends it. Protected HTML is `no-store`,
and history restores are covered until a fresh server load validates access.

Expiration preserves registered unsaved editors only in the existing masked,
write-blocked in-memory reauthentication flow. The same person may sign in
again in another tab and resume after context revalidation. Manual logout
and changing users discard the old state. The standalone Experience Editor
now participates in this guard. No draft or authenticated response is saved
to persistent storage for reauthentication.

The additive migration `20260928090000_authentication_lifecycle` adds
`SESSION_EXPIRED`, `SESSION_REVOKED`, `IMPERSONATION_STARTED`,
`IMPERSONATION_ENDED` and `USER_SWITCHED` audit types. Expired rows are
conditionally removed so concurrent requests record expiration once. Revocations
and per-session audit events commit in the same transaction, including bulk
and administrator revocations; rolling back an account change also rolls back
its revocation audit. Demo
switching uses fresh authentication rather than layered role overrides.

Regression coverage lives in `tests/unit/auth/*lifecycle*`,
`tests/unit/auth/logout.test.ts`, `tests/unit/auth/session-timing.test.ts`,
`tests/integration/auth/work-session.test.ts` and
`tests/e2e/auth/work-session.spec.ts`. The browser suite can use the ARMAAR
seed with `E2E_AUTH_TENANT=armaar`; its default uses the standard demo seed.
The independent integration suite creates and removes its own platform user.


### PRD regression map

| Required scenarios | Coverage |
|---|---|
| 1–8: role, group, platform and demo logout | Browser role matrix, mobile check and demo switch/logout |
| 9–11, 27–28: switching, switch-back, new sessions and isolation | Browser impersonation/cache tests and demo-switch integration suite |
| 12–15: nested routes, 3D, Finance and in-flight requests | Browser route, disposable 3D fixture and pending-fetch tests |
| 16–17: duplicate logout and network failure | Client unit tests and failed-request browser test |
| 18–22: history, refresh, replay and multiple tabs | Browser role matrix and BroadcastChannel/storage-event checks |
| 23–26: absolute eight-hour expiry and API/client enforcement | Timing units, real-database session integration and cross-tab browser expiry |
| Unsaved work and audit consistency | Browser reauthentication test; transaction rollback, bulk and concurrent-revocation integration tests |

Targeted commands:

```sh
pnpm exec vitest run tests/unit/auth tests/unit/permissions/route-access.test.ts tests/integration/auth/work-session.test.ts tests/integration/auth/demo-user-switch.test.ts
E2E_AUTH_TENANT=armaar pnpm exec playwright test tests/e2e/auth/work-session.spec.ts --project=chromium
```
