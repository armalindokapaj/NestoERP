# ADR 0010 — C-01: a demo user switch replaces the session

- **Status:** Accepted
- **Date:** 2026-09-19
- **Affected PRDs:** Correction PRD C-01 (Full Demo-User Impersonation & Dev
  Role Override Removal); spec §65, §66 (the sign-in picker and the old role
  switcher); PRD #6 (sessions and the context resolver); E-06 §19, §48 (the
  Platform Admin, the demo roster); D-01 §87, §92 (demo tenants read from data,
  [ADR 0005](0005-d01-armaar-demo-tenant.md))

## Context

Development had a role switcher in the top bar. It wrote the role key into a
cookie (`nesto.dev-role`), and the context resolver put that role in place of
the membership's. The context still named the same user, session, membership
and company. Only the role, the permissions and the module access changed, and
the position and grants were dropped. So a page could say "Armand Lilo" and
"Viewing as QA/QC" at once. That combination exists nowhere in the data, and
nobody could sign in and see it.

C-01 replaces this with switching the user. Choosing another demo user must
be the same as signing out and signing back in as them.

## Decisions

1. **The role is the membership's, always.** `resolveUserContext` reads no
   cookie but Auth.js's. `resolveContextForSession` has no override option,
   and `assembleContext` always works out the member's own position and
   grants. `UserContext` loses `actualRole` and `roleIsOverridden`. What is
   left is `role` and `roleLabel`, and `role` is always real (§6, §29-§33).
2. **The switch is a sign-out and a sign-in, in that order, after the target
   is validated.** `switchDemoUserAction(username)` in `lib/actions/demo.ts`,
   beside the sign-in page's one-click action:
   - Validate the target. If it fails, nothing is touched.
   - End the current `Session` row through `endOwnSession`. The row must still
     belong to the cookie's user.
   - Record `LOGOUT` with `{ switchType: "DEMO_USER_SWITCH", toUserId }`.
   - Delete the legacy cookie and clear Auth.js's own.
   - Sign the target in through the credentials provider.

   The new session, its membership and company, and the `LOGIN_SUCCESS` record
   come from the same code that serves the form (§11, §21-§25, §57). No schema
   changed (§80): `AuthEvent.metadata` already holds the switch's details.
3. **One eligibility rule for both ways in.** `resolveDemoAccountTarget` in
   `lib/auth/demo-tenants.ts` accepts only two kinds of account: a curated
   persona, or an active login of an `isDemo`, non-fixture group. Any other
   account is "unknown", whether it exists or not (§13, §60). The rule then
   checks everything the credentials check will: the account is active, it has
   somewhere to sign in to (`signInWorkspace`, now shared with
   `authenticateCredentials`), and its password is the demo password. A
   switch that passes cannot end the old session and then be refused. If
   sign-in fails anyway, the browser is sent to `/login` with its own notice.
   It is never left acting as the old user (§20, §46).
4. **One roster.** The sign-in picker and the switcher read `demoRosters()`.
   It holds each demo tenant's people read from its data, then the curated
   personas, now with each person's name (§16, §17, §41, §44).
5. **The browser loads the landing page from scratch.** The action returns
   `/dashboard`, or `/platform-admin` for a Platform Admin. The client calls
   `window.location.assign`, not a client-side navigation, so no page, router
   cache or React state of the previous user survives (§47-§49). Choosing the
   account already signed in changes nothing (§42).
6. **The switcher is a dialog, not a menu.** A demo tenant has over eighty
   logins, so the switcher is a dialog with search by name, username, title,
   role and company, grouped by roster and company. The current account is
   marked. While a switch runs, the chosen row shows as busy and every other
   row is disabled (§15, §16, §42-§45). It appears in the business top bar and
   in the Platform Admin's header, so a developer can move between the two
   (§78).
7. **The retired pieces are gone, and a test keeps them gone.**
   - Deleted: `lib/auth/dev-role.ts`, `lib/actions/dev.ts`,
     `components/layout/dev-role-switcher.tsx` and the profile page's
     override badge.
   - `isDevMode` moved to `lib/auth/dev-mode.ts` (§38).
   - `tests/architecture/no-role-override.test.ts` fails if any retired name
     returns, if "Viewing as" appears, or if the old cookie is named anywhere
     but the one place that deletes it.
   - `verify:production-guards` checks two things. The switcher is rendered
     only behind `isDevMode`. Every demo action starts with an `isDevMode`
     refusal (§59).
8. **The access debugger shows identity, not an override.** It shows:
   - the user, session and membership ids;
   - the role and position;
   - the department, assignments and grants;
   - the effective permissions (§37).

## Consequences

- To see what a Finance head sees, a developer becomes a Finance head: Edvin
  Gace in ARMAAR, or `group-finance` in the five-company demo. A role that no
  demo person holds cannot be viewed, by design (§93, §94).
- Every switch leaves a sign-out and a sign-in in the authentication log.
- The demo user switcher E2E needs a server that is in development mode. It
  runs against a production build started with `APP_ENV=development`, and
  skips on an ordinary production run, as the sign-in picker's panel always
  has.
- Company switching is unchanged: the same person and session, moved to
  another of their memberships (§10, §75).
