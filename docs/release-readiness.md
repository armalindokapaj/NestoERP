# NESTO V0.1 — release readiness record

Per PRD #35 §208–§214. Branch `nesto-v0.1-foundation-and-design-system`.
Prepared 2026-09-13.

This is the record the go/no-go decision is made from. It states what was
verified, what was not, and what is knowingly absent — §228 forbids implying a
capability that does not exist, and that applies to this document first.

---

## 1. Release readiness inputs (§209)

| Input | State |
|---|---|
| RC SHA | `71fdb88` plus this record and the release suite |
| CI status | `typecheck`, `lint`, `test`, `verify:production-guards` green |
| Staging E2E result | **320 passed, 0 failed** against a production build (`NEXT_DIST_DIR=.next-e2e`, port 3100), 5.3 min |
| Security scan result | 12 production guards pass; no dependency scanner configured (§6) |
| Migration review | 21 migrations; `migrate diff --exit-code` reports no drift |
| Performance result | not measured — see §6, an accepted gap |
| Restore drill result | not performed — see §6, an accepted gap |
| Known defect list | §5 |
| Rollback plan | `docs/runbooks/`, migrations additive-only this release |

**Automated suite at the time of writing:** 1 440 vitest across 62 files,
320 Playwright across 18 specs (chromium + mobile), 870 role-walk checks,
12 production guards, 17 data invariants. Lint: 0 errors, 16 warnings.
Typecheck clean. 21 migrations, no drift.

One E2E failure was found and fixed during this run, and it is worth recording
because it was a genuine consequence rather than a flake: switching invoices to
automatic numbering removed the number field from the form, and
`finance.spec.ts` was still filling it. The same test also revealed that its
`waitForURL(/\/finance\/invoices\/[^/]+$/)` matched `/finance/invoices/new`
and returned before navigating — it had only ever worked because the assertion
that followed did the waiting.

---

## 2. Critical workflow suite (§168)

All 26 workflows are covered. "Service" means a test drives the real service
against the real database with authorisation enforced; "E2E" means Playwright
drives the browser. Most workflows have both.

| # | Workflow | Covered by | Level |
|---|---|---|---|
| A | Company onboarding / Owner | `integration/access/seed`, `data-invariants` (active Owner per company) | Service |
| B | Team invite / activation | `api/team/team-service` | Service + E2E |
| C | Role change / permission refresh | `api/settings/module-toggle`, `api/team/team-service` | Service |
| D | Project creation / assignment | `api/projects/projects-service` | Service + E2E |
| E | Task assignment / completion | `api/tasks/tasks-service`, `api/notifications/notification-dispatch` | Service + E2E |
| F | Client creation | `api/clients/clients-service` | Service + E2E |
| G | Document upload / preview / download | `api/documents/storage-pipeline` | Service + E2E |
| H | Finance invoice approval | `api/finance/finance-service`, `api/audit/audit-trail` | Service + E2E |
| I | Finance payment | `api/finance/finance-service` | Service + E2E |
| J | Lead → Opportunity → Client | `api/sales/sales-service` | Service + E2E |
| K | Won opportunity → Project | `integration/release/workflow-k-won-to-project` | Service |
| L | Quote → Invoice | `api/finance/invoice-from-proposal` | Service |
| M | Quote → Contract | `api/contracts/contract-service` | Service + E2E |
| N | Purchase Request → PO | `api/procurement/procurement-service` | Service + E2E |
| O | PO approval → Commitment | `api/procurement/procurement-service`, `data-invariants` | Service |
| P | Goods receipt, QA gate OFF → Inventory | `api/inventory/inventory-service` | Service |
| Q | Goods receipt, QA gate ON → QA → Inventory | `api/qaqc/qaqc-service` | Service |
| R | Reservation / issue / return | `api/inventory/inventory-service` | Service + E2E |
| S | Inventory transfer | `api/inventory/inventory-service` | Service + E2E |
| T | QA NCR → Corrective Action → Task | `api/qaqc/qaqc-service`, `api/integrations/integration-links` | Service |
| U | HSE Hazard/Incident → Action → Task | `api/hse/hse-service`, `api/integrations/integration-links` | Service |
| V | Notification generation / deep link | `api/notifications/notification-dispatch` | Service |
| W | Global search access filtering | `api/search/search-providers`, `integration/access/scope` | Service + E2E |
| X | Report / export authorization | `api/audit/audit-trail`, module export tests | Service |
| Y | Audit event creation | `api/audit/audit-trail`, `unit/audit/audit-coverage` | Service |
| Z | Module disable / re-enable | `api/settings/module-toggle` | Service |

Two of these had no coverage when the review began, and one had no
implementation:

- **K** was implemented and correct but entirely untested.
- **L** did not exist. `Invoice` carried no link back to Sales and nothing
  could raise one from an accepted proposal, although the integration registry
  had declared `SALES_PROPOSAL_FINANCE_INVOICE` throughout. Built and tested
  during this review.

---

## 3. Data invariants (§195)

`tests/integration/release/data-invariants.test.ts` — 17 assertions against the
actual contents of the database, not against code paths. A service can be
correct and the rows still wrong.

| Invariant | Result |
|---|---|
| Business records carry the correct company | Pass |
| Cross-module links stay inside one company | Pass |
| Every company keeps an active Owner | Pass |
| No negative stock | Pass |
| Available = on hand − reserved | Pass |
| Balance projection reconciles to the movement ledger | Pass |
| Receipt lines belong to a real order line, same company, positive | Pass |
| One finance commitment per purchase order | Pass |
| One integration target per critical source | Pass |
| Material releases sit under an inspection in the same company | Pass |
| Every available document has a storage key | Pass |
| No archived document is still downloadable | Pass |
| Storage keys unique system-wide | Pass |
| Invoice totals equal the sum of their lines | Pass |
| No payment exceeds what it settles | Pass |

**One §195 line is deliberately not asserted.** §195 lists "no over-receipt",
but Procurement does not forbid it: more arriving than was ordered is a real
event, so the service refuses the first attempt and records the confirmed one
(PRD #19 §139). Six seeded order lines are over-received for exactly that
reason. Asserting §195 literally would assert against the product, so the gate
checks what is genuinely invariant — linkage, company and sign — and this note
records the divergence rather than hiding it.

---

## 4. Tenant isolation (§20–§22)

- Route layer: 220 of 223 API routes resolve through `withContext` or verify a
  signature. The three exceptions are the NextAuth handler and the two health
  probes, which answer without a session by design (PRD #32 §119-§122). The
  storage object route is guarded differently and deliberately: its HMAC
  signature *is* the authorisation.
- Service layer: 248 of 255 server actions call a guard; the seven that do not
  are sign in/out, password reset, the contact form, and two dev/demo actions
  the production guards prove are environment-gated.
- 80 `findUnique`/`findFirst` calls without `companyId` in the where-clause were
  examined individually during the #36 audit. No cross-company IDOR was found.
- Cross-company reads, writes, archive, download, export and search are covered
  by per-module company-isolation tests and by `integration/access/scope`.

**Superseded by PRD #47 (§11).** The counts above are from the #36 audit. The
current position is stronger and measured differently: all 464 API routes and
322 server actions are classified and swept from both companies, and the data
itself is scanned for cross-company references. See §11 and
`docs/security/authorization-model.md`.

---

## 5. Known defects and open findings

Nothing at P0. The two P0s found by the #36 audit — the audit log recording 9
of 52 registered actions, and the unused integration engine — are closed.

| # | Finding | Priority | State |
|---|---|---|---|
| 1 | Reporting metric registry unused; each module computes its own figures, so "revenue" is not guaranteed to mean one thing | P2 | Open |
| 2 | Caching layer has no production caller; PRD #31 is satisfied in unit tests only | P2 | Open |
| 3 | Topbar `Cmd+K` palette is a placeholder that never calls `/api/search`; the `/search` page works | P2 | Open — owned by a concurrent workstream |
| 4 | `--color-surface-2` referenced by ~14 pages, never defined | P3 | Open — same workstream |
| 5 | 16 `no-unused-vars` lint warnings, dead bindings from module commits | P3 | Open |

Each is P2 or below, each has a workaround (none affects correctness), and none
touches security or data integrity — so each is eligible for the CONDITIONAL GO
that §213 allows. Items 3 and 4 sit in files owned by a concurrent workstream
and were deliberately not edited.

---

## 6. Gates not met

Stated plainly because §228 forbids implying a capability that does not exist.

| Gate (§209) | State | Effect |
|---|---|---|
| Performance result | Not measured. No load test, no latency budget verified. | Scalability under real load is unknown. |
| Restore drill | Not performed. Backup policy and retention worker exist; a restore has never been exercised. | Recovery time is unproven. |
| Security scan | No dependency/vulnerability scanner is configured. 12 production guards cover the application's own hardening. | Third-party CVE exposure is unassessed. |
| Staging environment | E2E runs against a local production build, not a deployed staging instance. | Deployment-specific faults would not be caught. |

These are the honest reason the recommendation below is not a plain GO.

---

## 7. Recommendation

**CONDITIONAL GO**, on the terms §213 requires.

Mandatory functional, authorisation and data-integrity gates pass. The open
findings are P2/P3, each with a workaround, none touching security or data
integrity — which is what §213 permits a conditional on, and §212 would
otherwise have made this a NO-GO.

The conditions are the four gates in §6, not the defects in §5:

1. **Run a restore drill before production data exists.** Recovery time is the
   one unknown here that cannot be discovered safely later.
2. **Configure a dependency scanner** in CI.
3. **Establish a performance baseline** on the heaviest list and report paths.
4. **Deploy to a real staging instance** and re-run the E2E suite there.

Owner, risk acceptance and fix plan for each are for the release review to
record; this document cannot assign them.

---

## 8. Known limitations registry (§226, §227)

Deliberate V0.1 non-goals. None of these is implied anywhere in the product's
interface, which is what §228 requires.

**Absent by design, product scope:** statutory accounting, payroll, recruiting,
performance reviews, full CRM automation, public document sharing, document
versioning, OCR, AI document analysis, custom workflow builder, external public
API, custom BI builder, FX engine, authoritative inventory valuation.

**Absent by design, platform scope:** MFA and SSO, multi-region active-active,
microservices.

**Scaffolded but inert, each documented at its definition:**

| Capability | State |
|---|---|
| Thumbnails (#29 §51, §53) | Not generated. |
| Multipart upload and its abort rule (#29 §124, §126) | Not implemented; single-PUT upload only. |
| Antivirus engine (#29 §373) | No real engine. With none configured a file records `NOT_REQUIRED`, never `CLEAN` — the absence is visible rather than disguised as a pass. |
| Legal hold (#33 §75, §76) | `isUnderLegalHold` returns false. No hold UI in V0.1; the signature exists so adding one means implementing one function. |
| XLSX export (#28 §171) | CSV only. Enforced as an explicit exemption in `tests/unit/audit/audit-coverage.test.ts` so it cannot be forgotten. |
| Company creation flow (#24) | None. Companies come from the seed; `bootstrapCompanyConfiguration` is what a real flow would call. |
| Caching (#31) | Implemented, tested, not wired to any request path. |
| Metric registry (#27) | Implemented, not used by module reports. |

---

## 9. Go-live checklist (§214)

- [ ] Restore drill performed and recovery time recorded
- [ ] Dependency scanner in CI, findings triaged
- [ ] Performance baseline captured for list and report paths
- [ ] E2E green against a deployed staging instance
- [ ] `verify:production-guards` green against the release SHA
- [ ] `prisma migrate diff --exit-code` reports no drift against production
- [ ] Storage provider configured with HTTPS and credentials outside company settings
- [ ] `notifications:dispatch` and `storage:maintenance` scheduled
- [ ] `retention.ts` scheduled, first run in dry-run mode
- [ ] Rollback plan rehearsed; this release's migrations are additive-only

---

## 10. PRD #38 — Collaboration & Production Completion re-audit (§132, §180-§182)

Prepared 2026-09-14 against `2550098` and the commit that carries this section.
Same rule as the rest of this record: what was verified, what was not, and what
is knowingly absent.

**Verified for this section:** 1 586 vitest across 77 files; Playwright **347
passed, 0 failed** against a production build (chromium + mobile, 4.0 min),
including the new `collaboration/workflows.spec.ts` (10) and
`roles/role-acceptance.spec.ts` (16 roles); after self-hosting the fonts the
build was repeated and the affected specs (45) re-run green. Typecheck clean,
lint 0 errors, 17 production guards pass, 26 migrations, `pnpm worker --once`
exercised every job against the development database.

### 10.1 Hard release blockers (§132)

| Blocker | State | Evidence |
|---|---|---|
| Invitations do not send real email | **Closed in code** — Resend/Postmark providers, `MailDelivery` rows, resend with throttle | `lib/mail/`, `tests/integration/mail/mail-delivery.test.ts`. Live delivery needs a provider key: not verified |
| Password reset does not send real email | **Closed in code**, same provider path | `tests/integration/auth/password-reset.test.ts`. Live delivery not verified |
| Login/reset/invite abuse not rate-limited | **Closed** — PostgreSQL-backed throttles shared across instances | `tests/integration/security/throttle.test.ts`, guard "account flows are throttled" |
| Known cross-company leak | **None known** | Registry matrices for all 39 record types (`tests/api/records/record-parent-matrix.test.ts`), collaboration/version/review/notification IDOR tests |
| Comment/mention/watch authorisation bypass | **None known** | `tests/api/collaboration/collaboration-service.test.ts` (16), collaboration parent matrix |
| Document parent registry inconsistent | **Closed** — one registry drives read, upload, UI and return routes | `lib/core/records/`, document parent matrix; the HSE incident-photo leak through the project branch is fixed |
| Task module-origin context lost | **Closed** — trusted parent via the registry; Sales keeps its lead/opportunity | `tests/api/tasks/tasks-service.test.ts`, E2E "Sales raises a follow-up task" |
| Notification bell placeholder | **Closed** — real bell, centre, preferences, re-authorising deep links | E2E workflows + 16-role acceptance |
| Notification worker not scheduled/deployed | **Closed in code** — `pnpm worker` with per-job leases and heartbeats | `docs/runbooks/workers.md`, lease tests. Deploying it is an operator step |
| Attention has no real producers | **Closed** — ten conditions, reconciled every 5 min, resolved on the spot | `tests/api/notifications/attention-reconcile.test.ts`, E2E dashboard flow |
| Topbar search disabled | **Closed** — palette on `/api/search`, keyboard navigable | E2E search flows (including the Viewer seeing nothing from Finance) |
| Production storage public or incomplete | **Unchanged from §6** — private S3 driver exists; no deployed bucket verified | — |
| Malware scanner required but absent | **Closed in code** — ClamAV over clamd INSTREAM, fails closed; EICAR refused in production | `tests/unit/storage/clamav-scanner.test.ts`, guard "the malware scanner is real and fails closed". No live clamd verified |
| Build depends on live external fonts | **Closed** — Geist and Instrument Serif self-hosted via `next/font/local` | `lib/fonts/`, guard "fonts are self-hosted" |
| Restore drill failed | **Not performed** (still §6 gate 2) | — |
| 16-role critical suite failed | **Passing** | `tests/e2e/roles/role-acceptance.spec.ts` (16 roles) + `role-navigation.spec.ts` |

### 10.2 Readiness matrix (§180)

| Area | Required state | State |
|---|---|---|
| Email | Real provider working | Code complete; needs provider credentials to verify |
| Invites | Delivered and resend works | Code complete and tested with the memory provider |
| Password reset | Delivered and rate-limited | Code complete and tested |
| Collaboration | Comments, mentions, subscriptions | **Done** — 31 record pages carry the discussion panel |
| Tasks | Collaboration, attachments, parent context | **Done** |
| Documents | Unified parents, versions, review | **Done** |
| Notifications | Real UI and deployed worker | **Done** in code; worker deployment is operational |
| Attention | Real producers and resolution | **Done** |
| Search | Topbar connected to existing backend | **Done** |
| Storage | Private production bucket | Not verified (no staging) |
| Scanner | Production scanner active | Adapter done; not verified against a live clamd |
| Workers | Scheduled/deployed/observable | Observable (`--status`, readiness, metrics); deployment is operational |
| Roles | 16-role acceptance passes | **Passing** |
| Security | Auth/collaboration/document tests pass | **Passing** |
| Recovery | Restore drill passes | **Not performed** |
| Build | Reproducible production build | **Done** — no network fetch during build |

### 10.3 Weighted readiness (§181)

| Area | Status | Notes |
|---|---|---|
| Accounts | DONE (code) / BLOCKED (live mail) | Everything but a real provider key |
| Collaboration | DONE | Goods receipts and obligations are discussed on their parent order/contract, which have no page of their own per record |
| Tasks | DONE | |
| Documents | DONE | Version upload is single-PUT like first upload (multipart remains the §8 limitation) |
| Notifications | DONE | Email copies depend on the mail provider |
| Attention | DONE | |
| Search | DONE | |
| Security | DONE | Dependency scanner still absent (§6 gate 3) |
| Production infrastructure | PARTIAL | Code, runbooks and guards done; staging, bucket, clamd, backups are deployment work |
| 16-role acceptance | DONE | |

### 10.4 What changed in the earlier sections

- §5 item 3 (topbar palette placeholder): **closed**.
- §5 item 4 (`--color-surface-2`): fixed on the document pages this work touched; the remaining pages belong to the design workstream.
- §8: *document versioning* is no longer absent; the *antivirus engine* row is superseded by the ClamAV adapter; *company creation flow* is now `pnpm company:bootstrap`.
- §9: "`notifications:dispatch` and `storage:maintenance` scheduled" is replaced by "`pnpm worker` deployed per `docs/runbooks/workers.md`", with `WORKER_RETENTION_APPLY` left off until the retention dry run is reviewed.

### 10.5 Recommendation for PRD #38

**CONDITIONAL GO**, unchanged in kind from §7. Every §132 blocker that code can
close is closed and tested. What remains is operational and cannot be proven from
this repository: a live mail provider, a deployed private bucket and clamd, the
deployed worker processes, a staging environment, and the restore drill.

---

## 11. PRD #47 — Authorization & Company Isolation Hardening

The authorization chain of §275 — context → active member → active company →
module → permission → scope → record → state — is now one contract with one
implementation, documented in `docs/security/authorization-model.md`, and
enforced by gates rather than by review habit.

### 11.1 What is enforced now

| Area | Position |
|---|---|
| UserContext | One resolver, re-read from the database on every request; an inactive user, membership or company yields no context at all, so suspension takes effect on the next request (§264) |
| Company isolation | Every business query starts from `companyId`; linked ids in request bodies are resolved against the caller's company and project through `lib/access/references.ts` (§265) |
| Module activation | Folded into the context: a disabled module's permissions are not held, so routes, providers, search, calendar, reporting and counts all exclude it (§266) |
| Permissions | Permission keys only; the eleven places a role name still decides something are listed, reviewed and gate-enforced (§267) |
| Scopes | Applied in the database by shared builders; filters may only narrow (§268) |
| Record access | The record registry resolves module + permission + scoped load; parent-inherited records use their parent (§269) |
| Documents | Filing-module document grants are required on top of reaching the module (§270) |
| State | Domain services own transitions and answer 409 (§85, §86) |
| Errors | 404 for anything out of scope; internal reason codes, denial counters and a security log that carries no record content (§116-§119, §224) |
| Workers | `SystemContext`: one company at a time, named job, correlation id (§92-§94) |

### 11.2 Evidence

| Check | Result |
|---|---|
| `pnpm test:security` | 25 passed, 1 skipped (the destructive suite) |
| Cross-company sweep, both directions | ~900 calls each; no 2xx, no foreign identifier in any response, no row changed in the other company |
| Project isolation sweep | every route and action of the narrow-scope modules, against other projects' records |
| Module-disabled suite | routes, providers, search, calendar and counts absent |
| Session lifecycle | no session, suspended membership, suspended company all refused with the right code and counter |
| `pnpm test:security:links` | 55 write endpoints, 21 link fields poisoned with another company's ids; none taken up |
| `pnpm verify:company-integrity` | no row in any table references another company's record |
| `pnpm verify:authorization` | 464 routes, 322 server actions, role checks, request schemas, by-id ratchet — clean |
| `pnpm security:matrix --check` | 830 endpoints inventoried; none company-scoped with no check on its path |
| Full vitest | 2 007 passed, 7 skipped, 113 files |

CI gains five gates: the two static ones, the isolation suites, the destructive
link suite and the integrity scan (the last two after E2E, since they write).

### 11.3 Defects found and fixed

Found by the sweeps rather than by reading: the announcement audience and
compliance paths that accepted another company's ids, filing-module document
grants that let a company-scoped reader reach another module's files, search
limits that were unbounded from the query string, and denial counters that
never moved because the reason code defaulted only for 404. Each has a test.

### 11.4 Limits, stated plainly

- Link poisoning covers the write endpoints whose valid body can be synthesized
  (55), not all of them; Company B's seed is thinner than Company A's, so some
  fields are exercised with an id of another kind.
- The `by-id` baseline (348 call sites) was reviewed in aggregate — every
  mutation sits behind a scoped load or runs in a system context — not site by
  site. It is a ratchet against growth; the suites are the behavioural proof.
- The API security matrix is static evidence: a check is on the path, not
  necessarily on every branch.

---

## 12. PRD #48 — Domain Ownership & Transaction Integrity

Every model now has one owning domain; every cross-domain change goes through
that owner's door, inside the caller's transaction where the two must commit
together. The contract is `docs/data-ownership.md`, what commits with what is
`docs/transaction-boundaries.md`, and which way the arrows point is
`docs/domain-dependencies.md`.

### 12.1 What is enforced now

| Area | Position |
|---|---|
| Ownership | 189 models, each with exactly one owner in `scripts/architecture/ownership.ts`; the gate fails on a model with no owner (§292) |
| Foreign mutation | Removed everywhere PRD #48 §293 names, and everywhere the audit found besides; what remains is four reviewed exceptions, three of them held to named columns (§10, §11, §105) |
| Layering | Nothing under `app/` writes: 464 routes and 322 server actions delegate to services (§108, §109) |
| Transaction boundaries | Cross-domain operations run through `runInTransaction`, which names the operation and retries only transient serialisation failures (§21, §124, §176) |
| Atomicity | The four two-phase handoffs that could leave an orphan — meeting, QA and HSE actions becoming tasks, and a purchase order's commitment — are single transactions (§22, §143, §145) |
| Idempotency | One commitment per source record, behind a unique index; one inventory receipt per delivery; approval decisions keyed by `Idempotency-Key`; publish and submit transitions conditional on the state they were read in (§39-§44) |
| Concurrency | Conditional status writes, `expectedVersion`, `FOR UPDATE` on every allocated counter (§45-§52) |
| Cascades | No cascade delete reaches from one domain's records into another's history; the five that cross a domain line are configuration, not history, and each is recorded with its reason (§130, §131) |
| Dependency cycles | Six pairs, each named and explained; a seventh fails CI (§155, §156, §270) |
| Metrics | `transaction_success_total`, `transaction_failure_total`, `transaction_retry_total`, `conflict_total`, labelled by operation (§180-§182) |

### 12.2 Evidence

| Check | Result |
|---|---|
| `pnpm verify:ownership` | 189 models owned, 734 write sites in 1 522 files, 464 routes writing none, no new dependency cycle, no unreviewed cross-domain cascade |
| `pnpm test:architecture` | 11 passed — the gate, plus a named test for each drift §293 lists |
| `pnpm test:transactions` | 11 passed against the real database: rollback after an injected failure, idempotency, a concurrent race for one source record, ten simultaneous number allocations, a rolled-back allocation, two concurrent transitions |
| Bulk write audit | 233 `updateMany`/`deleteMany` calls, every one bound by a company, an id, a parent id already authorised, or a platform policy |
| Raw SQL inventory | 16 statements, all parameterised; 12 row locks, 7 `ON CONFLICT` upserts, 4 DMMF-driven integrity-scan statements |
| Full vitest | 2 029 passed, 7 skipped, 116 files |

CI gains three gates after the security suites: the ownership gate, the
architecture tests and the transaction integrity tests.

### 12.3 Defects found and fixed

The audit found eleven domains writing another's tables. Five were the drifts
the PRD predicted — Procurement into Finance's `Commitment`, Meetings into
`Task`, Engineering into `Document`, and four modules each into `AttentionItem`
and `IntegrationLink`. Six it did not: Meetings writing calendar reminders,
Timesheets moving approval routing rows, Finance writing company settings and
the configuration version, Account and Team deleting sessions and setting
password hashes, and the invitation flow creating a `User` and an `Activity`
row by hand. Each is now a door on the owner's side that takes the caller's
transaction.

Two real defects came with them. Three action-to-task conversions created the
task in one transaction and linked it in another, so a lost race left a task
nobody had asked for — the meeting case even had a compensating archive written
for it, which is the shape of a missing transaction boundary. And `Commitment`
had no unique constraint on its source record: the handoff was idempotent
because the caller remembered, not because the database refused.

### 12.4 Limits, stated plainly

- The write scan is syntactic. It reads `<client>.<model>.<op>(…)`, which is
  how every write in this repository is spelled, but a write assembled
  dynamically would not be seen. Nothing in `lib/` does that today.
- Field-scoped exceptions are checked against the columns a call names
  literally. A call that spreads a computed object into `data` cannot be
  checked that way, and the gate fails it rather than guessing.
- The six dependency cycles are recorded, not removed. Three are leaf helpers
  that could be moved to a neutral module; two are handoffs that genuinely run
  both ways and should stay. None can produce a wrong number.
- `runInTransaction` is adopted on the cross-domain operations, not on all 517
  transactions. The rest are single-domain and already atomic; what they lack
  is the named metric, not the boundary.

---

## 13. PRD #49 — Documents, Audit & State Integrity

The foundation is in place and eight domains are on it. A controlled record now
moves by a declared transition, and the state it moves from is part of the
write rather than an `if` above it. The contract is `docs/state-machines.md`;
`docs/document-lifecycle.md` and `docs/audit-model.md` write down what was
already built by PRDs #13, #28 and #29 and had never been stated in one place.

### 13.1 What is enforced

| Gate | What it refuses |
|---|---|
| `pnpm verify:state` | A machine governing a model its domain does not own; a machine file nothing registers; any file gaining a state write that does not name a state column in its `where`; any file gaining a write on a stateful model whose payload the gate cannot read and whose `where` names no state. |
| `pnpm test:architecture` | The same rules from the test runner, a named test for each claim the machines make about the code, and the transition matrix: every action of every registered machine, from every state, with and without its permissions and its reason. |
| `pnpm test:state` | A guarded transition against the real database: the stale case, the simultaneous case, the foreign-company case, the replay, a destination the machine does not declare, and an approval step standing in for the permission only when this actor decided it. |

### 13.2 The evidence

Full vitest 2 077 passed. Seven machines over 43 transitions. 122 guarded state
writes; 176 blind ones recorded in `scripts/architecture/blind-state-writes.baseline.json`,
which the gate lets fall and never rise. The API security matrix regenerated
byte-identical, which is the result worth having: the transitions were
rewritten without moving the security surface an inch.

### 13.3 What the audit found

Of 423 writes to a state column, 223 named no state in their `where`. Most were
not wrong so much as unprotected: the service read the record, checked the move
was legal, and then wrote by id — correct until two people act at once, because
Postgres takes no lock on a plain read. HSE's inspections were the clearest
case. Two people pressing *Start* on the same inspection both passed the check
and both wrote, and the second silently took over `executedByMemberId` and
`inspectionDate`.

Three domains were already doing it properly and needed nothing: procurement's
purchase orders bind `status: existing.status`, daily logs bind the status and
the row version, and the document storage worker binds `storageStatus` before
writing `scanStatus` — which is what stops a scan finishing after an archive
from resurrecting the file.

### 13.4 Limits, stated plainly

- **Eight domains of about twenty are on machines.** HSE and QA/QC first,
  because a lost transition on a safety or quality record loses the evidence
  that something was dealt with; then Documents, Finance, Procurement,
  Inventory, Legal and Engineering (§13.5). Everything else still transitions
  through its own service, held by the ratchet rather than converted. The
  baseline is the backlog: 96 writes across 33 files, plus 20 writes whose
  payload the gate cannot read.
- **`applyTransition` reaches its table through a delegate name**, which PRD
  #48's ownership scanner cannot see. The registry plus the first gate rule is
  what puts those writes back under the ownership rule; without both, a domain
  could use a machine to write another domain's table unnoticed.
- **The permission on a transition is the floor, not the whole gate.** Services
  keep their own richer checks — self-approval rules, approval guards — and
  those are not expressed in the machine.
- **Audit and document integrity were largely already true.** §68-§88 and most
  of §9-§53 describe what PRDs #13, #28, #29 and #47 built; this PRD verified
  and documented them rather than changing them. The claims in those two
  documents were each checked against the code, not carried over from the PRD.
- **Reason text is validated, not placed.** `requiresReason` refuses a blank
  reason; which column it lands in is the owner service's business, because
  domains store it under different names.

### 13.5 The second pass — the high-risk domains

Documents, Finance, Procurement, Inventory, Legal and Engineering were moved
onto machines: 32 of them over 156 transitions, 39 over 199 in all. None of
those six domains has a blind state write left, and none is in either baseline.

The contract grew three things, each because a domain needed it rather than in
anticipation:

- **Several permissions, any one of which will do** — Finance approves on the
  record's own permission or the module-wide decide permission.
- **Several destinations, when the record decides which** — restoring from the
  archive, and an order that a receipt leaves partly or wholly received.
- **An approval step standing in for the permission** — a purchase order's
  chain is concluded by whoever holds its last step, who may hold no order
  permission at all. The step id is checked against the step row, in the same
  transaction, as decided by this actor; it is a claim the database checks,
  not a switch.

Converting the writes found real defects, not just unguarded ones:

- **Two reviewers approving a document version's last two requests at once**
  each saw the other outstanding, and the version stayed in review with every
  request approved. Decisions on one version now queue behind a row lock.
- **A double-submitted upload completion** counted the bytes against the
  quota twice; **a failing or cancelled upload deleted the file before its
  database write**, so it could delete a file a parallel completion had just
  made available. Every upload path now claims its session first, and deletes
  only after the claim commits.
- **Promoting a version could write `AVAILABLE` over an archived document**,
  making its file downloadable again.
- **An engineering document or submittal voided while a reviewer had it open
  could be set back to `APPROVED`.** The parent write was blind, and invisible
  to the scanner because its table was chosen at runtime.
- **Expiring reservations released the hold before the guarded write**, so a
  race with a manual release gave the stock back twice. Posting a stock issue
  also fulfilled a reservation whatever its state — a path nothing reaches
  yet, since no issue line is linked to a reservation.
- **Editing a supplier while somebody archived it** reset its status to
  active while `archivedAt` stayed set.
- **A second *mark sent* on an invoice** overwrote `sentAt` and logged a
  duplicate activity.

Error behaviour changed only for the loser of a race and for moves that had no
domain-specific pre-check: those now answer `<MACHINE>_STALE` or
`<MACHINE>_ILLEGAL_TRANSITION` as 409, in place of a mix of `STALE_RECORD`,
`INVALID_TRANSITION`, uncoded conflicts and — in Legal — a 400. Every
pre-check code a test or a screen reads (`RFI_NOT_ANSWERED`,
`ORDER_HAS_RECEIPTS`, `REVIEW_ALREADY_DECIDED`, …) is unchanged.

Full vitest 2 890 passed, 7 skipped; Playwright 397 passed against a production build.

The API security matrix changed in one column only: 173 endpoints' state-guard
evidence now names `applyTransition` or `canMove`. No endpoint lost state
evidence, 64 gained it, and permissions, scope and record guards are identical.

**Limits of the second pass.**

- The document storage pipeline, approval cycle rows, enquiry invitations and
  the commitment writes Procurement makes through Finance's door are guarded
  on the state they read but are not machines; `docs/state-machines.md` says
  why for each.
- Legal's approvals need `legal.approval.decide` *and* the record permission;
  a transition says "any of", so the machine names the record permission and
  the service still checks both.
- Two stock issues drawing on one partly fulfilled reservation can still lose
  an update to its fulfilled quantity — the state does not change, so a state
  guard cannot see it. Nothing links an issue line to a reservation yet.
- A crash between an upload's claim and its file delete now leaves an orphaned
  object for the cleanup worker, where before a crash could delete a live file.

---

## 14. PRD #50 — Local authentication (package 4A)

V0.1 signs in with a username and a password. Email is contact metadata that
nothing authenticates by, and no flow requires mail to be delivered — not
sign-in, not account recovery, not startup. `docs/authentication-local.md` is
the contract, with `docs/session-security.md` and
`docs/account-administration.md` beside it.

### 14.1 What changed

| Before | Now |
|---|---|
| Sign in with an email address | Sign in with `username`, normalised trim/NFKC/lowercase |
| `User.email` required and unique | `User.username` required and unique; `email` optional |
| Forgotten password → emailed reset link | Forgotten password → contact your administrator |
| `/reset-password` token page | Removed, route and template with it |
| — | Temporary passwords with a 72-hour expiry and a forced change |
| — | `team.member.password.reset`: temporary password, forced change, all sessions revoked |

Migration `20260916160000_user_username_identity` is expand-and-contract: the
column arrives nullable, is backfilled from the address people already signed in
with, is de-duplicated deterministically, and only then becomes required and
unique. It was replayed from zero into an empty database and applied to a
restored copy of the development database before it went near the real one; all
25 accounts kept a username matching the name they knew.

### 14.2 The evidence

Full vitest 2 106 passed. `pnpm test:auth` covers 65 of those directly:
username normalisation including homograph folding, the shape and reserved-name
rules, sign-in by username, refusal of the address as an identifier, an account
with **no** email signing in exactly like any other, temporary-password expiry,
and administrator reset — that it revokes every session, invalidates the old
password, and writes an audit record containing neither the password nor its
hash.

The by-id authorization baseline fell 340 → 300, mostly from PRD #49's
transitions now binding `companyId`.

### 14.3 Limits, stated plainly

- **This is package 4A of seven.** 4B (session lifecycle hardening), 4C
  (internal account creation replacing the invitation flow), 4D (workers), 4E
  (migrations), 4F (production security) and 4G (health and operations) are not
  done. PRD #50 is a 339-section document and this is the identity change at
  the front of it.
- **Invitations still exist and still key on an email address.** §58 replaces
  them with an administrator creating the account directly and handing over a
  temporary password. Until that lands, an invited account gets a username
  derived from the person's name and the invitation still carries an address.
  Nothing *requires* the mail to arrive — the invite link works without it —
  but the flow is not yet the one §58 describes.
- **Reserved usernames govern what may be chosen, not what already exists.**
  The demo company's administrator was migrated as `admin`, which is on the
  reserved list. Enforcing it retroactively would have renamed a live account
  to satisfy a rule about new ones.
- **bcrypt, not Argon2id.** §10 names Argon2id as preferred. bcrypt at cost 12
  is used because it needs no native build step; the hash is behind one module
  and swapping it changes only that file.
- **Password history and rotation (§14, §15) are not implemented.** Nothing
  stops somebody reusing their previous password.

---

## 15. PRD #51 — Workers & scheduled jobs

Background work is one mechanism now: twenty jobs in one registry
(`lib/core/jobs/job.registry.ts`), run by `pnpm worker` through a lease, each
with an owner, a company scope, an idempotency key, a retry policy, a timeout
and a criticality. `docs/workers.md` is the contract,
`docs/worker-operations.md` the runbook, and `docs/worker-matrix.md` — generated
from the registry, checked by CI — the inventory.

### 15.1 What changed

| Before | Now |
|---|---|
| A job lease with no extension; a long run could be taken over mid-run | Lease extended every third of its length; a worker that loses it stops |
| No timeout; shutdown finished the whole pass | Per-job timeout and shutdown abort the run; a handler that ignores it is abandoned with its lease left to expire; shutdown bounded by `WORKER_SHUTDOWN_TIMEOUT_SECONDS` |
| A failed job retried after its interval, silently | Exponential backoff with jitter, classified errors, `failed` after `maxAttempts`, every attempt kept in `job_failures` |
| Raw SQL compared against bare `now()` | `DB_NOW` everywhere: the database runs in Europe/Tirane while columns hold UTC, so jobs were due every tick and leases lasted two hours |
| An outbox event could fail forever at the front of the queue | Attempt counted at claim; permanent errors fail at once; a worker dying on the last attempt fails it as `LEASE_EXPIRED`; operator retry keeps the history |
| "Already notified?" by counting outbox rows, outside the transaction | `job_idempotency_keys`, claimed inside the transaction that enqueues — race-free, and not forgotten when the outbox is purged |
| `take: 500` / `take: 2000` caps, most with no order, across the jobs | Every job walks its work by cursor in bounded batches; nothing true is silently dropped |
| Company loops in some jobs, global queries in others | Every business job through `forEachCompany`: active companies, module switches honoured, one company's failure isolated |
| Readiness said `ok` when a group had never been deployed | Worker processes heartbeat; health is HEALTHY / DEGRADED / UNHEALTHY by criticality; metrics and alert rules (`ops/alerts/workers.yml`) |
| Mail provider required in production | `MAIL_DELIVERY=disabled`: in-app notifications need no email |

Migrations `20260916180000_workers_hardening_prd_51`,
`20260916181000_scan_attempts_prd_51` and
`20260916200000_scan_queue_index_prd_51` are additive; each was replayed from
zero into an empty database before it was applied here.

### 15.2 Defects the audit found, and what happened to them

No P0. Every P1 is fixed:

- **attention.reconcile** capped every condition at 500 unordered rows and then
  resolved active items beyond the cut — true conditions flipped between active
  and resolved. It now reads every condition to the end and resolves only items a
  complete pass did not see; a dismissal made during a pass stays dismissed.
- **notifications.due** re-selected yesterday's tasks on every hourly run (~24
  outbox rows per item per day) in one transaction across all companies.
- **approvals.overdue** keyed a document review by document, so only the first of
  several reviewers was ever reminded.
- **calendar.reminders** read at most 2 000 events and 2 000 meetings across the
  deployment every minute; reminders beyond that never fired. One malformed
  recurrence rule failed every run.
- **meetings.series**: one failing series ended the pass and was first again next
  time; a "this and later" cancel racing the job could be followed by new
  occurrences. Generated meetings are now audited as the system.
- **announcements** published and reminded in suspended companies, swallowed
  per-row errors, and returned expired schedules to draft without the required
  audit.
- **timesheets.reminders**: one company's exception stopped every later company.
- **documents.scan** left a file `SCANNING` for ever when a worker or request died
  mid-scan, retried scanner errors every 15 seconds for ever, and could make an
  older version current again after a newer one.
- **storage.cleanup** wedged on a placeholder a draft engineering revision still
  referenced: every run threw at the same row, after deleting its object.
- **Shutdown** finished the whole pass; **readiness** ignored a group with no
  worker at all.

Found while fixing them: the throttle stored window ends two hours late on this
database (retry hints two hours too long) and purged by the worker's clock;
retention declared a batch size it never used; dispatch counted events whose
lease another worker had taken; a scan-failed file told its uploader the file
"did not arrive".

### 15.3 The evidence

Full vitest 3 109 passed (7 skipped: the destructive suites). Of those:

- **Contract tests, 176 in 20 files** (`tests/api/jobs/<job>.test.ts`): for every
  job idempotency and failure isolation; for every company-scoped job company
  isolation and the suspended-company rule; for every CRITICAL, HIGH and outbox job
  concurrency. `pnpm verify:workers` fails CI if a job lacks one.
- **Runner, 21**: one claim at a time, crash takeover recorded, lease extension and
  loss, timeout honoured and abandoned, backoff and jitter bounds, max attempts,
  dry run leaving the schedule alone, `--company` scoping, shutdown releasing the
  job in hand, an old and a new release overlapping.
- Several agents broke their own fixes on purpose — the version check, the lease
  clause, the cancel lock, the claim result, the status guard — and the matching
  tests failed each time.

Gates: `verify:workers`, `verify:ownership`, `verify:state` (blind state writes
96 → 92), `verify:authorization`, `security:matrix --check`,
`verify:production-guards`, typecheck and lint all pass. The by-id baseline was
re-recorded at 249 (from 300); most of that fall is PRD #49's second pass, which
had not been recorded, and it rose by one where dispatch reads a company's status
by its own id.

### 15.4 Limits, stated plainly

- **Nothing here has run as a deployed worker.** The processes, the alert rules and
  the metrics scrape are operational steps; `docs/worker-operations.md` says how.
- **No operations UI.** Failed jobs are visible through `pnpm worker --status`,
  `--failures`, metrics and logs; retry and manual runs are CLI, authorised by
  access to the worker's shell and recorded with the operator's name (§40, §42).
  No manual cancel (§41, optional).
- **Overdue badges in module pages still count days in UTC**
  (contracts, obligations, procurement, inventory status helpers), while the
  attention items and reminders now use the company's day. Near midnight a badge
  and its attention item can disagree by one day.
- **Compliance `MISSING` is not derived from evidence** (§79, §80): the model has no
  "evidence required" field, and inventing the state would be worse than leaving it
  a person's decision.
- **Engineering submit/issue does not take the document row lock**, so the check
  that a file is not frozen narrows the race with a version promotion rather than
  closing it.
- **A record overdue for more than 400 days is reminded once more** when retention
  purges its ledger row.
- **A suspended company's outbox events are dropped, not held** until reactivation.
- **The throttle's lockout decision still reads the app server's clock** against a
  window the database wrote; it matters only with clock drift larger than the time
  left in a window.

### 15.5 Go-live checklist, amended

§9's "`notifications:dispatch` and `storage:maintenance` scheduled" and
"`retention.ts` scheduled" become:

- [ ] `pnpm worker --group=notifications`, `--group=documents`, `--group=scheduled`
      running under a process manager, with `pnpm worker --health` as the healthcheck
- [ ] `ops/alerts/workers.yml` loaded; `WorkerGroupDown` seen to fire and clear
- [ ] `pnpm retention:dry-run` reviewed before `WORKER_RETENTION_APPLY=true`

---

## 16. Enhancement E-05A — Projects page, discovery and multi-company access

`/projects` is one collection of every project a person may open, in every
company they belong to: a 3:4 cover gallery (or a list), favorites first, then
the most recently active work, searchable and filterable, with the managing
company named on every card. Opening a project in another company moves the
session there. `docs/projects-page.md` is the contract.

### 16.1 What changed

| Before | Now |
|---|---|
| Projects: Overview, All Projects, My Projects, Milestones, Archived | Projects (the gallery), Milestones, Archived; the two old lists redirect |
| One company per session, no way to reach another membership | Opening a project in another of your companies moves the session, by POST, audited as `COMPANY_CONTEXT_SWITCHED` |
| Status DRAFT / ACTIVE / ON_HOLD / COMPLETED / ARCHIVED, set on the edit form under `project.update` | PENDING / ACTIVE / FINISHED / ARCHIVED on a state machine, under `project.status.manage` |
| Admin could only view projects; a Project Manager could create them | Admin creates, edits and moves status in its company; a Project Manager no longer creates |
| No project type, cover or activity marker | `projectType` (code list), `coverImageDocumentId` (a document, thumbnailed), `lastActivityAt` (moved by the activity recorder) |
| No thumbnails anywhere | 600×800 WEBP thumbnails built on first request with `sharp`, behind the download gate |
| Project writes: 6 blind state writes | 1; archive, restore and every status move go through `applyTransition` |

Migration `20260916210000_projects_page_e05a` maps the enum explicitly (DRAFT →
PENDING, ON_HOLD → ACTIVE, COMPLETED → FINISHED, the same for
`preArchiveStatus`), adds the three columns, backfills `lastActivityAt` from
each project's newest activity, and adds `AuthEventType.COMPANY_CONTEXT_SWITCHED`.
It was replayed from zero into an empty database with no drift, and applied to a
restored copy of the development database before the real one: both on-hold
rows, one of them the archived project's pre-archive status, became Active.
The ON_HOLD mapping and the permission changes were decided with the product
owner.

### 16.2 The evidence

Full vitest 3 182 passed, 0 failed (9 skipped: the destructive and opt-in
suites). Of those:

- `tests/api/projects/portfolio.test.ts`, 26 tests: the multi-company person
  sees exactly their assigned project in each company from either session;
  filter options never name a company, role or place outside the person's
  projects; search and a company filter cannot widen scope; opening moves the
  session and records the event, and a project the person cannot open moves
  nothing; §65's ordering exactly, with a one-card cursor walk across the
  favorites boundary; each filter and their AND; favorites per person; card
  permissions decided in the project's company; a cover hidden from a reader who
  cannot open its document and a 600×800 thumbnail for one who can; status by
  the Project Manager on their project, refused on another and for the
  Architect, the correction's reason, the audit's before and after; two
  simultaneous moves, one refused; creation Pending by default, refused for the
  Project Manager and in a company named in the body, and accepted in the second
  company of somebody who may create in both; the activity marker leaving
  `updatedAt` alone.
- Both security sweeps (`cross-company-api`, `project-isolation`) cover the new
  routes by discovery; the first run found the open endpoint answering 500 when
  called outside Next's request scope, fixed before this record.
- E2E against the production build: 409 passed after one pre-existing ordering
  assumption in `hse.spec.ts` was fixed — a re-seed leaves HZ-2026-0001 on the
  hazard list's second page, and the test now searches for it.
- `tests/perf/projects-page.perf.test.ts`: first page, ten cursors deep, filtered
  and filter options all ~15 ms at P95 locally for 600 visible projects in a
  table of 5,600; query count independent of page size.
- Gates: typecheck, lint (0 errors, 16 pre-existing warnings),
  `verify:state` (blind state writes 92 → 87), `verify:ownership`,
  `verify:authorization` (one reviewed schema exception: `companyId` on the
  Projects schemas, a filter and a re-checked create target),
  `security:matrix --check` (834 endpoints), `verify:production-guards`,
  `verify:workers`.

### 16.3 Limits, stated plainly

- **A session is in one company at a time.** Opening a project elsewhere moves
  every open tab with it; a stale form from the old company fails closed.
- **The sidebar belongs to the session's company.** Somebody whose session is in
  a company where they cannot open projects reaches the page by URL, not from
  that company's sidebar. Sign-in still lands in the oldest active membership.
- **Covers are chosen from the project's documents on the edit page**, not
  uploaded from the page or the create form.
- **Project codes are typed**; project types are a code list, not a
  company-editable taxonomy.
- **Archived projects are not on the page** and there is no Archived filter yet;
  they remain on Archived in the session's company.
- **No Parent Group Owner or Architecture Manager role exists**, so E-05A's rows
  for them describe future policy, not behaviour.
- **A Project Manager can no longer convert a won deal into a new project** —
  a consequence of E-05A §29's defaults, accepted.
- **The development server needs a restart** after this migration and
  `prisma generate`: a running server keeps the old enum in its client.

### 16.4 The final PRD

The PRD was reissued as *E-05A — Projects Page & Project Discovery (FINAL)*,
with its sections renumbered. Held against the build above, most of it was
already met; these were not, and now are (final PRD numbers):

| Final PRD | Before | Now |
|---|---|---|
| §30, §62 Project Type configurable, not a construction-only enum | `projectType`, a key from a code list | `ProjectType` rows per company, kept at Projects → Project types under `project.type.manage` (Owner, Admin); retired rather than deleted when used |
| §13 Project Type required on create | optional | required by the create schema, checked against the chosen company's types in use |
| §56 Multiple project roles | first role only | *Lead Architect +1* on the card and in the list |
| §32 Clear Filters also for a non-default sort; removable filter chips | a single Clear filters button, sort not counted | a chip per active value, each removing itself, sort included |
| §53 Result count while filtered | only near Load more | *N results* beside the chips |
| §38, §39 Phone sheet with Sort, Reset and Apply | filters applied on every choice; sort outside | filters and sort staged in the sheet, applied together |
| §76 Error state | the application-wide error page | *Projects could not be loaded.* with Retry, inside the shell |
| §61 `[status, lastActivityAt]` index | absent | added |

Migration `20260917090000_project_types_e05a` creates `project_types`, writes
the eight defaults for every company, points each project at its company's row
(RESIDENTIAL → Residential, MIXED_USE → Mixed use, …) and only then drops the
old column. It was applied to a restored copy of the development database
first — all eight typed projects kept their type, the untyped one stayed
untyped — and replayed from zero with no drift. New companies get the defaults
from `bootstrapCompany`; a rerun never restores a type that was removed.

**Evidence.** Full vitest: 3 193 passed, 1 failed — the Albanian site copy
lacked the new *Project types* tab label; added, and that file re-run green.
New: `tests/api/projects/project-types.test.ts` (7 tests), and in
`portfolio.test.ts` *Role +1*, a type name filtered and searched across two
companies' lists, a type checked against the chosen company and retirement, a
code once per company, and a role granted `project.create` creating without
gaining the status (§104, §105). E2E against the production build: 410 passed,
1 failed — a `getByLabel("Sort")` that now also matched the sort chip's
*Remove Sort: …*; made exact, and the Projects, multi-company and mobile specs
re-run: 56 passed. The demo seed re-runs cleanly. Gates: typecheck, lint
(0 errors), `verify:ownership`, `verify:authorization`, `verify:state`,
`security:matrix --check` (839 endpoints), `verify:production-guards`.

**Not done, on purpose.** A cover image on the create form (§13, optional): an
upload waits on the malware scan before it can be read, so it would show the
placeholder anyway; covers stay chosen on the edit page. Pending → Active uses
the same Change status dialog as every move (§94 allows lighter, does not
require it). Pages added with Load more are fetched again after Back rather
than kept (§52, "where practical"). NESTO still has no Parent Group or
Architecture Manager role; project types are per company.

The development server needs a restart after this migration too.

## 17. Enhancement E-05B — Project structure: buildings, floors and units

Every project can now hold buildings, floors and units, and each unit is one
row with one id and one page that Sales, Finance, Documents and the 3D explorer
will reference — never copy. Projects → a project → **Units** is the tree and
the unit table; `/projects/:id/units/:unitId` is the unit page; Projects →
**Unit types** is each company's own list. `docs/project-structure.md` is the
contract.

### 17.1 What changed

| Before | Now |
|---|---|
| No physical structure; nothing unit-like anywhere in the schema | `ProjectBuilding`, `ProjectFloor`, `ProjectUnit`, and per-company `ProjectUnitType` (ten defaults) |
| — | Derived `projectId`/`companyId` held to their parents by composite foreign keys: the database refuses a floor on another project's building, a unit on another project's floor, another company's unit type |
| — | Unit codes unique per project on a normalised key (`a-901` = `A-901`); floors unique per building on level type + number |
| — | Bulk floors by range, bulk units by code pattern, copy a floor: previewed with conflicts, then all or nothing, one audit event per batch |
| — | Moves keep ids: a unit to another floor of its project, a floor (with its units) to another building; code changes audited as `UNIT_CODE_CHANGED` |
| — | 13 permissions (`project.structure.*`, `project.building.*`, `project.floor.*`, `project.unit.*`, `project.unit_type.manage`); writes for Owner, Project Manager, Admin and Architect (assigned projects), reads for everyone who can open the project |
| Project tabs without structure | A **Units** tab on every project page and a **Units** card with counts on the overview |
| Security sweep could not build batch, copy or reorder bodies | `tests/security/harness/routes.ts` knows `ids`, `floors`, `units`, `defaults` and a floor `number`: 7 routes that stopped at 422 now reach the lookup they attack |

Migration `20260917120000_project_structure_e05b` is additive: four tables, four
enums, `projects (id, companyId)` unique, and every existing company's default
unit types. There was no legacy unit data to map (§143). It was replayed from
zero into an empty database, then applied to a restored copy of the development
database (three companies, ten types each) before the real one.

### 17.2 The evidence

Full vitest 3 260 passed, 0 failed (11 skipped: the destructive and opt-in
suites). Of those:

- New suites, 70 tests: `tests/unit/project-structure/rules.test.ts` (20),
  `tests/api/project-structure/structure.test.ts` (38 — every §146-§150 case,
  including every read-only role against 17 kinds of write, forged ids across
  companies and projects, and two batches racing for the same codes: one wins,
  the other is told, nothing partial), `unit-types.test.ts` (8),
  `company-bootstrap.test.ts` (4, extended).
- Security: `tests/security` 25 passed (the destructive link suite skips itself
  on `nesto_erp`); a sweep narrowed to the structure routes answers 404 on all
  29 foreign-id calls in both directions, with nothing left unvalidated.
- `tests/perf/project-structure.perf.test.ts` (`NESTO_PERF=1`), 10,000 units:
  P95 tree 10 ms, one floor 7 ms, filtered 30 ms, first page 157 ms, page 150
  182 ms, search 183 ms; the same number of queries for 10,000 units as for 126.
- E2E against the production build: the new desktop journey (building, floors
  by range, bulk units, a copied floor, a code change and a move keeping the
  URL, the breadcrumb back to the floor, Sales without actions, filters, a
  foreign unit 404) and the phone spec pass. Full suite: 414 passed, 2 failed —
  see 17.3.
- Gates: typecheck, lint (0 errors, the 16 pre-existing warnings),
  `verify:ownership` (197 models), `verify:authorization` (491 routes),
  `verify:state` (unchanged: 87 blind, 19 unreadable), `verify:production-guards`,
  `security:matrix --check` (866 endpoints, none unguarded).

### 17.3 Defects found

- **`projects.spec.ts` "remembers the list view" failed on the Turbopack
  production build** and passed on a webpack build of the same tree: after a
  reload React briefly parks a streamed copy of the list, and the spec's
  unscoped `getByTestId("project-list")` matched both. Scoped to `mainRegion`,
  as `tests/e2e/fixtures.ts` prescribes; passes three runs in a row.
- **Found, not fixed (E-05A, outside this scope):** `responsive/mobile.spec.ts`
  "moves filters and the sort into a sheet…" fails at 66ea2a9 as well — after
  Apply, the second tap on Filters does not open the sheet again.
- Caught before this record: a retired unit type of one's own company was logged
  as a cross-company refusal; a stale floor move into a clashing building said
  `FLOOR_TAKEN` instead of `STRUCTURE_STALE`; the unit-created audit recorded
  attributes as sent rather than as kept.

### 17.4 Limits, stated plainly

- **No commercial status** (§27): For Sale / Reserved / Sold belong to the Sales
  PRD, keyed by `unitId`, with a state machine.
- **Unit deletion is not reference-guarded** — nothing references a unit yet.
  The first module that does must make `deleteUnit` refuse and offer
  deactivation (§56).
- **Page-numbered pagination**, 50 a page; fine to 10,000 units as measured.
- **No import, copy building or typical floor** (§97, §99, §100); the batch
  services take drafts, so an import can call them.
- **No Parent Group Owner or Architecture Manager role**; their E-05B rows are
  policy for when they exist. Unit types are per company.
- **The development server needs a restart** after this migration and
  `prisma generate`: a running server has no client for the new models.

## 18. Enhancement E-05D — The unit page and publishing

Every unit now has the page E-05D describes — Overview, Documents, Media,
Publishing, Activity — and a publication lifecycle: an Architect prepares a unit
and submits it, a publisher approves it as an immutable version, and later edits
show as unpublished changes until the next version. Two roles arrived with it:
**Architecture Manager** and **Sales Manager**. `docs/unit-publishing.md` is the
contract.

### 18.1 What changed

| Before | Now |
|---|---|
| A unit page with technical data only | Overview (data by kind of unit, primary image, Sales Plan, readiness), Documents, Media, Publishing (reviewer view, history, each version's snapshot), Activity |
| No publishing state | `publicationStatus` on the unit, moved only by the new `unit_publication` machine (6 transitions): Draft → Ready for Publishing → Published, Revision Required with a reason, Unpublish with a reason, Archive and Restore |
| — | `UnitPublication`: numbered, immutable versions with a snapshot of the publish-relevant data and the exact Sales Plan and primary image versions |
| — | Unpublished changes computed from what a version would publish — an edit, a move, a floor moved to another building, a new Sales Plan version or primary image — and cleared by publishing or by putting the value back |
| No unit files | One logical Sales Plan per unit (new uploads are versions of it), technical documents attached by reference (a project drawing attached to many units without a copy), images with categories, captions, order and one primary — all canonical Documents; the unit is a registered document parent (`project_unit`) |
| — | Readiness checked on the page, at submission and again under the unit's row lock at publish; an incomplete unit is refused with what is missing |
| Approvals Center: 9 sources | A tenth, *Unit publishing* (`projects`): Approve publishes, Return is Revision Required |
| 16 roles | 18: **Architecture Manager** (the Architect's row on every project of the company, plus publishing and the approvals inbox; no project creation or status by default, per E-05A §8, §58) and **Sales Manager** (Sales' row, deciding proposals); demo users `architecture-manager` and `sales-manager`, codes renumbered 01–18 |
| — | 8 permissions: `project.unit.documents.manage`, `.media.manage`, `.submit_for_publish`, `.publish`, `.revision_request`, `.unpublish`, `.archive`, `.publication_history.view` |
| Units deleted freely | A unit with a version, files, media, links or a request is refused (`UNIT_REFERENCED`) and archived instead |
| Unit list without publication | A Publication column (and *Changed*) and filter; the phone card shows the badge |
| Edit dialog closed on any click outside | Asks before discarding unsaved changes, and warns on leaving the page |

Migration `20260917150000_unit_publishing_e05d` is additive: four tables, five
enums, seven columns on `project_units`, composite foreign keys holding every
publication, image and link to its unit's project and company and a unit's
current version to its own, and partial unique indexes for one primary image
and one open request per unit. Every existing unit starts Draft. It was replayed
from zero into an empty database before being applied.

### 18.2 The evidence

Full vitest 3 328 passed, 0 failed (11 skipped: the destructive and opt-in
suites). Of those:

- New suites: `tests/unit/project-structure/publishing-rules.test.ts` (14) and
  `tests/api/project-structure/unit-publishing.test.ts` (25 — readiness,
  versions with exact file versions, unpublished changes, two submitters and two
  publishers racing, revision and returned changes, unpublish, archive and
  restore, one logical Sales Plan, shared project drawings, media primary and the
  partial index, every role's capabilities, outsiders and Company B, the
  Approvals Center approving and returning).
- Security: `tests/security` passed; a sweep narrowed to `/api/project-units`
  answers 404 to all 34 foreign-id calls in both directions, nothing uncovered or
  unvalidated — the harness now resolves `linkId`, `mediaId` and `publicationId`
  to rows of their own unit.
- `pnpm verify:roles` against the production build: 1 363 of 1 363 checks for
  all 18 roles.
- Gates: typecheck, lint (0 errors, the 16 pre-existing warnings),
  `verify:ownership` (201 models), `verify:authorization` (509 routes),
  `verify:state` (41 machines, 211 transitions; 87 blind and 19 unreadable,
  unchanged), `verify:production-guards`, `security:matrix --check` (887
  endpoints, none unguarded).
- E2E against the production build: 423 passed, 1 failed. The new desktop
  journey (upload a Sales Plan and an image, submit, publish, an edit showing as
  unpublished changes while v1 keeps its area, Sales without actions, the
  not-ready explanation, the seeded states in the unit list), the E-05B
  structure journeys with the new unit page, and the phone spec pass. The one
  failure is `responsive/mobile.spec.ts` "moves filters and the sort into a
  sheet…", the E-05A defect §17.3 already recorded as failing before E-05B.

### 18.3 Defects found

- **E-05B's unit update spread a computed object into its write**, which the
  state gate could not read once units carried a state column; the columns are
  now spelled out.
- **The document thumbnail is a portrait cover crop**, which cut a landscape
  floor plan in half on the unit page; unit images now load whole through a
  preview grant, with the thumbnail as the placeholder.
- Caught before this record: a land unit's readiness label named an internal
  area land does not have; the media update's empty-body check ran before the
  unit's door, so the security sweep saw a 422 where a foreign id should be a
  404; the API test for concurrent submission had a second submitter who could
  not open the project, so it passed without racing.

### 18.4 Limits, stated plainly

- **No sales status**: For Sale, Reserved and Sold are E-05E, beside the
  publication status, never in it.
- **Publication requirements are fixed per kind of unit**; no project or company
  setting yet. No bulk submit or publish, no field diff between versions.
- **The stored unpublished-changes flag** trails a Sales Plan version the scan
  worker promotes later until the next write to the unit; the unit page
  recomputes it and is always right.
- **No Parent Group Owner role.** Unit types stay per company.
- **The development server needs a restart** after this migration and
  `prisma generate`, and the database needs `pnpm db:seed` (or
  `pnpm access:sync`) before anybody is given the two new roles.

## 19. Enhancement E-05E — Selling units: price, reservation and sale

Sales now works on the canonical units: a project's **Sales** tab lists them with
price, price per m², commercial status, client, deal and reservation expiry, and
each unit's page has a **Sales** section where a unit is priced, put on sale,
held, reserved for a client and deal (either created in the same form), extended,
released, marked Sold and — by a Sales Manager — reopened. Reservations expire on
their own. `docs/unit-sales.md` is the contract.

### 19.1 What changed

| Before | Now |
|---|---|
| A published unit with no commercial side | `UnitCommercialProfile` beside the unit: Not For Sale, For Sale, On Hold, Reserved, Sold, moved only by the new `unit_commercial` machine (9 transitions); asking price, currency, price basis, hold and notes |
| — | Price history on every change of price, currency or basis; price per m² derived, never stored, and filterable and sortable in the database |
| — | `UnitReservation` for a canonical Client and the CRM's Opportunity (the *Deal*), with expiry, agreed price, extensions, and a status that is never deleted; one active reservation per unit held by a partial unique index; the status history of every move |
| Opportunities with no units | `OpportunityUnit`: a deal holds units by id — an apartment, its parking and storage — each still reserved and released on its own; the deal page has a Units panel |
| — | Reserve creates the client (through the Clients service, offering a similar existing client back first) and the deal (through the Opportunities service) in the reservation's own transaction |
| — | Job `sales.unit-reservations` (every 5 min): expires reservations as the system and frees the unit; warns the salesperson and deal owner a day before |
| — | Notification category *Sales* with four events; 12 audit events; unit activity from Sales for readers who may see sales |
| — | 9 permissions `project.unit.sales.view`, `.sales_status.manage`, `.price.manage`, `.reserve`, `.reservation.extend`, `.reservation.release`, `.mark_sold`, `.reopen_sale`, `.sales_correct`; Sales acts, the Sales Manager also reopens and corrects, CEO, PM, Finance, Legal and Viewer read, Architecture and Engineering see only the status |
| A published unit could be unpublished or archived at any time | Not while it is on sale, held, reserved or sold (`UNIT_ON_SALE`); a unit with any sales history is not deleted |
| Unit header and list with publication only | The commercial status beside it, for everyone who can open the unit; a Sales column in the unit list |
| — | Settings → Sales (translated): reservation length, 1–90 days, default 7 |

Migration `20260917170000_unit_sales_e05e` is additive: six tables, four enums,
one settings column, composite foreign keys holding every row to its unit's
project and company, the partial unique index, and checks for non-negative prices,
an expiry after the reservation and the settings range. Every existing unit stays
Not For Sale. It was replayed from zero into an empty database before being
applied. E-05D's seed now also publishes A-201 to A-204, which the new seed sells.

### 19.2 The evidence

Full vitest: 3 400 passed, 1 failed, 11 skipped (the destructive and opt-in
suites). The failure was `tests/unit/permissions/settings-access.test.ts` finding
Settings → Sales visible to HR (§19.3); after the fix that file passes. Of those:

- New suites: `tests/unit/sales/unit-sales-rules.test.ts` (17 — price per m²,
  eligibility, the Sold check, the machine, validation, the role policy),
  `tests/api/sales/unit-sales.test.ts` (14 — price history, status and
  eligibility, reserving with existing and new client and deal, the duplicate
  client offered back, two people reserving at once, extend and release, a
  multi-unit deal, Sold and reopen, the expired-reservation guard, publishing and
  deletion guards, access by role and Company B, the inventory, the settings) and
  `tests/api/jobs/sales.unit-reservations.test.ts` (7 — idempotency, warning once
  per expiry date, an extension saved mid-run winning, overlapping runs, company
  isolation, suspended companies and Projects switched off, one failure rolling
  back alone).
- E-05D's `publishing-rules.test.ts` narrowed to the publishing grants.
- Security: `tests/security` passed; a sweep narrowed to the new routes makes 19
  calls each way and all 17 foreign-id calls answer 404, nothing uncovered or
  unvalidated. The harness now resolves `reservationId` and a deal's unit.
- `pnpm verify:roles` against the production build: 1 363 of 1 363 checks for all
  18 roles.
- Gates: typecheck, lint (0 errors, the 16 pre-existing warnings),
  `verify:ownership` (207 models), `verify:authorization` (521 routes),
  `verify:state` (42 machines, 220 transitions; 87 blind and 19 unreadable,
  unchanged), `verify:workers` (21 jobs, matrix regenerated),
  `verify:company-integrity`, `verify:production-guards`, `security:matrix
  --check` (902 endpoints, none unguarded).
- Migration: every migration replayed into an empty database, with no drift from
  the schema.
- Seed: `pnpm db:seed` twice in a row, validation passing (a unit in every
  commercial state, a deal holding two units, a Company B reservation).
- E2E against the production build: **429 passed, 0 failed**. The new desktop
  journeys (price, put on sale, reserve with a new client and deal, extend, sell;
  reopen, reserve for an existing client, release; the inventory's quick filter
  and search; a draft unit not offered; an Architect seeing only the status) and
  the phone spec pass, and so does `responsive/mobile.spec.ts` "moves filters and
  the sort into a sheet…", which §17.3 and §18.2 recorded as failing.

### 19.3 Defects found

- **Settings → Sales opened to HR.** The section was first gated on
  `company.settings.view`, which HR holds; the full suite's settings-access test
  caught it, and it is now behind `settings.manage` like every company section.
- **The reserve dialog did not scroll**: with a new client its Reserve button sat
  below a 720-pixel window and could not be reached. The sales dialogs now scroll
  within the viewport.
- **A reservation past its expiry could be marked Sold** in the minutes before the
  expiry job closes it. The Sold check now requires an unexpired reservation, and
  the page says *Expired — being released*.
- **A new client from the reserve form skipped the CRM's duplicate check.** It now
  offers the similar clients back and creates only on confirmation.
- **E-05D's role test** asserted that Sales holds no `project.unit.*` grant; it now
  excludes the selling grants, which E-05E's own policy test covers.
- **The long-running development server** on port 3000 predates the E-05D and
  E-05E migrations; its Prisma client lacks the new tables. Screens were checked on
  the production build instead.

### 19.4 Limits, stated plainly

- **The company Sold rule and the contract handoff are E-05F.** E-05E's Sold check
  is the reservation, client, deal and agreed price.
- **No currency conversion**; price filters compare amounts as numbers.
- **No bulk pricing, price lists or imports**; no unit picker on the deal page.
- **Expiry lags by up to one job interval**, treated as expired meanwhile.
- **Module pages are English**; Settings → Sales and the notification category are
  translated.
- **The development server needs a restart** after this migration and
  `prisma generate`, and `pnpm db:seed` (or `pnpm access:sync`) before anybody
  holds the new permissions.

---

## 20. Enhancement E-05F — A unit's contract and collection

A unit sale now reaches Legal and Finance on the same unit. From a reserved
unit's **Legal** section Sales asks for the contract; Legal drafts a sale
agreement from its **Unit requests** queue with the reservation's client, deal
and agreed price, adds the parking or storage sold with it, and takes it to
signature. Finance puts a versioned **payment schedule** in force on the signed
contract, raises an invoice per installment, and records payments **allocated**
to what they settle; the unit's **Finance** section and the project's **Finance
→ Units** show what is paid, outstanding and overdue. The company's **Sold rule**
decides what unlocks Mark Sold. `docs/unit-finance.md` is the contract.

### 20.1 What changed

| Before | Now |
|---|---|
| A contract linked to a project and a client only | `ContractUnit`: a sale agreement sells one or more canonical units, its value the sum of theirs; one live contract per unit, held by a partial unique index |
| Sales and Legal met outside the system | `UnitContractRequest`: Sales requests, Legal drafts from the request or declines with a reason, Sales withdraws; a request whose reservation ended closes itself; new `unit_contract_request` machine (3 transitions) |
| `ContractStatus` ended at Active, Expired, Terminated, Cancelled | `COMPLETED`, reached from Active only when the contract is financially complete; `SALE_AGREEMENT` type, drafted only from a unit; the unit page reads *Under review* and *Ready for signature* |
| — | Cancelling, terminating or expiring a sale contract releases its units and cancels its schedules in the same transaction; a unit under contract keeps its reservation (not expired, released or reopened) |
| — | `PaymentSchedule` and `PaymentInstallment`: drafted, checked against what the contract still needs, activated once signed, superseded by a new version keeping what was paid; new `payment_schedule` machine (5 transitions) |
| **A payment settled exactly one invoice or one expense** (`payments.invoiceId` / `expenseId`) | **Every payment settles through `PaymentAllocation`** — one engine for invoice receipts, expense disbursements and contract payments; a payment may be split across installments, left partly unallocated, allocated later, or have an allocation reversed with a reason |
| — | Invoices for installments (one live invoice per installment), settled by the installment's allocations |
| Mark Sold after a reservation | The company's Sold rule — Reservation, Signed contract (default), Deposit received, both, or Manual approval through the Approvals Center (`unit_sales` provider); meeting it only unlocks Mark Sold |
| — | Project → Finance → Units: totals per currency counting each contract once, quick filters by financial status, search including invoice numbers and payment references, cards on a phone |
| — | Job `finance.unit-installments` (hourly): due-soon and overdue notices once each, the Overdue status audited once as the system |
| — | Notification category *Finance* with eight events; 19 audit events; permissions `project.unit.legal.view`, `project.unit.contract.*` (8), `project.unit.finance.*` (7), `project.unit.sale.approve`, `legal.contract.complete`; Legal contracts, Finance collects, Sales asks, the Sales Manager approves sales, Architecture and Engineering see neither |
| — | Settings → Sales (translated): the Sold rule, warning on a rule a switched-off module makes impossible |

Migration `20260918090000_unit_finance_e05f` is **not additive, deliberately**.
It adds six tables, four enums, two enum values, columns on contracts, invoices,
payments and company settings, composite foreign keys, six partial unique
indexes and checks — and it **drops `payments.invoiceId` and
`payments.expenseId`** after writing one allocation of each payment's whole
amount to what it settled. It was first run on a restored copy of the
development database, where every invoice and expense read the same paid amount
before and after, then replayed with every other migration into an empty
database, with no drift from the schema. **Rolling it back needs a reverse
migration** that restores the two columns from allocations, which is only
possible while no payment has more than one allocation; the §1 and §9 note that
this release's migrations are additive-only no longer holds from here.

### 20.2 The evidence

Full vitest: **3 473 passed, 0 failed**, 11 skipped (the destructive and opt-in
suites), after the fix in §20.3 — the first full run had one failure,
`tests/security/module-disabled.test.ts`. Of those:

- New suites: `tests/unit/finance/unit-finance-rules.test.ts` (11 — installment
  and financial status in order, progress and the schedule target, the
  allocation proposal, every Sold rule and a contract holding a lapsed
  reservation, the machines, the role policy), `tests/api/contracts/unit-contracts.test.ts`
  (7 — drafting from Sales' request and the refusals, decline and withdraw, a
  request whose reservation ended, an apartment and its parking on one contract,
  the signature holding the unit, cancel and terminate releasing units and
  schedules, archive and reopen guards), `tests/api/finance/unit-finance.test.ts`
  (9 — schedules, total check and supersede, allocations never beyond payment or
  installment, reversal and void, every financial status, installment invoices,
  the Sold rules and Manual approval, access by role and company, the inventory's
  totals once per contract) and `tests/api/jobs/finance.unit-installments.test.ts`
  (7 — idempotency, concurrency, company isolation, suspended companies and
  Finance or Projects switched off, one failure rolling back alone).
- Existing suites moved to allocations: the finance service suite (61), the data
  invariants (with a new one: no payment allocated beyond its amount), the record
  parent matrix, approvals (the `unit_sales` provider), E-05D's and E-05E's.
- Security: a sweep narrowed to the 22 new routes makes 33 calls each way and all
  31 foreign-id calls answer 404, nothing uncovered or unvalidated; the
  disabled-module test finds no Finance or Contracts route answering Company B.
  The harness now resolves `allocationId`, `installmentId`, `requestId` and
  `scheduleId`, and a contract's unit.
- `pnpm verify:roles` against the production build: 1 363 of 1 363 checks for all
  18 roles.
- Gates: typecheck, lint (0 errors, the 16 pre-existing warnings),
  `verify:ownership` (213 models, no new cycle), `verify:authorization` (543
  routes), `verify:state` (44 machines, 229 transitions; 87 blind and 19
  unreadable, unchanged), `verify:workers` (22 jobs, matrix regenerated),
  `verify:company-integrity`, `verify:production-guards`, `security:matrix
  --check` (927 endpoints, none unguarded).
- Migration: the backfill run on a restored copy first; then every migration
  replayed into an empty database, with no drift from the schema.
- Seed: `pnpm db:seed` twice in a row, validation passing (A-201 overdue on an
  active contract with a paid, invoiced deposit; A-102's open request; Company B's
  signed contract and schedule; every seeded payment with one allocation).
- E2E against the production build: **434 passed, 0 failed** (9.6 min). The new
  desktop journeys (Sales requests and is refused Sold under the default rule;
  Legal drafts from its queue with the parking and sends it for review; Finance
  activates a schedule, records a payment and sees the unit Overdue; the
  project's totals count the contract once and filter; an Architect sees
  neither section) and the phone spec pass, and so do E-05E's under the rule
  they set.
- Screens were checked on the production build at 1440 px and on a phone: the
  unit's Legal and Finance sections, the Unit requests queue, a unit with an open
  request, Project → Finance → Units, the Sales section of a sold unit, and
  Settings → Sales; no page scrolls sideways.

### 20.3 Defects found

- **With Finance or Contracts switched off, their unit routes still answered.**
  The unit grants are Projects grants, so Company B's Owner — Finance and
  Contracts off — could read a payment schedule and reverse an allocation through
  `/api/finance/…`. The full suite's disabled-module test caught it; its reversal
  of a seeded allocation was undone, with the audit and activity rows it wrote.
  Unit finance now requires the Finance module and unit contracts the Contracts
  module, the installments job skips companies with Finance off, and a foreign
  contract is still looked up before the reader's modules are checked, so it
  stays *not found*.
- **The migration as generated dropped the payment columns before the backfill
  could read them.** It was reordered by hand: client and project, then
  allocations, then the drops.
- **The finance suite's cleanup did not delete allocations**, so its run failed
  on a foreign key and 34 tests failed in cascade, leaving a draft budget behind
  (removed). The cleanup deletes allocations first now.
- **E-05D's `unit-publishing` test set `Project.lastActivityAt` to NULL** in its
  cleanup, which the column refuses; it restores the value it found.
- **The installments job's audit of a unit becoming Overdue** was not claimed
  once per contract; it is now claimed under a key naming the contract and its
  earliest overdue installment.
- **On the production build**, the project Finance units table clipped its
  Status column at 1440 px and its search placeholder, and a phone scrolled the
  installment table sideways; the next-due column stacks, the placeholder is
  shorter, and a phone reads installments as rows.
- **E-05E's browser tests assumed the reservation Sold rule**; they now set it
  for their run and restore the company's.

### 20.4 Limits, stated plainly

- **Admin does not collect or contract**: it may request a contract, approve a
  sale and read.
- **Finance is not notified when a contract is signed**; new signed contracts
  appear under *Payment pending* on Finance → Units.
- **No "contract nearing completion" notice** (§94, recommended).
- **No standalone supersede or per-installment endpoints**: a schedule changes
  by a new version.
- **A unit's value is informational after an amendment**; the amendment holds the
  new terms.
- **No currency conversion**; totals are per currency.
- **A company with Contracts or Finance switched off** cannot meet the rules that
  need them; Settings → Sales says so, and the default is Signed contract.
- **Module pages are English**; Settings → Sales and the notification category are
  translated.
- **The development server on port 3000 must be restarted.** Its Prisma client
  predates the migration and still selects `payments.invoiceId`, which no longer
  exists, so Finance's payment and invoice pages fail on it until it restarts.
  `pnpm db:seed` (or `pnpm access:sync`) grants the new permissions.

## 21. Enhancement E-06 — Parent group, company provisioning, group departments, user lifecycle and a five-company demo

NESTO's business root is now a **parent group**. Its companies, its group
departments and each company's branch of them are rows, and a person's place
in a department is a **position**: member, company department manager or group
department head. A position widens the role the person already works as. The
**Platform Admin** implements a group from outside it and hands it over. **HR**
records a person before any login. **Group IT** creates the login from an
approved request without retyping anyone. **Department managers** put their
people on projects. The demo is one group of five companies, one project each,
with the test fixtures in a hidden group of their own. `docs/organization.md`
is the contract.

Delivered in five commits: `c1a6ebe` (the group, roles and positions, the demo),
`aff75b4` (recruitment and provisioning), `95cb4c2` (departments, appointments,
project assignment, switcher, group dashboards), `e381f7c` (the platform), and
this record's commit (the sibling-company sweep and the documents).

### 21.1 What changed

| Before | Now |
|---|---|
| A company was the root; nothing sat above it | `ParentGroup` (IMPLEMENTING → READY_FOR_VALIDATION → ACTIVE) owns its companies; `Company.parentGroupId` never changes |
| Departments were each company's own list | `GroupDepartment` once per group; a company `Department` is a branch of one |
| 18 roles, among them Admin, Company IT, Architecture Manager, Sales Manager | 16 roles. Group IT replaces Company IT, with Admin's technical authority; project setup goes to the Owner and the CEO; the two managers become positions held by an Architect or a Sales member; Platform Admin stands outside every company |
| A manager was a role | `DepartmentAssignment` positions; `permissionsForRole(role, position)`; `positionFor` elevates only the role the position is held with; GROUP scope reads company-wide inside the session's company |
| A person was a login | `PersonProfile` behind every account and employment; `CandidateProfile`; `EmployeeProfile` may predate a membership; `UserProvisioningRequest` (new `user_provisioning_request` machine, 7 transitions) |
| Accounts were invited or reset by a company administrator | HR requests; the Head of Group HR or the Owner approves (never the requester); Group IT provisions in one transaction (user, membership, MEMBER assignment, employment link); a person with a login gains a membership, not a second account |
| One company per session, changed only by opening another company's project | Top-bar company switcher; `contextInCompany` for a group user acting on a sibling company's record; `GET /api/me/access-portfolio` |
| Project teams were changed by whoever runs the project | A second door for department managers and heads, for their own people, audited with the door used; `DELETE` on the member route |
| — | Organization → Departments (heads, branches, managers, teams and their projects), appointments by the Owner or the function's head; Organization → User provisioning; HR → Recruitment |
| — | `/platform-admin`: create a group, add companies (the bootstrap now creates department branches and no longer requires an Owner invitation), the initial roster and first project assignments, the implementation checklist, activation; `withPlatformContext` routes, classified PLATFORM |
| Audit events always belonged to a company | Group-level events (`parentGroupId`, no company) for the platform; 23 new audit actions |
| One demo company with sections of a second | NESTO Demo Group: Aurelia, Meridian, Terra, Forma, Nova; group heads stacked on company manager positions; local managers; a two-company architect; recruitment in three states; fixtures in `group_fixture` |
| — | Owner dashboard lists the group's companies; Group Finance and Group Sales see their numbers company by company |

**Migration `20260918120000_parent_group_organization_e06` is not additive.**
It gives every existing company a group of its own with the group departments
and branches linked by key, and moves every membership, invitation and approval
step off the four retired roles. Architecture Manager and Sales Manager members
become Architect or Sales with a manager position. Admin members become Group
IT, and Company IT's row is renamed (its id kept). Then it **deletes the four
role rows** and makes `sessions.membershipId`/`currentCompanyId`,
`audit_events.companyId` and `employee_profiles.companyMemberId` nullable.
Rolling back needs a reverse migration that recreates the four roles and moves
people back; the positions it created say who was a manager.
`20260918130000_provisioning_rejection_reason_e06` is additive. Both were
replayed into empty databases, with no drift from the schema.

**The development database (`nesto_erp`) was not migrated or reseeded when
this record was written.** The demo changed shape: companies were renamed and
split, projects moved between companies, and the fixtures moved to their own
group. So after `pnpm prisma migrate deploy`, the demo needs a fresh database
and `pnpm db:seed`, not a seed on top of the old data. Everything above was
verified on throwaway databases. *Update 2026-09-18 (§22):* `nesto_erp` has
since been reset and reseeded; it carries all 58 migrations and the five-company
demo.

### 21.2 The evidence

- **Full vitest: 3 577 passed, 0 failed**, 11 skipped (the destructive and opt-in
  suites), on a freshly seeded database. New suites: recruitment (12),
  provisioning (8), appointments (5), group views (10), project assignment (6),
  platform implementation (7), sibling companies (2, sweeps).
- **E2E on the production build: 431 of 431**, in six shards against their own
  databases. New specs: recruitment and provisioning (3), organization and the
  switcher (4), the platform (2). The existing specs were moved onto the data
  the demo now has; some sign in as a company's own people, some move the
  session into another company, and unit specs build on a spare Aurelia
  project.
- **verify:roles: 1 614 of 1 614**, for every curated persona, the four other
  companies' examples included.
- **Security sweeps**: Aurelia ↔ fixture tenant (another group), more than 700
  calls each way, 0 violations. Meridian's CEO → Aurelia, 1 006 calls, 0 violations.
  Meridian's accountant → Terra's Finance, 69 calls, 0 violations. No row of the
  target company changed. The security matrix covers 960 endpoints, 0
  company-scoped routes without a check on their path.
- `verify:authorization` (571 routes), `verify:ownership`, `verify:state` (45
  machines), `verify:workers`, `verify:production-guards` and
  `verify:company-integrity` pass. Typecheck is clean. Lint: 0 errors, 14
  warnings, the same as before. No schema drift.

### 21.3 Defects found

- **A fresh database had no document versions for the seeded business
  documents.** Only the PRD #38 migration ever created them, from existing
  data. The seed creates version 1 now; the document review E2E test had
  depended on the old database.
- **Opening daily logs or settings for a company that had no settings row
  crashed the page** when two first reads raced to create it (a unique
  violation). Terra's first daily log hit it. Both resolvers now take the other
  read's row.
- **The first provisioning form could not submit**: the form sends an empty
  optional field as null, and the request schemas accepted only an absent one.
  The E2E suite caught it; null now means "not given".
- **Group department ids contain a colon**, and the department page answered
  404 for every link to it; the id is encoded and decoded.
- **The company switcher stalled** after a successful switch: a client push to
  the page it was already on never settled. It reloads the page instead.
- **A head of one function could read another function's department team.** The
  position gives `department.team.view` group-wide. The team is now shown only
  to that department's managers and head, and to those who keep the group's
  people.
- **The platform pages had no toast or tooltip providers**, so the credentials
  dialog crashed; the platform layout mounts both.
- **The unit contract E2E test raced**: the draft schedule's rows made the
  activated schedule look present, and the payment dialog opened before there
  was anything to allocate to. It had failed two runs in three.
- **The bootstrap test and the team authorization test** left a group or a
  company behind when the bootstrap began creating branches; their cleanups
  remove both.
- **The company sweeps called the platform routes** with a company session,
  outside any request. They skip those routes, which answer a company session
  403 before any lookup and are tested on their own.

### 21.4 Limits, stated plainly

- **Nothing forces a temporary password to be changed after sign-in.** It
  expires after 72 hours, and the account carries `mustChangePassword`, as
  PRD #50 left it.
- **The catalog modules stay in Aurelia.** Procurement, inventory, QA/QC, HSE,
  timesheets, daily logs, planning, structure and unit
  sales/finance/publishing seed their records on Riverside, because their
  catalogs (suppliers, warehouses, templates, unit types) are company-wide.
  Finance, sales, contracts, HR, tasks, documents, meetings and part of
  engineering are spread over the five companies.
- **Access grants** are modelled and resolved, but no API creates one.
- **The Organization People and Access & Roles pages** (§127) are not built.
- **Candidates have no job positions or interview records** — E-10's.
- **Offboarding** (§123) is not automated. Ending employment does not
  deactivate access, as before.
- **The Platform Admin cannot suspend or archive a group**, and cannot create a
  company for an Owner who is not yet in the group except through the roster.
- **Module pages are English.** The new section names are translated.
- **The development server on port 3000 must be restarted** after migrating. Its
  Prisma client predates both migrations.

---

## 22. Reconciliation baseline (2026-09-18)

Before anything else from the PRD implementation audit of 2026-09-17 is
applied, the audit asks for a clean, recorded baseline (its §6, Phase 0). This
is it, on `74b4221` (E-06 stage 5), branch `integration/prd-reconciliation`.

### 22.1 What was done

- **The development database was backed up and the backup restored.**
  `pg_dump -Fc nesto_erp` and a tarball of `.storage` went outside the
  repository. The dump was restored into a scratch database and compared:
  50 users, 8 companies, 121 documents, 1 494 audit events and 58 applied
  migrations on both sides. The scratch database was then dropped.
- **`nesto_erp` is on the current shape.** All 58 migrations are applied, and
  it holds the NESTO Demo Group (five companies), the fixture group and
  `platform-admin`. §21.1's warning that it had not been migrated is history.
- **Three fresh databases** were built from nothing — every migration, then
  `prisma/seed.ts` — one each for vitest, the E2E suite and the verification
  gates, each with its own document storage root. Seed validation passed on
  all three.

### 22.2 The evidence

| Gate | Result |
|---|---|
| Typecheck | clean |
| Lint | 0 errors, 14 warnings (unchanged from §21) |
| Schema drift | none |
| verify:authorization | 571 routes, 320 server actions |
| verify:ownership / state / workers | pass (222 models, 45 machines, 22 jobs) |
| verify:company-integrity / production-guards | pass |
| security:matrix | 960 endpoints, 0 company-scoped routes without a check |
| verify:roles | 1 614 of 1 614 |
| vitest | 3 574 passed, 3 failed, 11 skipped — see 22.3 |
| E2E (production build) | 430 of 431 — see 22.3 |

### 22.3 The four failures, and what they were

None was a defect in the application.

- **Two storage concurrency tests** (`storage-pipeline.test.ts`, "cannot be
  raced past the quota", "keeps every document and key distinct") failed with
  *Unable to start a transaction in the given time*. The run had capped the
  database pool at five connections, a setting meant for parallel E2E servers;
  the tests race seven uploads on purpose. With the default pool both pass.
- **The calendar availability test failed on Fridays.** It books an event three
  days out at 10:00 and expected a busy interval to start exactly then. Three
  days from a Friday is a Monday, when the seeded weekly Riverside coordination
  meeting (09:00-10:00) touches it, and busy time is merged — correctly — into
  one interval starting at 09:00. The test now checks that the event is
  covered, and that a declined invitation leaves availability unchanged.
- **The mobile filter-sheet E2E test was flaky** (one run in three). It
  reopened the sheet while it was still sliding shut; the reopen lost. It now
  waits for the sheet to close, as a person does, and passed eight times in a
  row.

With those two test fixes the baseline is green.

---

## 23. E-06 completed — delegated access, Access & roles, access diagnostics

The audit's Phase 1 closes E-06's known gaps without redesigning its models:
access grants get a door, Organization gets its Access & roles page, and the
authorization data gets a diagnostic — for a person (the access check) and for
the whole organization (`verify:organization`). The People page stays E-08's.
`docs/organization.md` ("Delegated access") is the contract.

### 23.1 What changed

| Before | Now |
|---|---|
| `AccessGrant` rows were resolved but nothing could create one | `POST /api/organization/access-grants`: the Owner for any function's module, a group head for their own function's modules and people; `…/:grantId/revoke`; `GET` for those who keep access (a head sees their function's) |
| — | The ceiling: in every company a grant reaches, the grantor's own role and position hold the module at that rung, company-wide. Delegated access never counts towards it, so nothing is passed along a chain |
| Every module could in principle be named in a grant | Only the functions' business modules (`GROUP_DEPARTMENTS[].modules`); administration never |
| — | Organization → Access & roles: delegated access (in force / with history, delegate, revoke), each role by position (member, company manager, group head), and Check access |
| — | `GET /api/organization/access-diagnostics`: blockers, role, position and the appointments behind it, grants, each module's access by role, by position and in effect with its source, and a permission's answer — from the real resolver |
| — | `pnpm verify:organization`, in CI after the suites: memberships, platform users, positions, branches, branch managers, grants and people read side by side |
| — | Audit: `ORGANIZATION_ACCESS_GRANTED` (critical), `ORGANIZATION_ACCESS_GRANT_REVOKED` |

No schema change and no migration.

### 23.2 The evidence

On three freshly built databases (every migration, then the seed):

- **vitest: 3 595 passed, 0 failed**, 11 skipped. New: access grants (16),
  organization integrity (2).
- **E2E on the production build: 435 of 435.** New: organization access (4).
- **verify:roles 1 614 of 1 614.** verify:authorization (574 routes — run
  before the last file was added; the committed tree failed its role-name rule,
  see §24.3), ownership, state, company-integrity, production-guards pass;
  **verify:organization** clean on all three databases and on `nesto_erp`, 0
  warnings, before and after the suites. security:matrix: 964 endpoints, 0
  company-scoped without a check. Typecheck clean; no schema drift.

### 23.3 Decisions

- **Which modules a function owns** is new configuration, not a PRD table:
  HR → HR; Projects → Projects, Tasks, Daily logs; Architecture and Engineering
  → Engineering; Finance → Finance; Legal → Contracts; Sales → Sales, Clients;
  Procurement → Procurement, Contractors; Inventory, QA/QC, HSE → their own.
  Executive and IT own none.
- **A group grant reads as GROUP scope**, which the scope builders already treat
  as company-wide inside each company; the company filter stays.
- **A read-only holder is refused above View** rather than stored and clamped.
- **Grants for DEPARTMENT, PROJECT or RECORD scope are refused**: the resolver
  applies none of them in V0.1, and a stored grant that does nothing is a
  promise nobody keeps.

### 23.4 Limits

- **The Organization People page** is E-08's group directory (and E-01's, see
  ADR 0002).
- **A grant is not re-checked when its grantor loses authority.** It stays in
  force until revoked or expired; `verify:organization` warns about it
  (`GRANT_ABOVE_GRANTOR`).
- **The access check explains a company context.** It does not simulate a
  record: whether a project-scoped reader sees one particular invoice is still
  the module's own scope builder's answer.

---

## 24. Enhancement E-01 — the group's people, reconciled onto the person record

The audit makes E-01 the next PRD and asks for it to be reconciled, not pasted
in. E-01 predates E-06 and keys the profile to a membership with a new
`LegalEntity`; built literally it would undo E-06's person-first identity.
[ADR 0002](adr/0002-e01-person-identity-reconciliation.md) classifies every
requirement against the code (the audit's protocol steps 1-3) and records six
decisions; `docs/people.md` is the contract.

### 24.1 What changed

| Before | Now |
|---|---|
| A person could be seen only as a membership of your own company (Team) | **People** (`/people`): everybody who works in the group, across its companies, searched by name, title or work contact and narrowed by company, department, project, title and place, a page at a time. Every internal role has it |
| — | A profile per person (`/people/[personId]`): who, job title apart from the NESTO role, employing company, department, manager, contact, office, bio, where they work in each company and at group level, projects (linked only where the reader can open them), activity |
| HR's records could be read only on HR's pages | The profile's Employment tab, judged employment by employment in its own company by HR's own permission and scope; the Private tab for the person and HR within reach; both absent, not locked, for anybody else |
| — | A person edits their bio, extension, office and preferred name; HR the job title and work email too; audited as `PERSON_WORK_PROFILE_UPDATED` |
| An invited account joined a company with no person behind it | Accepting an invitation gives the account its person, through HR's door, in the same transaction; a migration backfills anybody left without one; `verify:organization` fails on a login without a person |
| A company had a legal name only | Registration and tax numbers, set when a company is created and shown in Settings and on the employment; the company is the employing entity (no `LegalEntity` model) |
| Global search found company members | A `people` result type with the directory's own reach and fields |
| — | New core module `people` (`people.directory.view`, `people.profile.view`, `people.profile.edit_self`); every membership role opens it group-wide, a read-only role cannot edit |

**Migration `20260918150000_person_work_profile_e01`** adds three nullable
columns to `person_profiles` and two to `companies`, then backfills persons:
a login working in a group with no person is linked to an unlinked person of
the group with the same email, or given one made from the account. It is
re-runnable. Replayed into an empty database, and against a restored copy of
`nesto_erp` with three logins' persons removed on purpose: two were relinked
by email, one got a new person, and a second run changed nothing. Rollback:
drop the five columns; the backfilled persons are ordinary persons.

### 24.2 The evidence

On three freshly built databases:

- **vitest: 3 608 passed, 0 failed**, 11 skipped. New: people (13); the
  invitation test now checks the person.
- **E2E on the production build: 441 of 441.** New: people (6). That run's
  build predates the last change (a profile no longer carries the id of a
  project the reader cannot open); the People, Team, Access and Platform specs
  were run again on a build of the final tree: 25 of 25.
- **verify:roles 1 675 of 1 675** (the People module on every persona).
  verify:authorization (581 routes), ownership (56 domains, no new circle),
  state, workers, company-integrity, production-guards pass;
  **verify:organization** clean before and after both suites; security:matrix
  971 endpoints, 0 company-scoped without a check. Typecheck clean; lint 0
  errors, 14 warnings; no drift.

### 24.3 Defects found

- **§23's commit (`85ebf6d`) did not pass `verify:authorization`.** The gate
  was run before `organization-integrity.ts` was written, and that file
  compares role names — legitimately, as a read-only consistency check, but the
  gate requires the exception to be recorded. It is now, with its reason. §23.2's
  "every gate green" was wrong for that commit.
- **A module the browser reaches had started to need the database.**
  `hr.person.ts`' name helpers are read from modules that end up in client
  bundles; E-01's doors first went there and broke the production build. They
  live in `hr/person.doors.ts`.
- **Team importing HR would have closed a five-domain import circle** (Team →
  HR → Finance → Sales → Projects → Team). Accepting an invitation takes HR's
  person door as a parameter instead, handed in by the server action.
- **The sibling-company sweep flagged the directory**: Meridian's CEO was shown
  Aurelia's company id — the employing company of Aurelia's people, which E-01
  makes visible to the whole group (§5, §7, §32). The sweep now exempts a
  company's own id on `/api/people` routes, and only when the target company is
  in the attacker's own group; its records' ids stay forbidden, and a company
  of another group is never exempt. In the same pass the profile stopped
  carrying the id of a project the reader cannot open (the name and code
  remain, §44), and the sweep learned to attack `/api/people/[personId]`, which
  it had skipped for want of a person id: 11 calls, 0 violations, the
  restricted views answering 403.

### 24.4 Limits

- **No photo, skills, qualifications, employee documents or expiry** — E-02's
  (ADR 0002 decision 6). The avatar is initials.
- **No employment or organization history**; department, title and manager are
  current values — E-03's.
- **Names elsewhere do not link to profiles yet** — E-08's `PersonLink`.
- **A person without a login** appears once they have a current employment;
  the directory has none in the demo until E-04 brings the workforce.
- **Company identity cannot be edited after creation**; Settings shows it
  read-only.

## 25. Enhancement E-13 — group and company department management

E-13 makes E-06's departments a complete feature: defined once for the group,
activated per company, one head per department and one manager per company
branch, members who can cover several companies, and the same records managed
from Organization and from the Platform Admin's group setup. It says to extend
E-06 and build nothing parallel. [ADR 0003](adr/0003-e13-department-management-reconciliation.md)
classifies every requirement and records eleven decisions; `docs/organization.md`
§Departments is the contract. It was not in the reconciliation audit's order;
it was asked for directly after E-01, so it comes before E-03.

### 25.1 What changed

| Before | Now |
|---|---|
| Thirteen fixed functions, no way to add, rename or retire one | Organization → **Departments**: the Owner and Group IT create a department (name, code unique in the group, description), edit it — a rename reaches every branch — and deactivate or reactivate it; history stays |
| Every company had a branch of every function | A department is **activated** in the companies that need it (one or several at once) and deactivated and reactivated there as the same branch; a new company runs the departments chosen for it (Platform Admin's New company, `bootstrapCompany({ departmentKeys })`, `--departments=`) |
| Two heads, or two managers, could hold one department | **One head per department, one manager per branch**, enforced by partial unique indexes; replacing one is explicit, ends the old appointment as history and is refused to a racing second request |
| Department membership was `CompanyMember.departmentId`: one department, one company | A **member place** (`DepartmentAssignment` MEMBER) per branch; somebody working for the whole group covers several companies as one person. The membership's department stays as its **home**, and always has its place (ADR 0003 decision 5) |
| Branch managers could be named from Team, bypassing appointments | Heads by the Owner; managers by the Owner or the function's head; members by the Owner or the branch's manager or head — each in the company acted in, audited there |
| — | A department's page: **Overview** (head, activate in companies), **Companies** (manager, people, status, activate/deactivate), **Team** (filters; position, companies covered, projects, status; add, remove), **Access** (delegations in its modules), **Activity** |
| — | Organization → **Companies**, and each company's **Departments** page; overview cards for departments, active company departments, and those without a head or a manager |
| Team created, edited and archived company departments | Team → Departments is read only and links to Organization; its four write permissions are retired |
| — | The Platform Admin's **Group → Departments** (the same services, audited as the platform, closed at go-live); the setup checklist counts heads and managers |
| — | A person's profile lists their departments: department, company, position |
| — | Notifications when somebody is appointed head or manager, added to a department, or their place changes |
| Positions of an inactive branch still elevated | An inactive department or branch takes nobody new and its positions widen nothing until it reopens; positions in a department the group added never widen anything (ADR 0003 decisions 3, 6) |

**Migration `20260918160000_department_management_e13`** is additive: `code`
and `createdByUserId` on group departments (the chart's codes; any other key
upper-cased), unique code and name per group, one branch per department and
company, the two partial unique indexes, a check that a manager has a branch,
and a backfill of one member place per active membership placed in a branch.
It checks first and changes nothing if a company has two branches of one
department, a group uses a name twice, a department has two heads, a branch
two managers, or a manager has no branch. Tested on an empty database; on a
copy of the E-01 verify lane (94 places backfilled, a rerun added none); and
with a second head manufactured, where it stopped before adding a column.

**Rollback:** drop the two partial indexes, the check constraint and the three
unique indexes; drop `group_departments.code` and `createdByUserId`; delete
`department_assignments` whose id starts `dam_e13_`; delete the migration's
`_prisma_migrations` row. The Team write surfaces come back with the previous
commit.

### 25.2 The evidence

On freshly built databases (one per suite), on the final tree:

- **vitest: 3 631 passed, 0 failed**, 11 skipped. New: departments (29 — the
  PRD's functional and security tests §107-§122, the race, the home rule,
  Team's moves, departments the group added), platform departments (4 —
  company setup §121, the platform actor §111, go-live); the integrity gate
  names a home without its place; E-06's appointments suite folded into the
  departments suite; Team's department tests now read only.
- **E2E on the production build: 444 of 444** (new: organization-departments,
  4 — the Owner's, a head's, a local manager's and the Platform Admin's flows,
  §124-§127). The last four changes (moving a member's place, provisioning
  keeping an existing place, the overview's active branches, searching
  candidates by title) came after that run; the Organization, Team, Platform,
  People, Access and Provisioning specs were run again on a build of the final
  tree: 35 of 35.
- **Security sweeps** attack every new route with the target company's real
  department, branch, company and assignment ids: sibling companies 27 calls
  and a sibling's accountant 69, another group 27 each way — 0 violations,
  nothing uncovered.
- **verify:roles 1 675 of 1 675.** verify:authorization (602 routes),
  ownership (56 domains, no new circle), state, workers, company-integrity,
  production-guards pass; **verify:organization** clean before and after both
  suites; security:matrix 993 endpoints, 0 company-scoped without a check.
  Typecheck clean; lint 0 errors, 14 warnings (none new); no drift.

### 25.3 Defects found

- **Raw SQL `now()` wrote local time.** The local server runs in
  Europe/Tirane, and a timestamp-without-zone column stores `now()` as local
  time while Prisma stores UTC. A test's cleanup of "rows made after the test
  started" deleted the 94 backfilled member places, whose `createdAt` was two
  hours ahead. The backfill and the seed now write `now() AT TIME ZONE 'UTC'`,
  and so does **E-01's migration** (`20260918150000`), which had the same
  `now()` for the persons it creates — corrected before it was applied to any
  database but the throwaway ones.
- **The access portfolio started listing member places** beside positions once
  every placed membership had one; it lists positions only, as before, and the
  profile lists places.
- **Accepting an invitation briefly looked a role up by id alone**, which
  `verify:authorization`'s ratchet refused. The organization's placement door
  now reads the role from the membership it places, inside the company.
- **The production build type-checked the dev server's stale route list**
  (`.next/types`, from 2026-09-17), which named the removed Team pages. No dev
  server was running; the stale folder was moved aside, not deleted, and
  `next dev` writes a fresh one when it next starts.

### 25.4 Limits

- **A department the group adds widens nothing**: its head and managers are
  recorded and notified, and gain no permission (ADR 0003 decision 3).
- **A place needs a NESTO account** until E-04; **history** is the ended rows
  and the audit trail until E-03's effective dating.
- **The demo keeps its thirteen functions active in every company.** Selective
  activation is shown by the platform flow; ARMAAR, and a seeded department
  set, come after E-13 is stable, as the PRD says (§128, §129).
- **Selectors are plain lists** of the group's eligible people, not a search
  box; enough for groups of tens, not hundreds.
- **Department pages are English**; the section names are translated.

## 26. Enhancement E-03 — employment and organization history

E-03 makes an employee's placement a history: company, department, title,
manager, work location, employment type and status are effective-dated rows
that are never edited, changed only by named actions, scheduled for a later
day or corrected with a reason, and read as of any date. It is reconciled onto
HR's employment record (`EmployeeProfile`) rather than the parallel
`EmploymentRecord` / `LegalEntity` / `JobPosition` model the PRD sketches.
[ADR 0004](adr/0004-e03-employment-history-reconciliation.md) classifies every
requirement and records thirteen decisions; `docs/employment-history.md` is the
contract. It is the next step of the reconciliation audit's order, after E-01
and E-13.

### 26.1 What changed

| Before | Now |
|---|---|
| An edit of the employment overwrote its manager, dates, type and location; a rehire overwrote the start date | Every change **closes the open row and opens the next** (`employment_assignments`, `employment_status_history`); a correction supersedes rows and writes corrected ones naming them, with a required reason. The originals stay |
| Department and title lived on the membership, edited in Team and moved by the Organization, with no history | For somebody employed, **the employment owns department and title** and the membership mirrors it. Team's member edit, invitation acceptance, the Organization's department moves and a provisioned account are **recorded** in the history (source SYNC), not lost |
| A PATCH changed organization fields; separate `/status` and `/rehire` routes | One typed change, `POST …/employment-changes`: promote or change title, department, manager, location, employment type, status, end, rehire, transfer to another company. PATCH keeps the number, probation, planned end and hours; the two routes are removed |
| — | **When it takes effect decides how**: today applies; a later day is scheduled (`hr.employment.schedule`) and applied by the job `hr.employment-changes` on the day, dated its own day even if the job missed a week; an earlier day is backdated (`hr.employment_history.correct`) within the current period only. A planned employment's changes revise the plan |
| Moving somebody to a sibling company meant ending one record and creating another by hand | **Transfer to another company** ends the employment here the day before and begins (or reopens) one in the other company, with HR authority in both; the login there is linked if the person has one |
| — | A **before/after review** for every change; ending employment and a company transfer need a confirmation; a stale form (the history moved on) is refused |
| — | A **supporting document** is linked by id — a document of the same company the person linking it can open — and shown only to readers who can open it. Nothing is copied |
| — | HR's employee record has a **History** tab (timeline, scheduled changes, positions and placements, status); the People profile's Employment tab shows the person's timeline across the group's companies |
| — | Who reads history: HR (`hr.employment_history.view`, MANAGE rung) and the Owner — private reasons only with `hr.employment_history.view_private`; **the employee** their own, without notes, private reasons, corrections or who recorded them. The CEO, managers, Finance, IT and colleagues see the current record only; the history endpoints refuse them |
| — | HR → Reports → **Organization**: headcount on a day by company, department, title and status as they were that day; joiners, leavers, promotions, department and company transfers, manager and status changes in a period |
| People's managed edit could change anybody's title | It refuses the title of somebody employed: HR changes it, and it is recorded |
| — | The employee is notified when a promotion, department or manager change takes effect, never why; the requester when a scheduled change fails |
| — | `verify:employment` in CI; `repair:employment --apply` rewrites a drifted current state from the history, audited, and never touches history |
| — | The demo has stories: a promotion, a department transfer, a manager change, the multi-company architect's move from Forma to Aurelia, and two scheduled changes |

**Migration `20260918170000_employment_history_e03`** is additive: the
`btree_gist` extension; six enums; three tables; `departmentId`, `jobTitle`
and `workLocationType` on `employee_profiles`; unique `(id, companyId)` keys on
`employee_profiles` and `documents` for the composite foreign keys; date
checks, one-open-row partial unique indexes and no-overlap exclusion
constraints; the current fields filled from the membership (or, with no login,
the hire's target); and each employment's first rows, marked MIGRATION, with
deterministic ids. It refuses to run, before changing anything, when an
employment's login belongs to another company. Tested on an empty database and
on a copy of `nesto_erp` (41 assignments and 44 status rows written, a rerun
of the data steps added none, no drift), with an overlapping row and a
cross-company login manufactured to see the constraint and the check refuse
them.

**Rollback:** drop `employment_changes`, `employment_status_history` and
`employment_assignments`; drop the foreign key
`employee_profiles_departmentId_companyId_fkey`, the index
`employee_profiles_companyId_departmentId_idx`, the columns `departmentId`,
`jobTitle` and `workLocationType`, and the unique indexes
`employee_profiles_id_companyId_key` and `documents_id_companyId_key`; drop the
six enums (`WorkLocationType`, `EmploymentAssignmentReason`,
`EmploymentStatusReason`, `EmploymentHistorySource`, `EmploymentChangeType`,
`EmploymentChangeStatus`); delete the migration's `_prisma_migrations` row.
`btree_gist` may stay. The previous commit brings back the PATCH of placement
and the `/status` and `/rehire` routes; the membership still holds department
and title, so nothing needs copying back.

### 26.2 The evidence

On freshly built databases (one per suite), on the final tree:

- **vitest: 3 657 passed, 0 failed**, 11 skipped. New: employment history (21 — promotion, department
  transfer with the department's team following, manager history and loops,
  stale forms and concurrent changes, backdating, scheduling, the job's
  catch-up and once-only application, cancellation, failure, ending and
  rehire, company transfer, another group refused, correction, who sees
  history and private reasons, directory search of current titles only,
  documents by reference, Team's edit recorded as SYNC, People's title edit
  refused, drift and repair, headcount as of a date, the demo's transfer);
  the job's contract test (4). HR's lifecycle tests now go through the typed
  changes; People's managed title edit of an employee is a conflict.
- **E2E on the production build: 452 of 452** (new: employment history, 8 —
  promotion with a linked amendment, company transfer, the employee's own
  history on a phone, a colleague refused, correction, scheduling and
  cancelling, the organization report, the CEO not offered it).
- **Security sweeps** aim every new route at the target company's real
  employment, history row and scheduled-change ids: sibling companies 12 calls
  and a sibling's accountant 69, another group into the demo 12 — 0
  violations. The demo attacking the other group reaches nothing to aim at,
  because that group has no employees; this holds for every HR route, as
  before.
- **verify:roles 1 675 of 1 675.** verify:authorization (607 routes),
  ownership (the three new models are HR's), state, workers (the new job has
  its contract test),
  company-integrity, production-guards pass; **verify:organization** and
  **verify:employment** clean before and after both suites; security:matrix
  1 000 endpoints, 0 company-scoped without a check. Typecheck clean; lint 0
  errors, 14 warnings (none new); no drift.

### 26.3 Defects found

- **The transfer dialog carried this company's manager to the other one.** It
  showed "No manager" — the manager is not a choice in the other company — but
  sent the current manager's id, which the service rightly refused. A transfer
  now starts with nothing chosen in the other company, and choosing another
  company clears department and manager.
- **A correction met the no-overlap constraint** when it wrote the corrected
  row while the original still stood; it now supersedes first, then writes.
  The constraint did its job.
- **An employee could not read an employment of theirs** in a company where
  they have a login that is not linked to it; the person's own employments are
  now read with `hr.self.employment` in that company.
- **The audit of a cancelled, applied or failed scheduled change** dropped the
  change's id (unchanged fields are left out of a change diff); those events
  record before and after in full.
- **An E2E test signed out by clearing cookies** while the previous page's
  requests were still in flight, and one of them set the session again. The
  two readers now have a test each.

### 26.4 Limits

- **An HR screen is addressed by a login's membership.** An employment with
  no login — a hire before its account, the other half of a transfer to a
  company where the person has none — is in the person's history but not in
  HR's lists until E-04.
- **No job-position catalog**: the title is recorded on each row. E-10's
  `JobPosition` is a recruitment opening, a different thing.
- **A manager is of the employment's own company**, stricter than E-03's
  "same group", because leave approval routes on it.
- **Promotions are not published to company activity**; bulk changes and
  import are not built (E-03 §189).
- **`nesto_erp` lacks the E-01, E-13 and E-03 migrations**
  (`20260918150000`, `160000`, `170000`); they are applied only with the
  owner's consent.
- The history pages are English, like the rest of HR's pages.

## 27. Demo PRD D-01 — the ARMAAR Group demo tenant and the group's executive dashboard

D-01 asks for a realistic tenant for ARMAAR GROUP sh.p.k. — built from its
public facts and clearly synthetic data — and an executive dashboard for the
group. It is reconciled onto what exists: [ADR 0005](adr/0005-d01-armaar-demo-tenant.md)
classifies every section and records eleven decisions; `docs/demo-armaar.md` is
the presenter's guide. It was asked for directly after E-03 ("then armaar
prd"); the four questions asked when it arrived were not answered, and the
recommended defaults were used.

### 27.1 What changed

| Before | Now |
|---|---|
| One visible parent group, fictional | A second group, **ARMAAR GROUP**: thirteen companies (nine active, four suspended), thirteen departments named ARMAAR's way and activated per company, 81 people with 205 company logins, employments with history, eleven public projects, 129 units, 69 sales under 69 sale contracts, suppliers, contractors, procurement, budgets, contracts, documents, tasks, meetings, calendar, announcements, HSE and QA/QC. Seeded by the main seed and by `pnpm seed:armaar`; a rerun adds and changes nothing |
| — | **Public facts kept apart**: only D-01's source set is public, in one file with its source; `demo_records` says for the group, companies, departments, people and projects what is PUBLIC, SYNTHETIC or INFERRED, field by field; `pnpm verify:demo` fails if a public fact is replaced |
| The Owner's dashboard: the current company's figures, and one row per company | The **group's executive view**: a banner (name, NIPT, city, active and suspended companies), five figures — companies, active projects, employees, external companies, portfolio value — key projects as cards (cover, company, place, type, status, progress from the plan), the portfolio by status and type, departments by their people, the next milestones, the group's recent activity. Each figure computed company by company as the reader; a company-only reader gets nothing group-wide. `GET /api/dashboard/group` answers the same in one response |
| — | A **demo tenant says so** on every page (`ParentGroup.isDemo`): a notice in the top bar and on the dashboard |
| A group had no registration number or city | `ParentGroup.registrationNumber` (the NIPT, as NESTO's Albanian labels call it) and `city` |
| — | **Ownership** in Settings → Company: who owns the company and how much (`CompanyOwner`) |
| — | A project's published **built area** and whether it is a **key project**, on its form and overview |
| The dashboard's activity feed left out a unit's sale, contract and payment events | They are shown where the unit and its tab are reachable, in every group |

**Migration `20260918180000_demo_tenant_d01`** is additive: three columns on
`parent_groups`, two on `projects`, the tables `company_owners` (a share above
0 and at most 100) and `demo_records`, and the `DemoSourceType` enum.

**Rollback:** drop `demo_records` and `company_owners`, the enum
`DemoSourceType`, the columns `registrationNumber`, `city` and `isDemo` of
`parent_groups` and `builtArea` and `isKeyProject` of `projects`, and the
migration's `_prisma_migrations` row. ARMAAR's own rows are the ones in its
group (`armaar_group`) and its companies; rebuilding the database without the
seed's ARMAAR stage removes them.

### 27.2 The evidence

On freshly built databases holding both groups, on the final tree:

- **vitest: 3 670 passed, 0 failed**, 11 skipped. New: the group's dashboard
  (7 — every figure against the database, one external company across three
  registers, key projects with the plan's progress, the charts, a company-only
  reader refused, a group head given Finance's figure and not HR's, each group's
  figures kept inside it) and the ARMAAR tenant (6 — D-01's checks, a rerun that
  adds nothing, provenance field by field, one person per login, suspended
  companies without work, no product file naming ARMAAR). Every other suite now
  runs beside a second, realistic group; one seed test changed with it.
- **E2E on the production build: 455 of 456.** New: the ARMAAR dashboard (4 —
  the Owner's banner, figures and key projects, a company-only reader without
  them, no notice in the five-company demo, a phone without sideways scroll).
  The one failure was an existing calendar test on a phone (§27.3); after the
  fix it passed four runs of four.
- **verify:roles 1 676 of 1 676.** verify:authorization (608 routes),
  ownership (227 models), state, workers, company-integrity, production-guards
  pass; **verify:organization**, **verify:employment** and the new
  **verify:demo** clean before and after both suites; security:matrix 1 001
  endpoints, 0 company-scoped without a check; the sweeps, part of the suite,
  attack the new endpoint too. Typecheck clean; lint 0 errors, 14 warnings (none
  new); no drift.
- **The migration** applied to an empty database (every lane) and to a copy of
  `nesto_erp`'s data with E-01, E-13 and E-03 applied: nothing existing changed,
  and the share check refused 120%. `seed:armaar` then added the tenant to that
  copy and every integrity check stayed clean. Seeding twice leaves every count
  unchanged.

### 27.3 Defects found

- **The dashboard's activity feed never showed a unit's sale, contract or
  payment**, in any group: Sales, Legal and Finance write them against the unit
  under their own module, and the feed trusted only the unit's projects entry.
  Found because D-01 §62 asks for "unit reserved"; they are now read where the
  unit and its tab are reachable.
- **A group figure appeared in a company with its module switched off**: the
  external-companies figure is gated on the group permission, and still counted
  client companies for the fixture tenant's Owner, whose procurement is off. The
  module-disabled suite caught it; the resolver now drops any figure or widget
  whose module is off in the reader's company. No persona lost anything else.
- **NIPT is the registration number, not the tax number**: NESTO's Albanian
  labels already say so. ARMAAR's NIPT was first written as a tax number; it was
  moved, and the group's new field named for it, before the migration reached
  any database but the lanes.
- **An existing calendar test on a phone was flaky**: "Event created" also
  matched the toast's live region. It matches the text exactly now.
- Two gates held the new code to the rules: the demo provenance table first
  cascaded deletes from a group across domains (now Restrict), and the group's
  identity was first read by id alone (now through the session's company).

### 27.4 Limits

- **No non-login workers** and no Workers figure: E-04.
- **External companies are counted across the registers**, once each by tax
  number or name; the canonical register and the contractor chain after its
  contract (progress, invoice, verification, payment) are E-11's.
- **Activity is NESTO's feed**, not E-12's.
- **Announcements reach a company at most**: there is no group audience; the
  Owner's welcome is published in BUILDING CONSTRUCTION INVEST.
- **Public facts are D-01's only.** Company NIPTs, and the location and company
  of ten of the eleven projects, are empty or assigned for the demo until a
  source set gives them.
- **Covers are generated illustrations**, not the projects' own renders.
- **`nesto_erp` lacks the E-01, E-13, E-03 and D-01 migrations**; they are
  applied, and ARMAAR seeded there, only with the owner's consent.

## 28. Enhancement E-04 — workforce employees, with or without a login

E-04 makes the whole workforce employees: masons, steel fixers, drivers and
their foremen, who never sign in, have HR's record, leave, attendance and
documents, a trade, a crew, a project and a site, and appear in HSE and the
daily log. A login is added later to the same employee, never a second one. It
is reconciled onto the employment (`EmployeeProfile`) rather than the parallel
`Employee` root the PRD sketches: [ADR 0006](adr/0006-e04-workforce-employees.md)
classifies every section and records seventeen decisions;
`docs/workforce.md` is the contract. Built as the owner decided before it
started: core only (timesheets entered by others, overtime and payroll are
E-09's), with sites, and demo data in ARMAAR only. Three stages: HR by
employment (7cb59c7), the workforce domain (ffd11c1), and HSE, daily logs,
import, integrity and the ARMAAR seed.

### 28.1 What changed

| Before | Now |
|---|---|
| HR addressed an employee by their login: `/hr/employees/[memberId]`, and its lists, documents, activity, leave and attendance kept only employees with one | **HR is addressed by the employment**: `/hr/employees/[employeeId]`, old member links redirect; documents, activity, tasks, threads, notifications, attention items, favourites and recent items re-keyed in the migration. The list shows everybody employed, with an account filter |
| Leave and attendance needed a login | **They belong to the employment**; a login linked later is stamped on them |
| Employing somebody meant a login first | **Three ways**: an existing login, an existing person of the group, or a new person — a probable duplicate (same name, surname and birth date, or phone) is refused until HR confirms; "Request account" on the record uses E-06's provisioning |
| — | **Category and trade** on the employment; each company's own trade list (Workforce → Trades) |
| Only `ProjectMember`, which is access | **Project assignments** — a project, a site, a trade, a role, main or not, from–to — and **sites** on a project; **crews** under a foreman who needs no login; moves close one period and open the next; the database refuses overlaps, so of two racing moves one wins |
| — | A **Workforce** module: Workers, Crews, the **site attendance sheet** (a crew's day at once, source SITE, never over HR's own entry), Trades; a project's Workforce tab; the person's Workforce tab with a Safety section |
| HSE named logins only | **Toolbox participants, PPE subjects, incident people** (an employee or a named outsider), **permit workers** (a person or a crew, until submitted) and **site inductions** (voided with a reason, never deleted); the project lists who works there without a valid one |
| The daily log's workforce was typed | It **suggests** the project's crews with the site sheet's headcount, and people assigned in no crew, by trade; each chosen becomes an ordinary entry keeping its crew |
| — | **Bulk import** (HR → Employees → Import): a CSV of up to 2 000 people, previewed row by row with errors and warnings, committed once from the stored rows; pay columns ignored; no logins |
| Ending an employment left the person in place | Ending or transferring it **ends their crew and project assignments** on the last day, and withdraws those not begun |
| — | `verify:employee-integrity`, in CI after the suites: login, person and group agree; nothing outlives its employment; leave and attendance carry the right login; employee documents name an employment of their company |
| The ARMAAR tenant had no workforce | **34 site workers** in BUILDING CONSTRUCTION INVEST and ARLIS - NDERTIM, nine trades, five sites, seven crews and an archived one, their history, the last working days marked on site, inductions with two missing and one voided |

**Migration `20260919090000_workforce_e04`** adds five enums and the value
`SITE` of `AttendanceSource`; nine tables; the category and trade of an
employment, where an attendance day was worked, a daily-log entry's crew, and
the employee of a toolbox participant and of a PPE check; checks, composite
keys and `btree_gist` exclusion constraints. It makes `companyMemberId`
optional on attendance, leave requests and leave balances, moves attendance's
unique key from (login, day) to (employment, day) — the same rows, since an
employment has at most one login — and re-keys the rows filed under an
employee from the membership's id to the employment's, deterministically.

**Rollback:** first remove what only the new schema can hold — rows filed under
an employment that has no login (documents, activity, tasks, threads,
notifications, attention items, favourites, recent items), and attendance,
leave requests and leave balances without a login; set attendance `source`
SITE to MANUAL. Then re-key the rows filed under an employee back from the
employment's id to its login's membership id; drop the nine tables, the new
columns, checks and enums (recreating `AttendanceSource` without SITE);
restore `NOT NULL` on the three `companyMemberId` columns and the unique key
`(companyMemberId, date)` on attendance; delete the migration's
`_prisma_migrations` row. Employments without a login stay valid under the old
schema — they were already allowed — but the old HR pages do not list them.

### 28.2 The evidence

On freshly built databases, on the final tree:

- **vitest: 3 708 passed, 0 failed**, 11 skipped. New across the three stages:
  employees without a login (11 — created, addressed by the employment,
  duplicates, a second employment refused, another group's person or trade
  refused, edits, scope, documents, leave and attendance, a login linked
  later); the workforce (18 — trades, sites, assignments, crews, both races,
  scope, the site sheet, ending); HSE, daily-log suggestions, import including
  a thousand people, and the integrity check (8); the ARMAAR workforce (1) and
  its rerun counts. The group dashboard's employees figure now counts
  everybody employed.
- **E2E on the production build: 463 of 464.** The one failure was a new
  test assuming the day's suggestions start unticked — they start ticked; it
  now unticks all but the crew, and both workforce specs then passed twice
  each (14 of 14). New: the workforce (4 — a crew of people without a login,
  the site sheet, a project assignment, the worker's profile; a project
  manager's site; an engineer reading crews; a role turned away) and the
  workforce on site (3 — an import, an induction from the project's missing
  list, a daily log filled from the crew the site sheet marked present).
- **verify:roles 1 715 of 1 715.** verify:authorization (632 routes, 316
  server actions), ownership (236 models, 57 domains, no cycle), state (45
  machines) pass; company-integrity, organization, employment, the new
  **employee-integrity** and demo are clean before and after the full suite;
  security:matrix 1 037 endpoints, 0 company-scoped without a check.
  Typecheck clean; lint 0 errors, 14 warnings (none new).
- **The migration** applied to an empty database and to a copy of
  `nesto_erp`'s data with every earlier migration. On that copy `access:sync`
  then `seed:armaar` added ARMAAR with its workforce, and every integrity
  check stayed clean. Seeding twice leaves every count unchanged.

### 28.3 Defects found

- **The API security matrix was stale** from the first stage: it still listed
  HR's member-addressed routes. Regenerated; CI would have caught it.
- **`docs/employment-history.md` still gave HR's member-addressed paths.**
  Corrected to the employment.
- Gates held the new code to the rules: the site service first imported HR,
  which closed an import cycle through Finance and Sales (now a local date
  helper); by-id writes named the record before its company (now company
  first); state writes spread their data and named no prior status (now
  spelled out, with a stale write refused as a conflict).
- **A reseed after the full vitest suite fails seed validation**
  (`MEMBERSHIP_DRIFT` on the demo's planned employee `employee_emp_015`): a
  department test moves that login and the planned employment follows it, and
  the seed then restores the login alone. Found in a lane that the suite had
  run in, not in a fresh one; it predates E-04 and is left for its owner.

### 28.4 Limits

- **Timesheets and work logs are still a login's**; entry by a foreman,
  overtime, night work, pay bases and payroll are E-09's.
- **Qualifications, employee contracts and salary documents** are E-02's —
  qualifications to the person, contracts and salary documents to the
  employment, as the owner decided.
- **No merge** of two employees, no QA/QC, tools, driver or machine-operator
  records, no workforce dashboard or Workers figure (the group's employees
  figure counts everybody employed), no offline marking.
- **Demo workforce is ARMAAR's only**; the five-company demo has none. Site
  attendance is written on the first seed and does not move forward on a
  rerun.
- **`nesto_erp` lacks the E-01, E-13, E-03, D-01 and E-04 migrations.** With
  the owner's consent: `migrate deploy`, `access:sync`, then switch Workforce on
  per company (Settings → Modules) — a company without the row has the module
  off — and `seed:armaar` for the demo tenant.

## 29. Enhancement E-02 — employee documents and qualifications

E-02 gives every employee a file and every person their qualifications:
contracts, amendments, salary documents, diplomas, licences, certificates,
permits and a CV, each with a category, dates, a visibility and a
verification, reminded before it runs out, and one canonical file however many
places show it. It is reconciled onto the person and the employment rather than
the PRD's employee entity and `/team/[memberId]`:
[ADR 0007](adr/0007-e02-employee-documents-qualifications.md) classifies every
section and records thirteen decisions; `docs/employee-documents.md` and
`docs/employee-qualifications.md` are the contracts,
`docs/document-reference-model.md` and `docs/document-provider-integration.md`
the rules for referencing a file and for a later OneDrive. Built as the owner
decided before it started: qualifications to the person; contracts, amendments
and salary documents to the employment; HR's permissions plus a few; demo data
in ARMAAR only. Three stages: the model, its doors and API (188a2d6), the
screens (e6f4e8b), and the job's surfaces, search, reports, integrity and the
ARMAAR seed.

### 29.1 What changed

| Before | Now |
|---|---|
| An employee file was a document on the employment, nothing more: no category, dates or verification, and any HR reader in scope opened every file on it | **A link says what the file is** (`EmployeeDocumentLink`): one of 23 categories in seven groups, a business title, issuer, number, issue, expiry and in-effect dates, a visibility, a verification, current or not, what it renews or amends. One link per document; nothing is copied |
| — | **Four doors, by what the file is**: HR by class (professional files with `hr.document.view`; employment and identity papers also `hr.document.private.view`; pay evidence also `hr.compensation.view`), never onto their own file; the employee, every visibility but HR's own; Finance for pay documents shared with it; management for restricted ones. Colleagues see a verified, current summary the employee shares — never the file or its number |
| The Documents module read a record's files with the record's door | **The record registry's `documents.policy`** answers file by file for lists, opening, download, rename, archive and new versions, so the Documents module is no side door onto a contract |
| No skill or qualification anywhere | **`PersonQualification`**, the person's across the group: 13 types in six sections, a level for a skill or a language, five visibilities, its evidence an employee document filed in the company that recorded it |
| — | **Verification** as two state machines: verify or reject with a reason, resubmit, renew (the old one kept, superseded), supersede, archive with a reason; nobody verifies their own; every change names the version it was made against |
| — | **`hr.credential-expiry`**, daily per company in the company's day: reminders at 90, 60, 30 and 7 days and when the date passes, claimed in the idempotency ledger with their notice; a verified one becomes EXPIRED. Attention items for expiring, expired and unverified end on renewal or decision |
| — | **Screens**: the profile's *Documents* and *Skills & qualifications* tabs; the same list on HR's employee record; HR → Documents' worklists *To verify*, *Expiring in 30 days*, *Expired*; HR → Reports → *Qualifications* and *Employee documents* |
| Global search listed an employee's files by name to whoever could open them | **Employee files are out of global search**; a person is found by a qualification they share once verified ("Ethan Cole — AutoCAD · Skill · Advanced") |
| — | **Calendar** ("Driving licence expires"; with the person's name for HR; an HR-private kind is "HR document"), **profile activity** for shared qualifications verified, **nine permission keys**, 10 document and 8 qualification **audit actions** without sensitive values |
| — | **Provider identity on `Document`** for a later OneDrive or SharePoint: provider, drive, item, version, parent, path, web URL, etag, last sync, unique per company and item. Nothing writes it yet |
| `verify:employee-integrity` checked employments, logins and leave | It also checks **the file and qualifications**: a file on somebody else's record, self-checked evidence, a verification naming nobody, a superseded row still current, an amendment of a non-contract, a visibility the category forbids, evidence on another person's record |
| The ARMAAR tenant had no employee files | **18 files on seven employments** of ARLIS - NDERTIM and BUILDING CONSTRUCTION INVEST and **17 qualifications of seven people**: contracts and an amendment, a salary review shared with Finance, degrees, licences running out and one past its date, a renewed safety certificate, one waiting for HR, one sent back, a language kept private, two site workers without a login |

**Migration `20260919120000_employee_documents_e02`** is additive: six enums,
two tables (`employee_document_links`, `person_qualifications`) with composite
keys to their company, employment, person and group, checks on dates and
self-reference, nine provider-identity columns on `documents` with their unique
key and a both-or-neither check, and `externalVersionId` on
`document_versions`. It then files every employee document already there: a
link with a deterministic id, `POSITION_CHANGE` where E-03's history cites the
file, else `OTHER_HR`, visible to the employee and HR as before, archived where
the file was. A rerun adds nothing.

**Rollback:** the old code reads an employee's files with the record's door —
every HR reader in scope and the employee — so first archive the files whose
link is narrower than `EMPLOYEE_AND_HR` (`HR_ONLY`, `RESTRICTED_MANAGEMENT`,
`PRIVATE_EMPLOYEE`) or accept that they widen. Delete notifications and
attention items of the `EMPLOYEE_DOCUMENT_*` and `QUALIFICATION_*` kinds and
the job's ledger rows; remove the nine permission keys from roles. Then drop
the two tables, the documents' unique key, check and nine columns,
`document_versions.externalVersionId` and the six enums, and delete the
migration's `_prisma_migrations` row. The files themselves are ordinary
documents on the employment and stay.

### 29.2 The evidence

On freshly built databases, on the final tree:

- **vitest: 3 797 passed, 0 failed**, 11 skipped — 89 more than E-04: employee
  documents (18 — every door and class, unfiled files, the Documents module as
  no side door, verification and self-checking, renewal and amendment, stale
  pages, isolation), qualifications (10), HR's worklists (4), the surfaces (8 —
  calendar, search, activity, reports, integrity) and the expiry job's
  contract (9), and 40 cases of the state architecture test for the two new
  machines and their guarded writes.
- **E2E on the production build: 469 of 469**, none flaky. New (5): HR files
  a driving licence on the employee's record and verifies it; the employee
  adds a qualification, shares it with the group and sees their own licence; a
  colleague sees neither the file nor the unverified qualification; HR finds
  the qualification waiting, verifies it, and the colleague then sees its
  summary; on a phone the file, the qualifications and HR's worklist stay
  inside the viewport.
- **verify:roles 1 715 of 1 715** against the same production build.
- **verify:authorization** (647 routes, 316 server actions), **ownership** (238
  models, 57 domains, no cycle), **state** (47 machines, 246 transitions),
  **workers** (24 jobs) and **production-guards** pass; company-integrity,
  organization, employment, employee-integrity and demo are clean before and
  after the full suite; **security:matrix 1 056 endpoints**, none unguarded.
  Typecheck clean; lint 0 errors, 14 warnings (none new).
- The ARMAAR seed run twice leaves every count unchanged.
- **The migration** applied to an empty database and to a copy of
  `nesto_erp`'s data with every earlier migration; on that copy `access:sync`
  then `seed:armaar` added ARMAAR's employee files, and employment,
  employee-integrity, demo, company-integrity and organization stayed clean.
  `nesto_erp` holds no employee file, so the backfill was proven on a second
  copy brought to E-04 with four planted: a plain file became `OTHER_HR`, an
  archived one an archived link with its reason, one cited by E-03 history
  `POSITION_CHANGE`, each `EMPLOYEE_AND_HR` and unverified under its
  deterministic id; the fourth, naming another company's employment, got no
  link and employee-integrity reported it. Rerunning the backfill inserted
  nothing.

### 29.3 Defects found

- **E-04 broke the employee's own files in the Documents module.** Its
  self-service branch matched a file's record id against the reader's
  membership, and E-04 had re-keyed employee files to the employment, so an
  employee's own HR files never listed there. The branch now belongs to the
  employee record's policy, which matches the employment.
- **Global search listed employee files by name** to anybody who could open
  them — a contract's or a pay letter's title in ordinary search, which E-02
  §138-§140 keep to the employee's record. Excluded; a test holds it.
- **The Documents module would have been a side door**: it gave a reader every
  file on a record they reached, so an HR reader of professional files could
  have opened a contract there. Closed by the registry policy before any
  category existed to leak.
- **The favourites page reached server code from the browser.** It imported
  record types from the navigable registry, whose imports lead to the
  notification service and `node:async_hooks`; a webpack build failed on it
  (the turbopack build did not). The types moved to a client-safe module.
- The ownership gate caught a new **hr ↔ calendar import cycle** from the
  credentials' calendar provider; it lives with the calendar's other providers
  now. Screenshot review at 1 440 and 390 pixels found a flush table inside a
  padded card, a phone filter row too narrow for the search, and a skill form
  asking for an issuer and dates; all fixed.

### 29.4 Limits

- **Required documents** per role and `REQUIRED_DOCUMENT_MISSING` (§151-§152):
  no company policy configuration says what a role requires.
- **No profile photo** — E-01 deferred it here, but E-02's text does not ask
  for one.
- **No dashboard widgets** (§155-§156, optional).
- **The Finance and management doors are empty** until an owner grants
  `hr.document.finance.view` or `hr.document.restricted.view`; only the Owner
  holds them by default.
- **No OneDrive or SharePoint**: the identity columns and the rules an
  integration must honour, nothing that talks to Microsoft.
- **Demo files and qualifications are ARMAAR's only**; the five-company demo
  has none.
- **`nesto_erp` lacks the E-01, E-13, E-03, D-01, E-04 and E-02 migrations.**
  With the owner's consent: `migrate deploy`, `access:sync`, then `seed:armaar`
  for the demo tenant.
