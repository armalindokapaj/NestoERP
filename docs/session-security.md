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
