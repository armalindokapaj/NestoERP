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
`COMPANY_CONTEXT_SWITCHED`. Nothing moves a session to a company without a
project the person may open there. See `docs/projects-page.md`.

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

The response carries the code, a safe message and a request id — never the
permission that was missing, another company's name, a hidden record's title or
any SQL (§116, §224).

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

## 10. What this does not do (V0.1)

No SSO, MFA, passkeys or external contractor login; no custom role builder; no
free company switcher; no attribute-based policy engine (PRD #47 §5). A session
moves between a person's companies only by opening a project that company owns
(§2, E-05A).
`EXTERNAL_SHAREABLE` is metadata and grants nobody anything — contractor
records are internal company data (§101, §102).
