# Authorization model

Per PRD #47. This is the contract every request in NESTO follows, and the place
to look before adding an endpoint, a service or a provider.

One sentence: **a request is authorized when an authenticated session resolves
to an active member of an active company, the module is on, the permission is
held, the scope reaches the record, and the record's state allows the action.**
Anything missing denies. The frontend is not part of this — hiding a button is
courtesy, not security (PRD #47 §110, §276).

```text
REQUEST → SESSION → USER CONTEXT → ACTIVE MEMBER → ACTIVE COMPANY
        → MODULE ENABLED → PERMISSION → DATA SCOPE → RECORD ACCESS
        → STATE GUARD → DOMAIN SERVICE → AUTHORIZED RESULT
```

## 1. UserContext

`lib/context/types.ts`. The one resolved identity: `userId`, `companyId`,
`membershipId`, `sessionId`, `role`, `permissions`, `moduleAccess`,
`enabledModules`, plus display fields.

It is built in exactly one place — `resolveContextForSession` in
`lib/context/build-context.ts` — from the session row, the membership, the
company, the role and the company's module configuration. Never from a request
body, a query parameter or a cookie carrying a role (PRD #47 §10).

Two entry points, and nothing else builds a context:

| Caller | Entry point |
|---|---|
| API route | `withContext(handler)` — `lib/api/respond.ts` |
| Server component / server action | `requireUserContext()`, `requireModule()`, `requirePermission()` — `lib/context/current-user.ts` |
| Another person's access (mentions, recipients, reviewers) | `buildMemberContext(s)` — `lib/context/member-context.ts` |
| Background work | `SystemContext` — `lib/core/jobs/system-context.ts` |

**Where this differs from the PRD's sketch (§9), and why.** The field is
`membershipId`, not `memberId`, because that is what the whole codebase already
calls it. `permissions` is an array rather than a `Set` — it is serialized to
the client by `/api/me`. There is no `isCompanyActive` or `isMemberActive`
flag: an inactive user, membership or company produces **no context at all**
(`ContextFailure`), so no caller can forget to check the flag.

### Freshness, revocation, and why there is no permission cache

Every request re-reads session → user → membership → company from the database
(`build-context.ts`). A suspended member, a suspended company, a revoked
session or a changed role takes effect on the **next request**, with no window
(PRD #47 §128-§130, §212, §213). Permissions are derived from the role's
configuration (`config/role-defaults.ts`) at request time, so there is nothing
to invalidate and no `accessVersion` to maintain (§126, §127). If a cache is
ever introduced here, it needs the invalidation story that this design avoids.

**The commit boundary (AUD-06 §7, RP-16).** "The next request" leaves one
window: a request that resolved its context, decided, and is still writing
when the revocation commits. Two mechanisms close it where they are used:

- `mutateTask` (every task edit and command) re-reads the actor's membership
  `FOR SHARE` inside its transaction, before the task row.
- `runInTransaction(operation, run, { actor: context })` does the same for
  any caller that passes the actor: `assertActorCurrent`
  (`lib/core/transactions/actor.ts`) share-locks the actor's
  `company_members` and `users` rows and, for a signed-in actor, the
  `sessions` row, and refuses when the membership or account is no longer
  active (`MEMBERSHIP_INACTIVE`), the membership's role differs from the one
  the request decided under (`FORBIDDEN`), or the session is gone or expired
  (`UNAUTHENTICATED`).

Either way the two serialise: a revocation that committed first is seen and
the write rolls back with nothing written — no activity row, no outbox event;
one that arrives during the write waits for its commit.
`tests/security/revocation.test.ts` forces both orders with a lock barrier.

What it does **not** cover: a module switched off, a project assignment
ended, a department position or a delegated grant withdrawn mid-write. Those
are per-record facts only the service knows; they are enforced when the
context is resolved, on every request, and a service that needs them at the
commit boundary locks those rows itself (as `mutateTask` locks the project and
assignee rows). **And it covers only callers that opt in.** As of AUD-06 no
service outside tasks passes `actor`; `createTask` in particular writes in a
plain `prisma.$transaction` with no recheck, and the revocation suite pins
that as a known gap. Adopting it is one argument per `runInTransaction` call,
or one `assertActorCurrent(tx, context)` line first inside an existing
transaction.

## 2. Company isolation

Every business query starts from `companyId`, including for the Owner
(PRD #47 §15, §16). A record is reached by `findFirst` with the company in the
`where` — never by `findUnique({ where: { id } })` on a client-supplied id.

Where a by-id call remains, the row was already loaded inside scope earlier in
the same operation, or the caller is a system job acting on its own company's
data. `pnpm verify:authorization` counts those call sites per file against
`scripts/security/unscoped-by-id.baseline.json`: the count may fall, never rise
without a recorded review. The baseline is a ratchet, not a certificate — what
proves the behaviour is the isolation suites in §8.

**Linked ids.** A `projectId`, `assigneeMemberId` or `contractorId` in a
request body is a claim. `lib/access/references.ts` resolves such claims
against the caller's company (and project, where the record is project-bound)
before anything is written; modules with their own scope builders check through
those. A database foreign key proves the row exists, not whose it is
(PRD #47 §20, §21, §50, §51).

**One person, several companies (E-05A).** A person may hold a membership in
more than one company. The session still resolves exactly one of them. Two
things look past it, and both reuse each company's own rules rather than
widening any: the Projects page lists the union of each membership's own project
scope, resolved through `buildMemberContexts`; and opening a project in another
company moves the session row to the membership in that company, by POST, after
re-finding the project through that membership and re-checking the membership
is active (`moveSessionToMembership`). The move is recorded as
`COMPANY_CONTEXT_SWITCHED`. See `docs/projects-page.md`. The workspace switch
(§10) is the other way a session moves between the person's companies, by the
same `moveSessionToMembership`; nothing moves a session into a company the
person holds no active membership in.

**The data itself is checked too.** `lib/core/security/company-integrity.ts`
reads the schema from Prisma's DMMF and looks for any row whose id-shaped
columns name another company's records — including child tables such as line
items that carry no `companyId` of their own. `pnpm verify:company-integrity`
runs it; CI runs it after the suites, so a missing same-company check fails the
build the first time any test exercises it (PRD #47 §187-§189).

## 3. Module activation

A company can switch a module off; that is separate from what a role may do
(PRD #47 §24). The two are joined in one place: `assembleContext` drops every
permission belonging to a disabled module. **So `can(context, "x.y")` already
implies the module is enabled**, and a disabled module disappears from
navigation, search, calendar, approvals, reporting and dashboards without each
of them special-casing it (§26).

`assertModule(context, moduleKey)` states it explicitly where a route has no
permission to check, and answers `MODULE_UNAVAILABLE` rather than `FORBIDDEN`:
the person cannot fix the first, their administrator can fix the second.

## 4. Permissions

Authorization uses permission keys from `config/permissions.ts` — never a role
name (PRD #47 §29, §30). `can(context, "task.create")`, `assertPermission(...)`.
Roles are configuration that grants permissions (`config/role-defaults.ts`),
verified by `pnpm verify:roles`.

`pnpm verify:authorization` fails on any `context.role === "…"` comparison in
`lib/` or `app/`, outside this list of reviewed exceptions (PRD #47 §32):

| File | Why a role name appears |
|---|---|
| `lib/core/approvals/approval-steps.ts`, `lib/modules/procurement/approvals/approval.service.ts` | an approval step *configured for a role* is assigned to that role |
| `lib/core/notifications/attention.conditions.ts`, `lib/modules/project-planning/planning.attention.ts` | choosing notification recipients; the deep link re-authorizes |
| `lib/modules/team/*` | the company must keep an Owner, and assigning Owner requires `team.owner.assign` |
| `lib/modules/company/company-bootstrap.service.ts` | creating a company's first Owner |
| `lib/modules/dashboard/dashboard.service.ts` | picks a dashboard layout, never data |
| `lib/modules/timesheets/timesheet.reports.ts` | the role set is derived from who holds a permission, not named |

Meeting participant roles (`ORGANIZER`, `CHAIR`) are record fields, not company
roles, and are not part of this rule.

## 5. Data scopes

`SELF · ASSIGNED · PROJECT · DEPARTMENT · COMPANY · SYSTEM`, resolved per module
from the role matrix and applied **in the database**, never by filtering in
JavaScript (PRD #47 §40). The shared builders live in `lib/access/scope.ts`:
`buildProjectScopeWhere`, `buildTaskScopeWhere`, `buildClientScopeWhere`,
`buildProjectLinkedScopeWhere`, `accessibleProjectIds`, `canAccessProject`.
Modules with a domain-specific reading of scope own a builder next to their
service — for example `lib/modules/procurement/procurement.scope.ts`.

**DEPARTMENT is not company-wide.** `reachesWholeCompany(scope)` in
`lib/access/scope.ts` is true for `COMPANY`, `GROUP` and `SYSTEM` only. A
project, task or client carries no department, so where the role matrix gives
a module `DEPARTMENT` scope the shared builders narrow it to the person's own
projects, like `SELF` — a department title never widens to the whole company
(AUD-06 §3). Modules whose records do carry a department (documents,
timesheets) read it themselves. Every "whole company?" question asks
`reachesWholeCompany` rather than listing scopes, so the rule has one
definition (`workforce.permissions.ts` included).

Every scope keeps a **SELF door**: a record somebody raised, owns or is
assigned to stays theirs even when it sits on a project they are not a member
of (PRD #19 §218). That is deliberate, and the project-isolation suite excludes
the actor's own records for exactly this reason.

A user may narrow what they see with filters; they can never widen it. The
effective query is *authorized scope ∩ requested filter* (PRD #47 §171, §172),
and the same rule governs exports, reports, dashboard counts and search — a
count is data (§175).

## 6. Record access

Permission to view a *kind* of record is not access to a *particular* one
(PRD #47 §44). `lib/core/records/record.registry.ts` holds one definition per
record type: its module, its view permissions, and a `find`/`reachable` pair
that loads the record inside the reader's own scope.

Use `loadRecord(context, type, id)` or `canReadRecord(...)`: they check
`moduleAndPermissions` *then* the scoped query. Calling a definition's `find`
directly skips the module and permission half — if you need it, call
`moduleAndPermissions(context, def.moduleKey, def.viewPermissions)` first.

Records that inherit access — documents, comments, mentions, attachments,
daily-log evidence, engineering revision files — resolve their parent through
this registry rather than carrying rules of their own (§47, §48). Favourites,
recent work, notifications and attention items never grant access: each
re-authorizes the record when it is opened or listed (§74-§77).

**Notification titles are withheld, not trusted (AUD-06 RP-18).** A
notification's title and body were written for its recipient when it was
sent, and they name the record. When a list is read, each row about a record
is checked against the reader's scope *now* (`withdrawnNotificationIds` in
`lib/core/notifications/notification.service.ts`, one reachability query per
record type and company); for a record the reader can no longer open the list
shows `WITHDRAWN_TITLE` ("About a record you can no longer open"), no body and
no link. The row is not deleted: it still counts and can be marked read. The
activity center applies the same rule to its feed, and its search never
matches a withheld row — a match would confirm what the withheld text said.

## 7. State guards and error behaviour

Authorization includes the record's state: an approved revision, a locked daily
log, a submitted timesheet or an issued transmittal refuses edits regardless of
permission (PRD #47 §85, §86). Each domain service owns its transitions and
answers `CONFLICT`.

| Code | Status | When |
|---|---|---|
| `UNAUTHENTICATED` | 401 | no session, or a session that no longer resolves |
| `MEMBERSHIP_INACTIVE` / `COMPANY_INACTIVE` | 403 | authenticated, but no workspace to act in |
| `FORBIDDEN` | 403 | permission missing |
| `MODULE_UNAVAILABLE` | 403 | the company switched the module off |
| `NOT_FOUND` | 404 | out of scope, another company's, or absent — indistinguishable on purpose (§114) |
| `VALIDATION_ERROR` | 422 | input, including a linked id that is not the caller's |
| `CONFLICT` | 409 | the record's state does not allow it |
| `WORKSPACE_COMPANY_REQUIRED` | 409 | a write in the Group workspace, which has no company to write to |

The response carries the code, a safe message and a request id — never the
permission that was missing, another company's name, a hidden record's title or
any SQL (§116, §224).

**The request method is signed.** `withContext` has no request object, so it
learns the HTTP method from `x-nesto-request-method`, which middleware sets —
and it matters: a Group-workspace session may read but not write, and the
stale-tab and maintenance guards apply to writes. Middleware does not run on
paths that look like static files, and a dynamic segment can be spelled
`abc.png`, so on such a path a client's own header would reach the route. So
middleware also signs method and path with the auth secret
(`x-nesto-request-signature`, `lib/core/security/request-method.ts`), and the
route believes the method only when the signature verifies; an unverified
method reads as a write, the stricter answer for every guard that asks.

**Internally**, each refusal carries a reason code — `UNAUTHENTICATED`,
`MEMBERSHIP_INACTIVE`, `COMPANY_INACTIVE`, `MODULE_DISABLED`,
`PERMISSION_DENIED`, `SCOPE_DENIED`, `RECORD_DENIED`, `STATE_DENIED`,
`CROSS_COMPANY_REFERENCE`, `CROSS_PROJECT_REFERENCE` — which reaches the
security log and the denial counters in `lib/access/security-log.ts`, with no
record content (§117-§119, §199). A rising `cross_company_denied_total` is
either somebody probing ids or a client sending the wrong ones (§197).

## 8. How this is proven

`pnpm test:security` (CI runs it on every push):

| Suite | What it proves |
|---|---|
| `cross-company-api` | Company A's Owner against every route with Company B's real ids, and the reverse: no 2xx, no foreign id in any response, no row changed in the other company. Covers ~900 calls per direction |
| `cross-company-actions` | the same against every exported server action |
| `project-isolation` | a PROJECT-scoped member against every route and action of the modules where their scope is narrow, using other projects' records (excluding their own) |
| `module-disabled` | a company with modules off: routes, providers, search, calendar and counts all absent |
| `session-lifecycle` | no session, suspended membership, suspended company — refused on the next request, with the right code and counter |
| `company-integrity` | no row anywhere references another company's record |
| `revocation` | a role change, membership suspension, ended project assignment, module switched off, deactivated account and ended session each refuse an already-resolved session's next request and its outstanding form; a revocation racing a write is serial (AUD-06 RP-15, RP-16) |
| `foreign-links` | **destructive**; see below |

The routes and actions are discovered from the filesystem, and the ids from the
database through Prisma's DMMF, so a route or model added next month is swept
the day it lands rather than when somebody remembers to add a case.

`pnpm test:security:links` poisons one link field at a time in every write
endpoint whose valid body can be synthesized (55 endpoints, 21 link fields as of
this commit) and then runs the integrity scan. It really writes, so it refuses
to run against the development database; give it a throwaway one:

```bash
createdb nesto_sec_test
DATABASE_URL="postgresql://$(whoami)@localhost:5432/nesto_sec_test" pnpm db:deploy
DATABASE_URL="postgresql://$(whoami)@localhost:5432/nesto_sec_test" pnpm db:seed
DATABASE_URL="postgresql://$(whoami)@localhost:5432/nesto_sec_test" pnpm test:security:links
dropdb nesto_sec_test
```

A 2xx there is not automatically a fault: a route that parses several schemas
may simply never read the field on the branch that ran. What condemns a write
is the id being **taken up** — echoed back as the record's own link, or found
in the data by the integrity scan.

Static gates, also in CI:

```bash
pnpm verify:authorization     # routes classified and wrapped, actions resolve a
                              # context, no role-name authorization, no
                              # server-owned field in a request schema, by-id ratchet
pnpm security:matrix --check  # docs/security/api-security-matrix.md is current, and
                              # no company-scoped endpoint reaches zero checks
pnpm verify:company-integrity # the data has no cross-company reference
pnpm verify:organization      # positions, branches, grants and memberships agree
pnpm verify:roles             # the role/permission matrix
```

`docs/security/api-security-matrix.md` is generated: for all 830 endpoints it
follows the real call graph into the services and records the permissions,
module guards, scope builders, record guards and state guards on the path
(PRD #47 §105, §156). Its evidence is static — it shows a check is on the path,
not on every branch. Behaviour is what the suites above prove.

**Known limits, honestly.** Link poisoning reaches the write endpoints whose
bodies can be synthesized, not all of them; Company B's seed is thinner than
Company A's, so some link fields are exercised with an id of another kind; and
the by-id baseline was reviewed in aggregate rather than site by site.

## 9. Checklists

**Every new endpoint** (PRD #47 §184): context resolved by the shared entry
point · company predicate at the query source · module and permission checked ·
scope applied in the database · record loaded inside scope · linked ids
verified as the caller's · state guard · Zod-validated input with no
server-owned fields · a test.

**Pull requests** carry the same list in `.github/pull_request_template.md`.

## 10. Workspaces: one person, several companies, the group

A session always points at one membership. What it shows is its
**workspace**: that one company, or the whole parent group (Workspace Context
PRD; `lib/context/workspace-access.ts`, `lib/workspace/workspace.service.ts`).

**Company switch.** `POST /api/workspace` (`switchWorkspace`) moves the
session between the companies the person belongs to, and to the Group
workspace when they may enter it. It changes the workspace, never the person:
the same user, the same session row, token and expiry; only the membership,
its company and the workspace generation (`workspaceVersion`) move, recorded
as `COMPANY_CONTEXT_SWITCHED`. A company they hold no membership in — or one
that does not exist — is `FORBIDDEN` with one answer for both; a company they
belong to that is suspended is `COMPANY_INACTIVE`; an older switch arriving
after a newer one is refused. A refused switch leaves the session row exactly
as it was. A tab still showing the previous workspace sends it with every
write (`x-nesto-workspace`) and is refused (AUD-03 §7), so a switch in one tab
never turns another tab's draft into a write in the wrong company.
`tests/api/workspace/company-switch-identity.test.ts` (AUD-06 RP-06).

**The Group workspace is a union, never a grant.** `resolveGroupContexts`
builds the person's own context in every usable company of the group, each by
the same `assembleContext` a session there would use. A group list, count,
search or dashboard figure is the union of those companies' own scoped answers
for that module and action; a company that does not grant it is left out
entirely, and a permission held in one company is never lent to another
(§57-§62). Holding a group title promotes nothing. Writes need one company:
in the Group workspace `requireCompanyContext` / `withContext` refuse with
`WORKSPACE_COMPANY_REQUIRED` and never fall back to the anchor company.

The Group dashboard's *layout* follows the person's position in the group —
Owner in any company, else the highest position held anywhere — not the role
of whichever membership the session is anchored in; the data under it is still
each company's own answer (`groupReader` in `dashboard.service.ts`, AUD-06
RP-19).

## 11. The demo user switch and demo mode

Development conveniences — the demo account picker on the sign-in page, the
demo user switch in the top bar, the access debugger — exist only where
`isDevMode` is true. `devModeFor` (`lib/auth/dev-mode.ts`) is an allowlist
and fails closed:

| `APP_ENV` | Demo conveniences |
|---|---|
| `production`, `staging` | off, whatever else is set |
| `development`, `test`, `demo` | on (`demo` is the hosted demo) |
| any other value (a typo, `preview`) | off |
| unset | on for a development or test Node build; on a production build only with the explicit `NESTO_DEMO_MODE=true` |

`NODE_ENV` alone never turns it on for a deployment. The server actions check
it themselves (`signInAsDemoAccountAction`, `switchDemoUserAction` answer
"Not found." when it is off), so hiding the control is not the gate.

**Switching user is signing out and signing in** (C-01, AUD-06 §4). The
browser sends a username and nothing else. The demo password is resolved on
the server (`resolveDemoAccountTarget`) and never rendered, bundled or
returned; only curated personas and active logins of a demo tenant qualify.
Every refusal the sign-in would give — unknown or inactive account, no
workspace, the password refused, maintenance or `disableNewLogins`, the
sign-in throttle — is asked **before** the current session is ended, so a
refused target leaves the current person signed in. Then the session row is
deleted and a `LOGOUT` recorded (`metadata.switchType = "DEMO_USER_SWITCH"`,
the target's id), the legacy `nesto.dev-role` cookie is deleted, and the
target signs in through the credentials provider — the same pipeline as the
form, so the new session, company and workspace are what a normal login
makes. If that sign-in fails after the logout, the browser is sent to
`/login?reason=demo-switch-failed`; the old session is never resurrected. The
`LOGIN_SUCCESS` event records `metadata.via` (`DEMO_USER_SWITCH` or
`DEMO_SIGN_IN`) where demo mode is on, and nowhere else.

A context is never a role overlay: the role is always the membership's own,
and no cookie, header or body can replace it (`tests/architecture/no-role-override.test.ts`).

## 12. Known limitations, stated

- **Signed download and preview URLs are bearer URLs.** A document download or
  preview URL is issued after the reader is authorized and lives
  `DOWNLOAD_URL_TTL_SECONDS` / `PREVIEW_URL_TTL_SECONDS` — 3 minutes
  (`lib/core/storage/index.ts`); project media and 3D viewer assets live 5
  minutes. The storage provider cannot revoke an issued URL, so a URL issued
  before a revocation keeps working until it expires, for whoever holds it.
  What revocation does stop immediately is **issuance**: the next request for
  a URL re-authorizes and is refused. The residual exposure — up to 3 minutes
  (5 for media/3D) of an already-issued link — needs the owner's sign-off
  before the stricter "instant revocation" objective is declared met
  (AUD-06 §6, §9).
- **Commit-boundary rechecks are opt-in** (§1): only task mutations and
  `runInTransaction` callers that pass `actor` serialise with a concurrent
  revocation; every other write is authorized when its request resolves.
- **Notification text is withheld per list read**, not rewritten: the stored
  title stays in the database, and a surface that renders notification rows
  without going through the notification service would show it.

## 13. What this does not do (V0.1)

No SSO, MFA, passkeys or external contractor login; no custom role builder; no
attribute-based policy engine (PRD #47 §5). No production impersonation: the
demo user switch is a demo-mode capability (§11), not a support tool.
`EXTERNAL_SHAREABLE` is metadata and grants nobody anything — contractor
records are internal company data (§101, §102).
