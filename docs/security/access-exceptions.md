# Access exceptions

Every place NESTO deliberately deviates from the canonical access decision of AUD-06 §3 — *the session's person, active membership and workspace, the enabled module and level, the action's permission and the target record's company/project/department/own-record predicate, intersected* — and every known limitation of how that decision is enforced or proven. It is the human-readable companion to the two generated documents (AUD-06 §2, first deliverable; RP-24):

- [access-manifest.json](access-manifest.json) — who holds what: the role × position × module matrix and every seeded persona's memberships, positions, departments, projects, grants and resolved module access (`pnpm security:access-manifest`, checked in CI by `pnpm security:access-manifest:check` and by `tests/security/access-manifest.test.ts`).
- [api-security-matrix.md](api-security-matrix.md) — every entry point: route handlers, server actions, pages, inline page actions, the signed storage endpoint, background jobs, notification events and search providers, with the authorization evidence on its path, its data owner, its tests and an outcome (`pnpm security:matrix`, checked in CI).

This list is maintained by hand. An exception is added when a change deliberately departs from §3 or a limitation is found, and removed only when the code no longer departs — never because a menu item is hidden. Each entry says **what**, **where**, **why**, **who owns it** and **what would close it**.

| ID | Exception | Kind | Owner | State |
|---|---|---|---|---|
| [EX-01](#ex-01-signed-file-urls-live-three-minutes-and-cannot-be-revoked) | Signed file URLs live three minutes and cannot be revoked | Limitation | Documents / product owner | **Owner sign-off required** |
| [EX-02](#ex-02-the-platform-admin-is-a-one-click-demo-target-only-on-a-developers-machine) | Platform Admin one-click sign-in only on a developer's machine | Deliberate policy | Auth / product owner | Decided (owner may reverse) |
| [EX-03](#ex-03-department-scope-means-different-things-in-different-modules) | DEPARTMENT scope means different things in different modules | Limitation | Access (lib/access) | Narrowed; latent inconsistency |
| [EX-04](#ex-04-notifications-about-a-record-the-reader-lost-keep-their-row-but-not-their-title) | Notifications about a lost record keep their row, not their title | Deliberate | Core notifications | In place |
| [EX-05](#ex-05-demo-user-switching-reaches-every-demo-tenant) | Demo user switching reaches every demo tenant | Deliberate (hosted demo only) | Auth | In place |
| [EX-06](#ex-06-entry-points-classified-by-review-not-by-evidence) | Entry points classified by review, not by evidence | Limitation of the matrix | Security | Reviewed list |
| [EX-07](#ex-07-coverage-that-runs-through-a-service-not-the-entry-point) | Coverage through a service, not the entry point; uncovered entry points | Limitation of the evidence | Each owning domain | Open |
| [EX-08](#ex-08-background-jobs-act-as-a-system-actor) | Background jobs act as a system actor | Deliberate | Core jobs | In place |
| [EX-09](#ex-09-the-group-workspace-without-group-standing) | The Group workspace without group standing | Deliberate | Context / workspace | In place |
| [EX-10](#ex-10-the-people-directory-is-group-wide-for-everyone) | The people directory is group-wide for everyone | Deliberate | People | In place |
| [EX-11](#ex-11-narrower-grants-are-recorded-but-widen-nothing) | Narrower grants are recorded but widen nothing | Deliberate (V0.1) | Organization | In place |
| [EX-12](#ex-12-seed-logins-kept-in-suspended-companies) | Seed logins kept in suspended companies | Deliberate (seed) | Seed / organization | In place |
| [EX-13](#ex-13-the-static-evidence-is-a-path-not-a-branch) | The static evidence is a path, not a branch | Limitation of the matrix | Security | Permanent |

Unclassified entry points: the matrix lists them in its own section. At the time of writing it lists **none** — every page, route, action, inline action, job, event and provider is classified, by evidence or by the review in EX-06.

---

## EX-01. Signed file URLs live three minutes and cannot be revoked

**What.** A download or preview is a signed URL — a bearer capability — valid for **180 seconds** (`DOWNLOAD_URL_TTL_SECONDS`, `PREVIEW_URL_TTL_SECONDS`); an upload URL for **900 seconds** (`UPLOAD_URL_TTL_SECONDS`). Whoever holds a download or preview URL can fetch that one object, as many times as they like, until it expires. Revoking the person's access — deactivating the membership, removing them from the project, switching the module off, archiving the document, a demo-user switch — stops every *new* grant on the next request, but does not recall one already issued. PRD §6 and §9 forbid claiming instant revocation in that case.

**Where.**
- `lib/core/storage/index.ts` — the three lifetimes.
- `lib/modules/documents/storage/download.service.ts` (`createDownloadGrant`) and `preview.service.ts` — issuance. Every grant re-runs the full authorization (`requireDownloadableDocument`, `assertObjectReadable`) and is audited (`DOCUMENT_DOWNLOAD_GRANTED`); the URL itself is never logged.
- `lib/core/storage/url-signing.ts` — HMAC over method, key, expiry, size cap, content type and disposition; secret `STORAGE_URL_SECRET`, falling back to `AUTH_SECRET`.
- `app/api/storage/objects/[...key]/route.ts` — class `SIGNED` in the matrix: no session by design; a forged and an expired grant both answer 403. With `STORAGE_DRIVER=s3` the browser talks to the bucket with an S3 presigned URL of the same lifetime and this route is never signed for.

**Why.** An object store cannot call back into NESTO to ask; that is what makes it an object store (PRD #29 §72, §306, §308). The lifetime is the exposure window, and it is kept short for exactly that reason. An upload grant is single use: it is refused once its upload session has closed and never overwrites an existing object.

**Residual exposure.** Up to 180 s after a revocation, a URL issued before it still downloads the file. Nothing new can be issued to the revoked person.

**Emergency lever.** Rotating `STORAGE_URL_SECRET` invalidates every outstanding local-adapter grant at once, without ending sessions. For S3, the equivalent is rotating the signing credentials.

**Owner.** Documents domain (`lib/modules/documents`), with the product owner. **Owner sign-off is required** before the stricter "revocation takes effect immediately for files" objective (§6, RP-15, RP-18) may be reported as met; until then it is reported as met *for issuance only*.

**Evidence.** `tests/unit/storage/signed-urls.test.ts` (signature, method, key and expiry binding), `tests/api/documents/storage-pipeline.test.ts` and `tests/api/documents/documents-authorization.test.ts` (issuance reauthorizes).

**Would close it.** Either sign-off on the 180 s window as the accepted limitation, or streaming downloads through a session-authenticated route (`download.service.ts` already has an application read path for small files, PRD #13 §18) so no bearer URL is ever issued for sensitive modules (HR, finance, legal).

## EX-02. The Platform Admin is a one-click demo target only on a developer's machine

**What.** The Platform Admin works outside every tenant and can operate all of them. On a developer's machine — `APP_ENV` `development` or `test`, or no `APP_ENV` and a non-production `NODE_ENV` — it is offered on the sign-in picker and the demo user switcher like any curated persona. On a hosted demo — `APP_ENV=demo`, or a production build with `NESTO_DEMO_MODE=true` — it is hidden from the picker, and `resolveDemoAccountTarget` refuses it as `UNKNOWN`, the same answer as an account that does not exist; it signs in with its password like any real account.

**Where.** `lib/auth/dev-mode.ts` (`platformOneClickFor`, `allowsPlatformOneClick`, always a subset of `devModeFor`), `lib/auth/demo-tenants.ts` (the roster filter and `resolveDemoAccountTarget`), `config/demo-accounts.ts` (`platform-admin`, section `platform`). The ARMAAR tenant's own platform administrator (`armaar.platform-admin`) belongs to no demo group and is never a one-click target anywhere (`picker: null` in the manifest).

**Why.** Anyone who opens a hosted demo's sign-in page would otherwise become the operator of every tenant on it (AUD-06 §4, gap 6).

**Owner.** Auth (`lib/auth`), product owner. **Decided** as a deliberate policy; the owner may reverse it.

**Evidence.** `tests/unit/auth/dev-mode.test.ts` (the environment combinations that matter), `tests/integration/auth/demo-user-switch.test.ts`.

## EX-03. DEPARTMENT scope means different things in different modules

**What.** `DEPARTMENT` is a data scope (`config/access.ts`) with no single predicate. The matrix uses it in two places only (see `roleMatrix` in the manifest): **HR's Documents cell** (`CONTRIBUTE/DEPARTMENT`, every HR position) and **the Organization rung a company manager position adds** (`POSITION_ORGANIZATION.COMPANY_MANAGER = "A/D"`). How a module reads it:

| Where | DEPARTMENT reads as |
|---|---|
| `lib/access/scope.ts` — projects, tasks, clients and every project-linked module (`buildProjectScopeWhere`, `buildTaskScopeWhere`, `buildClientScopeWhere`, `buildProjectLinkedScopeWhere`) | **Narrowed**: `reachesWholeCompany` excludes it, so it falls back to the person's own projects, like SELF. A project, task or client has no department, and a title never widens to the company (AUD-06 §3). |
| `lib/modules/workforce/workforce.permissions.ts` | Narrowed the same way (`reachesWholeCompany`). |
| `lib/modules/documents/document.parent-access.ts` (`companyLevelModules`) | Never reaches a company-level document; project and client documents follow the parent. |
| `lib/modules/timesheets/timesheet.permissions.ts`, `lib/modules/team/team.scope.ts` | The person's own department (`departmentId`), or only themself without one. |
| `lib/modules/{sales,contracts,procurement,hr}/*.scope.ts` | The person's own department when they have one. |
| `lib/modules/{qaqc,hse}/*.scope.ts` (`hasCompany…Scope`), `lib/modules/inventory/inventory.scope.ts` (warehouses) | **Company-wide.** |

**Why it is an exception.** The last row still treats a department as the whole company. No role or position holds DEPARTMENT in QA/QC, HSE or Inventory today, so nobody is widened by it — the manifest test (`tests/security/access-manifest.test.ts`, "no persona holds more than its role…") would show a cell that did — but a future matrix edit giving one of those modules a `/D` cell would silently grant the whole company.

**Owner.** Access (`lib/access`), with each module's scope file.

**Would close it.** One DEPARTMENT predicate in `lib/access/scope.ts`, used by the QA/QC, HSE and Inventory scope files instead of their own; or a guard in `config/role-defaults.ts` refusing a `/D` cell for a module whose scope file has no department predicate.

## EX-04. Notifications about a record the reader lost keep their row, but not their title

**What.** A notification's title and body were written for its recipient when it was sent, and they name records. When the reader later loses that record — a project taken away, a role changed, a module switched off — the row is kept: it still counts toward the unread badge, can be marked read, and opens nothing. Its stored title is replaced with **"About a record you can no longer open"** (`WITHDRAWN_TITLE`) and its body with nothing, in the notification list and in the activity center.

**Where.** `lib/core/notifications/notification.service.ts` (`WITHDRAWN_TITLE`, `withdrawnNotificationIds`, `pageOfNotifications`), `lib/modules/activity/activity-center.service.ts`. The open route re-reads the record on every open regardless.

**Why.** Deleting the row would rewrite someone's history and the read state they set; showing the stored title would leak a record's name after access to it ended (RP-18).

**Residual exposure.** The unread count still includes the row, so the reader learns that *something* happened about a record they once could open — never which record or what.

**Owner.** Core notifications (`lib/core/notifications`).

**Evidence.** `tests/api/notifications/notification-withdrawn.test.ts`.

## EX-05. Demo user switching reaches every demo tenant

**What.** On a development or hosted-demo deployment, the sign-in picker and the in-app switcher offer the curated five-company personas and the logins of every parent group seeded as a demo (`isDemo`, not a test fixture) — so a person signed in to one demo tenant can switch to a persona of another. Test fixtures and any customer account are refused as `UNKNOWN`, whether or not they exist.

**Where.** `lib/auth/demo-tenants.ts` (`listDemoTenants`, `resolveDemoAccountTarget`), `lib/actions/demo.ts`, `lib/auth/dev-mode.ts` (`devModeFor`: never in `production` or `staging`).

**Why.** A demo is a set of synthetic tenants shown side by side; a switch is a full sign-out and sign-in as the target (§4), never a role overlay, so crossing tenants grants nothing the target's own password would not.

**Owner.** Auth. **Evidence.** `tests/integration/auth/demo-user-switch.test.ts`, `tests/unit/auth/dev-mode.test.ts`.

## EX-06. Entry points classified by review, not by evidence

**What.** The matrix classifies an entry point from what its call path reaches. These are classified by a reviewed statement instead, because the check is real but invisible to the static trace, or because there is nothing to check:

- **Routes and actions dispatching through a registry** (`REVIEWED` in `scripts/security/api-matrix.ts`): `GET /api/search` and `GET /api/productivity/palette` (each search provider applies its own module, permission and scope — the providers are inventoried as their own rows), `GET /api/productivity/settings` and `GET /api/settings/runtime` (company configuration every member's interface reads; no business data), `decideRecordAction` (delegates to the record section's own `decide()`).
- **Self-service pages** (`SELF_SERVICE_PAGES`): `/access-denied`, `/module-unavailable`, `/workspace`, `/notifications`, `/favorites`, `/my-work`, `/search`, `/activity`, `/dashboard`, `/settings/profile`, `/settings/security`, `/settings/notifications` — the caller's own data, or assembled from per-module providers that each apply their guard.
- **Redirect-only pages**: a page that only calls `redirect` and builds where to (`/projects/all`, `/projects/my-projects`, `/qaqc/ncrs/[ncrId]/corrective-actions`, and the self-service redirects above) renders no data.
- **Platform handlers outside `/api/platform/`**: a route that answers only `withPlatformContext` (`/api/platform-admin/*`) is classified `PLATFORM` by that guard.

**Owner.** Security (this document and `scripts/security/api-matrix.ts`). **Would close it.** Nothing: each addition to these lists is a reviewed change to the generator, visible in its diff.

## EX-07. Coverage that runs through a service, not the entry point

**What.** A matrix row is `covered` when a test exercises the entry point itself (imports the route or page module, requests its URL, imports and names the action, names the job or event key) **or** a test imports and exercises a domain service the entry point calls directly. The second kind — shown as `via fn: file` — proves the service's permission, scope and record checks, which is where the ownership model puts them (PRD #48 §108), but not the door's own guard (`withContext`, `requireModule`, the page's layout). The door's guard is attacked by class by the discovery sweeps (`tests/security/cross-company-api.test.ts`, `cross-company-actions.test.ts`, `module-disabled.test.ts`, `project-isolation.test.ts`), which the matrix marks `sweep` and does not count.

Entry points no specific test exercises are `uncovered`. The matrix's summary line carries the live counts; the largest group is pages (their E2E specs visit a module's main pages, not every sub-page), then server actions and notification events.

**Owner.** Each entry point's data owner, named in the matrix's Owner column. **Would close it.** A test per uncovered entry point that is permission-sensitive — prioritized by the Surface column (`FILE`, `EXPORT`, `BULK`, `SEARCH`, `NOTIFICATION` first, §6's high-risk money, HR and approvals next).

## EX-08. Background jobs act as a system actor

**What.** The 26 jobs of `lib/core/jobs/job.registry.ts` run without a user session. A `COMPANY` job works company by company through `forEachCompany`, each with its own `SystemContext`; a `RECORD` job handles queue items that each carry their own company; a `PLATFORM` job touches technical rows of no company. A job never borrows a viewer's session (§7).

**Where.** `lib/core/jobs/job.registry.ts`, `job.handlers.ts`, `system-context.ts`. The notification dispatcher (`notifications.dispatch`) re-checks every recipient's access to the record — and the event's permission and discussion rules — at dispatch time, so an event queued before a revocation reaches nobody who has since lost the record (`lib/core/notifications/notification.dispatch.ts`, `notification.events.ts`).

**Owner.** Core jobs; each job's owning domain (the registry's `owner`). **Evidence.** `tests/api/jobs/*` (every job is `covered` in the matrix).

## EX-09. The Group workspace without group standing

**What.** Somebody who works in more than one company of a group may enter the Group workspace without any group-level standing (`mayEnterGroupWorkspace`), e.g. `multi-architect` (manifest: `groupWorkspace: { standing: false, mayEnter: true }`). A fresh sign-in still starts them in their own company; only group standing opens the Group workspace by default.

**Where.** `lib/context/build-context.ts` (`hasGroupStanding`, `mayEnterGroupWorkspace`, `resolveContextForSession`).

**Why.** The Group workspace is the union of the companies they already belong to, each read with exactly that company's permissions — it grants nothing (E-05A §26, RP-07). A standalone company has no Group level at all.

**Owner.** Context / workspace.

## EX-10. The people directory is group-wide for everyone

**What.** Every role that works in a company holds the People module at `CONTRIBUTE/GROUP` (`config/role-defaults.ts`, `buildRoleAccess`: `people: "C/G"`): anyone can find the group's people and edit their own profile. The directory is not group standing (`hasGroupStanding` ignores it) and exposes no private HR fields — compensation, employment files and private documents stay behind their own HR permissions (RP-11).

**Owner.** People (`lib/modules/people`), HR for the private fields.

## EX-11. Narrower grants are recorded but widen nothing

**What.** An access grant may name a group, a company, a department, a project or a record. In V0.1 only group- and company-scoped grants reach a membership's module access (`grantsInCompany`); narrower grants are refused when made, and one that exists grants nothing. No seeded persona holds a grant; the manifest records `grants: []` for each and the derivation applies grants exactly as the resolver does.

**Where.** `lib/context/organization-access.ts` (`grantsInCompany`), `lib/context/build-context.ts` (`buildModuleAccess`: a grant raises a level and widens to COMPANY or GROUP, never lowers, and a read-only role stays read-only).

**Owner.** Organization.

## EX-12. Seed logins kept in suspended companies

**What.** ARMAAR's Group Owner and Group IT keep memberships in the four suspended companies (SUNRAY ENERGY, EKSO, THE EOTel, SKYLINE TOWERS), so somebody can reopen them. Those memberships are not usable while the company is suspended: the resolver skips them, sign-in never lands there, and the manifest records them with `usable: false` and no profile. The fixture group's suspended company and its member, and the fixture accounts in refused states (inactive or suspended user, inactive or suspended membership, an invitation not yet accepted), are in the manifest the same way, with `signIn.outcome: "REFUSED"`.

**Owner.** Seed (`prisma/seed/armaar/access.ts`, `prisma/seed/fixtures/*`).

## EX-13. The static evidence is a path, not a branch

**What.** The matrix's evidence columns say that a permission, module, scope or record check is *reachable* from an entry point, not that it runs on every branch, and a broadly shared helper (the shell's context, collaboration, the activity center) credits many rows with many modules. Behaviour is proven by the security suites (`pnpm test:security`) and the per-module API tests, not by this inventory; the inventory's job is to make an entry point with nothing on its path impossible to add silently (CI fails on one) and to show where a test is missing.

**Owner.** Security. Permanent by design.
