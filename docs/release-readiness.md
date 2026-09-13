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
