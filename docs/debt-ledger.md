# Debt ledger (AUD-12 DX-01)

Concrete duplication and boundary problems found by reading the code on
2026-09-27 (`main` at 33ba6f61). Nothing here is fixed by this ledger. Each entry
names where the problem is, which rule is duplicated or which boundary leaks,
who depends on it, what could go wrong, the invariant a fix must hold, the
smallest change that would help, an owner and the test that would catch a
regression.

The order follows AUD-12 §3: security and data integrity first, then places
where one domain rule has split into diverging copies, then developer friction.
Similar-looking code is listed only where the policy is the same. Where two
copies intentionally differ, the entry says so.

Owners are the owning area in `docs/data-ownership.md` or the platform layer.
A named person is still to be assigned.

| # | Priority | Short name |
|---|---|---|
| L-01 | Security / data integrity | Four lists of "the application's database URLs" |
| L-02 | Security | Invite accept URL returned outside production |
| L-03 | Security | Seven classifiers for "which environment is this?" |
| L-04 | Data integrity | Client archive/restore: read, then an unguarded write |
| L-05 | Data integrity | State-write ratchet has slack above the real count |
| L-06 | Data integrity / process | Baselines have no reason, owner or remediation, and are rewritten whole |
| L-07 | Data integrity | Build-time seed eligibility re-implemented inline in shell |
| L-08 | Domain divergence | Money rounding defined twice |
| L-09 | Domain divergence | Five money formatters, three through `Number()` |
| L-10 | Domain divergence | Activity/approval pagination parsed by hand in 18 routes |
| L-11 | Friction | "Dry run" names a command that still writes |
| L-12 | Friction | Node version: CI 22, maintainer machine 24, nothing in package metadata |
| L-13 | Friction | README described PRDs #1–#17 and wrong commands |

---

### L-01 Four lists of "the application's database URLs"

- **Where:** `lib/core/database/target.ts:164` (`applicationTargets`: `DATABASE_URL`, `DIRECT_URL`, `POSTGRES_URL_NON_POOLING`, `POSTGRES_PRISMA_URL`, `POSTGRES_URL`). `scripts/db/drift.ts:50` (live probe list: `DATABASE_URL`, `DIRECT_URL`, `POSTGRES_URL_NON_POOLING`). `scripts/db/destructive.ts:43` (`DIRECT_URL`, `DATABASE_URL`). `lib/database/prisma.ts:13-14` (runtime: `DATABASE_URL`, else `POSTGRES_PRISMA_URL`). `scripts/vercel-build.sh:22` (`POSTGRES_URL_NON_POOLING`, else `DATABASE_URL`).
- **Rule:** which databases count as "the application's", so the shadow and destructive tools never touch one.
- **Consumers:** `pnpm db:drift`, `db:reset:demo`, `db:migrate`, `db:push`, the runtime client and the Vercel build.
- **Risk:** the drift check's static comparison covers all five variables, but its live `probeDistinct` covers only three. A deployment where the app reaches its database through `POSTGRES_PRISMA_URL` (the Supabase integration path in `prisma.ts`) gets no live check that the shadow is a different database. The static check still applies, so this is defence-in-depth missing, not an open hole.
- **Invariant:** every URL the runtime or a build can connect with is in the one list the safety checks use.
- **Smallest change:** export the URL list from `target.ts` (for example `applicationUrls(env)`) and use it in `drift.ts:50` and `destructive.ts:43`.
- **Owner:** platform (database tooling).
- **Regression test:** a unit test that sets each of the five variables in turn and asserts that `drift.ts` probes it. Extend the existing target tests.

### L-02 Invite accept URL returned outside production

- **Where:** `lib/modules/company/company-bootstrap.service.ts:348`: `...(process.env.APP_ENV !== "production" ? { inviteUrl: acceptUrl } : {})`.
- **Rule:** when a secret-bearing link may be shown to an operator.
- **Consumers:** `pnpm company:bootstrap` and any caller of the bootstrap service.
- **Risk:** `APP_ENV=staging` and `APP_ENV=demo`, both hosted, return the invite token in the response. So does an unset `APP_ENV` on a production Node build, where `appEnvironment()` in `lib/config/env.ts:139` would say "production". The comment says "never printed in production", but the check reads the raw variable rather than the shared classifier.
- **Invariant:** the invite token appears only where `isProduction()` is false *and* the environment is a developer's machine.
- **Smallest change:** replace the raw read with `appEnvironment() === "development"`, after confirming bootstrap's CLI use on hosted demos.
- **Owner:** company / account administration.
- **Regression test:** a unit test over `{APP_ENV: staging | demo | production | unset + NODE_ENV=production}` asserting that there is no `inviteUrl`.

### L-03 Seven classifiers for "which environment is this?"

- **Where:** `lib/config/env.ts:139-146` (`appEnvironment`: demo→production, test→development, exact-case enum). `lib/core/storage/storage-provider.factory.ts:83-86` (`productionClass`: its own copy, which a comment explains). `lib/auth/dev-mode.ts:24-45` (trim + lowercase, unknown value → off). `lib/core/database/target.ts:83-95` (APP_ENV, then VERCEL_ENV, then NODE_ENV, lowercase). `lib/database/prisma.ts:63` and `lib/core/observability/statement-counter.ts:43` (the same SQL-count gate, twice). `prisma/seed/guard.ts:17` (NODE_ENV + ALLOW_DEMO_SEED). `scripts/vercel-build.sh` (defers to `target.ts`).
- **Rule:** production/staging/demo classification.
- **Consumers:** demo sign-in, storage HTTPS rules, seed and reset guards, SQL counters and mail rules.
- **Risk:** the copies normalise differently. `APP_ENV=Production` fails `env.ts` validation but is lowercased by `target.ts`, and `VERCEL_ENV` is honoured by some copies and not others. Divergence means one guard could say "production" while another says "development". The copies are deliberately fail-closed today, and `verify:production-guards` checks the demo ones.
- **Invariant:** each guard's answer for a given env map matches a single table. `storage` may keep "don't fail on unrelated variables", which is the reason it has its own copy.
- **Smallest change:** a pure `classifyEnvironment(env)` in `lib/core/` (no validation side effects) used by all of them, with the policy differences kept at the call sites. Merge the two SQL-count gates first, because they are identical.
- **Owner:** platform.
- **Regression test:** a table-driven characterization test over env maps (case, whitespace, VERCEL_ENV, unset) for every current classifier, written *before* the merge.

### L-04 Client archive/restore: read, then an unguarded write

- **Where:** `lib/modules/clients/client.service.ts:362-377` (archive) and `:408-425` (restore). The state is checked on a read outside the transaction, then `tx.client.update({ where: { id } })` runs without the status or company in the `where`. This file holds the largest share of the blind-state-write baseline (9 of 74).
- **Rule:** a guarded transition names the state it moves from (PRD #49; `docs/state-machines.md`).
- **Consumers:** the Clients UI and API archive/restore.
- **Risk:** two simultaneous archives both pass the check. Both write, both audit, and `preArchiveStatus` can be overwritten with `ARCHIVED`, so restore returns the client to `ARCHIVED`.
- **Invariant:** exactly one of two concurrent archives succeeds and the other gets a 409, and `preArchiveStatus` is never `ARCHIVED`.
- **Smallest change:** `updateMany({ where: { id, companyId, status: existing.status } })` and a 409 on count 0, then lower the baseline for the file.
- **Owner:** clients.
- **Regression test:** a concurrent-archive case in `tests/integration/transactions/transitions.test.ts` style.

### L-05 State-write ratchet has slack above the real count

- **Where:** `scripts/architecture/blind-state-writes.baseline.json`. `pnpm verify:state` reports "72 blind and 74 allowed". `lib/modules/hse/risk-assessments/risk.service.ts` is allowed 4 but has 2.
- **Rule:** a ratchet only tightens (AUD-12 §3: "never regenerate a larger baseline").
- **Consumers:** CI "State integrity gates".
- **Risk:** two new blind writes can be added to `risk.service.ts` and CI stays green.
- **Invariant:** baseline count equals the current count for every file.
- **Smallest change:** make `verify:state` fail (or warn loudly) when a file is below its allowance, as `verify:ownership` already does for cycles (`scripts/verify-ownership.ts:215`), and re-record the lower number.
- **Owner:** platform (architecture gates) + HSE.
- **Regression test:** the gate itself. Add a case to `tests/architecture` that feeds a baseline above the count and expects a failure.

### L-06 Baselines have no reason, owner or remediation, and are rewritten whole

- **Where:** `scripts/architecture/{blind-state-writes,unreadable-state-writes,dependency-cycles}.baseline.json`, written by `--update-baseline` at `scripts/verify-state.ts:126-128` and `scripts/verify-ownership.ts:196-198`.
- **Rule:** AUD-12 §3 requires reason, owner and remediation reference on every allowlist/baseline entry. `OWNERSHIP_EXCEPTIONS` in `scripts/architecture/ownership.ts` already carries reasons, but these three files are bare counts/strings.
- **Consumers:** CI state and ownership gates, and reviewers.
- **Risk:** `--update-baseline` records whatever exists now. One command turns a failing change green, and the diff shows only a number.
- **Invariant:** a baseline entry can only be added or raised with a reason and owner, and a raise is visible in review.
- **Smallest change:** give each entry `{ count, reason, owner, ref }` (or a sidecar file), and have `--update-baseline` refuse to *raise* a count without `--reason`.
- **Owner:** platform (architecture gates).
- **Regression test:** an architecture test asserting that every baseline entry has non-empty `reason`/`owner`.

### L-07 Build-time seed eligibility re-implemented inline in shell

- **Where:** `scripts/vercel-build.sh:28-38` (an inline `tsx -e` program that composes `parseTarget` + `checkSeedTarget` + its own `NESTO_SEED_TARGET` comparison) and `prisma/seed/guard.ts` (the seed's own check).
- **Rule:** who may seed a hosted database.
- **Consumers:** every Vercel build.
- **Risk:** the `NESTO_SEED_TARGET` comparison exists only in the shell copy. Because it is code in a string, lint, typecheck and tests never see it. Both layers refuse today, so this is fragility, not a bypass.
- **Invariant:** the build's decision equals a function that tests can call.
- **Smallest change:** move the inline program into `lib/core/database/target.ts` as `buildSeedEligibility(env)` and call it from the script.
- **Owner:** platform (deploy).
- **Regression test:** a unit test over the env matrix (opt-in off, wrong target, production, staging, demo), plus `verify:production-guards`.

### L-08 Money rounding defined twice

- **Where:** `lib/modules/finance/finance.money.ts:33` (`roundMoney`, exported) and `lib/modules/procurement/procurement.money.ts:37` (private `roundMoney` + `decimal`). `lib/modules/finance/payments/payment.allocations.ts:77` also re-declares `money()`, which `finance.money.ts:23` already exports.
- **Rule:** currency rounding, half-up at `MONEY_DP`/`MONEY_SCALE`.
- **Consumers:** purchase-order line totals, finance invoices/commitments, and payment allocation.
- **Risk:** the two copies are identical today. A change to one (scale, or banker's rounding) would make a PO total disagree with the commitment it becomes.
- **Invariant:** a PO line total equals the finance line total for the same inputs.
- **Smallest change:** procurement imports `roundMoney` from finance's money module, or both import from a shared `lib/core/money`, if procurement must not import finance per `docs/domain-dependencies.md`. Delete the local `money()` in `payment.allocations.ts`.
- **Owner:** finance (rule), procurement (caller).
- **Regression test:** a characterization test over rounding edge values (x.xx5, negatives) run against both call sites before the change.

### L-09 Five money formatters, three through `Number()`

- **Where:** `lib/modules/approvals/approvals.provider.ts:268`, `components/approvals/approval-ui.tsx:113`, `lib/modules/finance/units/unit-finance.events.ts:24` (all use `Number(...)`), `lib/modules/procurement/approvals/approval.policy.ts:152` (Decimal `toFixed` + regex), `components/3d/company/Project3DViewer.tsx:288`, and `lib/utils/format.ts:51` (`formatCurrency(number)`).
- **Rule:** how an amount is shown to a user.
- **Consumers:** the Approvals Center, finance unit activity text, the procurement approval reason and the 3D viewer.
- **Risk:** a Decimal passed through `Number()` loses precision above about 2^53 minor units, which is unlikely for this ERP but silent. The bigger risk is that the same amount prints differently on the approval card, the activity line and the policy reason (`EUR 1,000.00` vs `€1,000` vs `EUR 1000.00`).
- **Invariant:** one amount has one rendering per locale.
- **Smallest change:** one `formatMoney(decimalString, currency)` over `Intl.NumberFormat` that takes the string, and migrate callers one at a time. `components/3d` belongs to another session, so leave it until last.
- **Owner:** platform UI (formatter) and each module (caller).
- **Regression test:** a unit test over a Decimal string list per currency (EUR, ALL), plus the approval provider tests.

### L-10 Activity/approval pagination parsed by hand in 18 routes

- **Where:** `app/api/**/route.ts`. 18 files call `searchParams.get("page")` directly, for example `app/api/sales/approvals/route.ts:18`, `app/api/contracts/[contractId]/activity/route.ts:19`, `app/api/projects/[projectId]/activity/route.ts:10` and `app/api/hr/employees/[employeeId]/activity/route.ts:11`. `lib/modules/shared/list-query.ts:148` (`pageWindow`) and `lib/modules/sales/sales.query.ts:171` (`boundedLimit`) already exist.
- **Rule:** query parsing and page-size limits.
- **Consumers:** every record's Activity tab and the module approval lists.
- **Risk:** the same parameters are clamped by different code in each route. Projects caps `limit` at 50 in the route, sales passes it to `boundedLimit`, and contracts and HR ignore `limit` and fix it server-side. Each route also re-derives "invalid page → 1". No unbounded route was found, but the next route copied from the wrong neighbour can be unbounded, because nothing shared enforces the bound.
- **Invariant:** the same `?page=&limit=` gives the same clamp everywhere. The AUD-08 page/limit semantics hold.
- **Smallest change:** a `parsePageQuery(url, { maxLimit })` in `lib/modules/shared/list-query.ts`, adopted route by route.
- **Owner:** platform API (helper) and each module (routes).
- **Regression test:** a unit test for the helper, plus one API test per migrated route for `page=-1`, `page=abc` and `limit=10000`.

### L-11 "Dry run" names a command that still writes

- **Where:** `.github/workflows/ci.yml` step "Storage maintenance dry run" runs `pnpm storage:maintenance`. `scripts/storage-maintenance.ts:1-15` says it defaults to a dry run only "for the destructive part". The scan job (`dryRun: false`) and the usage reconcile (`dryRun: false`) still write.
- **Rule:** AUD-12 §8: do not label a maintenance command "dry run" unless it is one.
- **Consumers:** developers running it against a shared database.
- **Risk:** someone runs it on a shared database believing it writes nothing.
- **Invariant:** command documentation matches what the script does.
- **Smallest change:** a documentation-only change, already made in `docs/dev/commands.md` (it writes scan verdicts and the usage projection, and deletes nothing without `--apply`). Renaming the CI step is left to the owner.
- **Owner:** documents/storage.
- **Regression test:** none needed beyond the docs. An integration test that a default run deletes no object would pin the "deletes nothing" half.

### L-12 Node version: CI 22, maintainer machine 24, nothing in package metadata

- **Where:** `.github/workflows/ci.yml` used `node-version: 22`, the maintainer's machine runs 24.18.1, the README said "Node 20+", and `package.json` pinned nothing.
- **Status:** partly addressed by AUD-12. `.nvmrc` (22) is now the one source for CI, `packageManager: pnpm@9.15.4` and `engines.pnpm` are set, and the docs say Node 22. `engines.node` is **deliberately not set**, because Vercel reads it to choose the production runtime and the project's current Node setting could not be confirmed. Setting it could silently change production. Owner action: confirm the Vercel project's Node version, then add `engines.node` to match.
- **Owner:** platform (deploy).
- **Regression test:** CI itself (runs on `.nvmrc`).

### L-13 README described PRDs #1–#17 and wrong commands

- **Where:** `README.md` before AUD-12: "Implements PRDs #1–#15", a PRD table ending at #17, "Node 20+", "209 tests", CI order without the security/ownership/state gates, and a "Next" section listing modules since built.
- **Status:** fixed by AUD-12. The README is now a current summary that links `docs/dev/`.
- **Owner:** platform.
- **Regression test:** none automated. The PR checklist asks whether the docs are still true.
