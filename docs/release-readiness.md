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

The foundation is in place and two domains are on it. A controlled record now
moves by a declared transition, and the state it moves from is part of the
write rather than an `if` above it. The contract is `docs/state-machines.md`;
`docs/document-lifecycle.md` and `docs/audit-model.md` write down what was
already built by PRDs #13, #28 and #29 and had never been stated in one place.

### 13.1 What is enforced

| Gate | What it refuses |
|---|---|
| `pnpm verify:state` | A machine governing a model its domain does not own; a machine file nothing registers; any file gaining a state write that does not name a state column in its `where`. |
| `pnpm test:architecture` | The same rules from the test runner, plus a named test for each claim the machines make about the code. |
| `pnpm test:state` | A guarded transition against the real database: the stale case, the simultaneous case, the foreign-company case, the replay. |

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

- **Two domains of about twenty are on machines.** HSE and QA/QC were chosen
  because a lost transition on a safety or quality record loses the evidence
  that something was dealt with. Everything else still transitions through its
  own service, held by the ratchet rather than converted. The baseline is the
  backlog, and it is 176 writes across 55 files.
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
