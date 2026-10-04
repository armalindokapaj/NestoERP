# AUD-ADMIN-01 — Admin Console integration and authorization audit (PRD #14)

Status: **in progress.** Fourth pass (browser QA), 2026-10-04. Rows below were checked in code and, where noted, by test. Sections 3 and 4 list what is fixed and what has not been audited yet; this report does not claim the PRD's Definition of Done.

## 1. Findings

| ID | Area | Status | Severity | Evidence | Fix |
|---|---|---|---|---|---|
| ADM-001 | Group CEO needs no Company | PASS | — | `ParentGroupMember.roleId`; `lib/context/group-context.ts`; test "a Group CEO needs no company" | — |
| ADM-002 | Group context revalidated per request | PASS | — | `resolveGroupContextForSession` re-reads seat, role and group status on every request | — |
| ADM-003 | Group CEO uniqueness and last-CEO protection under concurrency | SECURITY ISSUE | P0 | `platform-group-users.service.ts` and `group-user-detail.service.ts` counted active CEOs in a transaction with no lock and no DB constraint; two simultaneous replacements or suspensions could leave two CEOs or none | Fixed: `lockGroup` (`group-placement.ts`) takes `FOR UPDATE` on the group row at the start of add, remove and suspend/reactivate; test "simultaneous Group CEO assignments leave exactly one active CEO" |
| ADM-004 | Company CEO uniqueness | PASS | — | `Company.ceoMemberId` is unique; `company-leadership.service.ts` locks the company row `FOR UPDATE` | — |
| ADM-005 | Company-scoped isolation (IDOR) | PASS | — | `companyFor` in `company-users.service.ts` returns 403 for a company outside the actor's group; test "a Group A administrator cannot read or change Company B by id" | — |
| ADM-006 | Role injection into company user forms | PASS | — | `COMPANY_ROLE_KEYS` excludes CEO and group-level roles; Platform Admin is not a membership role; test "role injection ... fails" | — |
| ADM-007 | Foreign department / project ids | PASS | — | `departmentOf`, `companyProjects` filter by company; test "a foreign department or project id is refused" | — |
| ADM-008 | Scoped removal never deletes the global User | PASS | — | Every `User` relation from `CompanyMember`, `ParentGroupMember` is `onDelete: Restrict`; `removeCompanyUserAccess` ends the membership only; test "removing a person from a company never deletes the global account" | — |
| ADM-009 | Idempotent add | PASS | — | `@@unique([companyId, userId])`; second add answers CONFLICT, no duplicate row; unique violations map to 409 in `lib/api/failure.ts` | — |
| ADM-010 | Group-only users cannot be removed from Company controls | PASS | — | `assertDirect` / `blocked: "GROUP_ONLY"` in `company-users.service.ts` | — |
| ADM-011 | Self-lockout and last administrator | PASS | — | `SELF_LOCKOUT`, `SELF_SUSPENSION`, `SELF_REMOVAL`, `LAST_GROUP_ADMIN`; company side protects the CEO pointer | — |
| ADM-012 | `ALL` is dynamic | PARTIAL | P2 | PRD #10 materialises one `groupDerived` CompanyMember per company; `reconcileCompanyForSeats` adds new companies automatically, so behaviour matches (a new company is covered), but the representation is rows, not a computed rule | Documented deviation, kept; a computed resolver was judged too large (PRD #10 note) |
| ADM-013 | Platform membership editor could suspend the named Company CEO | SECURITY ISSUE | P0 | `updateMembership` (`platform-control.service.ts`) blocked CEO role changes only; a status change left `Company.ceoMemberId` pointing at a suspended member | Fixed: refuses ending the CEO's membership (`IS_COMPANY_CEO`); test "the platform membership editor cannot suspend the named CEO" |
| ADM-014 | Platform membership editor could edit a policy-owned (`groupDerived`) membership | CONFLICT | P1 | same function; the next policy sync would fight the manual edit | Fixed: refused with `GROUP_DERIVED`, pointing to the group's Users tab |
| ADM-015 | Group policy vs membership rows can drift | MISSING | P1 | no check compared a seat's policy with the materialised rows, the CEO pointer, or duplicate identities | Added `lib/modules/organization/access-integrity.ts` (derived without coverage, covered without membership, selected company of another group, multiple Group CEOs, bad CEO pointer, case-duplicate emails), wired into `verify:organization`; test "access integrity check ..." |
| ADM-016 | Stale permissions, revocation, workspace fallback | PASS | — | `resolveContextForSession` (`build-context.ts`) re-reads membership, role, company and group status on every request; `relocateSessionToUsableMembership` is the fallback; `tests/api/workspace/workspace-context.test.ts` | — |
| ADM-017 | Impersonation | PASS | — | No impersonation mechanism exists: the demo switch is logout + login (C-01) and `tests/architecture/no-role-override.test.ts` forbids a role override | — |
| ADM-018 | Authorization-sensitive caches | PASS | — | No `unstable_cache`, `revalidateTag` or client query cache in app or lib; only per-request React `cache` / request scope keyed by session and user | — |
| ADM-019 | Reparenting recomputes group-derived access | PASS | — | `moveCompanyToGroup` = detach (`releaseCompanyFromGroup`) + attach (`reconcileCompanyForSeats`) in one transaction; test "moving a company recomputes ..." | — |
| ADM-020 | Breadcrumb implied Platform scope on an account opened from an organization | CONFLICT | P2 | `app/admin/users/[userId]/page.tsx` always rooted at "All users"; the group Users tab link carried no `from` | Fixed: breadcrumb names the originating organization; group tab link now passes `?from=` |
| ADM-021 | Error boundary for `/group` pages | PARTIAL | P2 | no `app/group/error.tsx`; failures fall to `app/error.tsx`, which retries in place (`reset`) but drops the group shell | Open, P2 |
| ADM-022 | Production access resolver is the membership row; `resolveGroupCompanyAccess` is used only by tests | DUPLICATE LOGIC | P2 | company authorization reads `CompanyMember`; the group-derived row is the single authority and ADM-015 now guards its agreement with the policy | Documented; not replaced by a computed resolver (see ADM-012) |
| ADM-023 | Invitations and pending CEO | PASS | — | No invitation flow exists for these paths: provisioning uses the default password (PRD #8, #12 notes), so there is no pending state to duplicate | — |
| ADM-024 | Legacy `organization.member.*` services could change or end a policy-owned membership | CONFLICT | P1 | `changeOrganizationMemberRole`, `removeOrganizationMember` (`platform-organization-admin.service.ts`) used by the group Users tab; ending a derived row left the policy covering a company with no membership | Fixed: `assertDirectMembership` refuses with `GROUP_DERIVED`; test "the legacy organization editors leave a policy-owned membership alone" |
| ADM-025 | Global account deletion could remove a named CEO silently | SECURITY ISSUE | P1 | `deletePlatformUser` deleted memberships, so `Company.ceoMemberId` (`onDelete: SetNull`) became null and the Group CEO seat vanished with no CEO step or audit | Fixed: refuses `IS_COMPANY_CEO` / `IS_GROUP_CEO`; test "deleting an unused account refuses a named Company CEO or Group CEO" |
| ADM-026 | Company and group deletion keep global users | PASS | — | `deleteCompany`, `deleteGroup` (`platform-recovery.service.ts`) are soft (`status: DELETED`, retention, `purgeAfter`); the only hard user delete is `deletePlatformUser` (Platform-only, unused accounts, FK refusal rolls back) | — |
| ADM-027 | Live session after a role downgrade or removal | PASS | — | test "a live company session follows a role downgrade and a removal on its next request" | — |
| ADM-028 | Company Users query: pagination, N+1, indexes | PASS | — | `listCompanyUsers` is one `findMany` (cursor, 25 a page) plus one `count`; the group coverage is one query per request; `CompanyMember` indexes on `(companyId, status/departmentId/roleId)` and `userId` | Not load-tested at 1,000+ rows |
| ADM-029 | Candidate search privacy | PASS | — | `searchCompanyUserCandidates` limits to people of the company's own organization, excludes Platform Admins, returns name, username, email and the group role label only | — |
| ADM-030 | Role-key comparisons in `team.service.ts` and `team.repository.ts` | PASS | — | The comparisons name protected roles (OWNER, GROUP_IT, last CEO/Owner) and every one sits beside `assertPermission` / `can(...)` for `team.owner.assign` / `team.group_role.assign`; role names are not the boundary | — |
| ADM-031 | Removing a direct membership signed the person out although group access still stood | CONFLICT | P1 | found in the browser journey: `removeCompanyUserAccess` revoked sessions before the policy re-derived the row, and `syncSeatAccess` revoked again on reactivation; the live session was ended and the person landed on `/login` (§89, §58) | Fixed: sessions are revoked only when the membership really ends (`company-users.service.ts`); `syncSeatAccess` revokes only when a live row changes role (`group-company-access.service.ts`); E2E "access changes" asserts the session survives |
| ADM-032 | Phone width: the company Users page scrolled sideways by 77 px | PARTIAL | P2 | `sr-only` actions header (`position: absolute`) in `company-users.tsx` escaped the table scroller | Fixed: scroller is `relative`; E2E asserts no horizontal overflow at 390 px and no `/admin` links for a group person |
| ADM-033 | Complete journey in a real browser | PASS | — | `tests/e2e/modules/admin-journey.spec.ts` (7 tests, Chromium, production-like data): found group, Group CEO with 0 companies signs in, company CEO + users, Manage Users stays in context with contextual breadcrumb and deep link, Group CEO sees own company and gets 404/403 for another group's company, group and company id substitution, platform-role injection, BOTH → removal leaves GROUP | — |
| ADM-034 | Accessibility scan of the contextual user pages | PASS | — | axe (wcag2a, wcag2aa): no serious or critical violations on `/admin/organizations/<company>?tab=users` and `/group/companies/<company>/users` | Other browsers and screen-reader passes not done |


## 2. Regression tests added

`tests/api/platform/aud-admin-01.test.ts` (14 tests). The concurrency test passes with the lock; it was not run against the unlocked code, so it is evidence of the outcome, not proof the old code failed.

## 3. Fixed in this pass

- ADM-003 (P0): Group CEO changes are serialised per group.
- ADM-013 (P0), ADM-014 (P1): the platform membership editor respects the CEO pointer and policy-owned rows.
- ADM-015 (P1): an access-consistency check exists and runs with `verify:organization`.
- ADM-020 (P2): contextual breadcrumb.
- ADM-031 (P1), ADM-032 (P2): found by the browser journey.
- ADM-024, ADM-025 (P1): legacy editors and global delete respect policy-owned memberships and named CEOs.

## 4. Verification

`tsc` and eslint clean on the touched files. `tests/api/platform`: the same 18 failures with and without these changes (seed-dependent or already recorded: maintenance-propagation, platform-control-plane, platform-departments, platform-implementation, standalone-project, aud09-platform-forms). `tests/architecture`: the same 2 failures with and without (ownership gate, verify-state). `tests/security` fails mostly because the dev database has no demo users.

## 5. Not yet audited (open, so P0/P1 are not yet declared zero)

Query behaviour at 1,000+ users (§132, read but not measured); other browsers and phone sizes; the Platform-Admin view of the same journey on a phone; the Company CEO / Company Admin as the acting user (no Admin Console surface exists for them, so only Platform and Group actors were exercised); `/group` error boundary (ADM-021); a computed access resolver instead of materialised rows (ADM-012, ADM-022).
