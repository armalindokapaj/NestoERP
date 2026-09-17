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
