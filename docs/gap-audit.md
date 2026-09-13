# Repository gap audit

Per PRD #36 §296–§299. Pinned to **`43d4886`**, branch
`nesto-v0.1-foundation-and-design-system`, 2026-09-13.

Method is §298 — for every PRD: locate code, inspect model, inspect API,
inspect permission, inspect UI, inspect tests, classify. Statuses are §297.
Weights are §235 (P0=5, P1=3, P2=2, P3=1).

The audit is written from evidence in the tree at that SHA, not from the commit
log. Where a PRD says a thing works, the check was to find the code that makes
it work and the caller that reaches it — a service nothing calls is not a
feature, however complete it looks.

---

## 1. Overall weighted progress

35 PRDs are tracked (#35 is the release gate, #36 is this document; both are
excluded). Total active weight **118**.

| Measure | Result |
|---|---|
| Strict — `DONE` only, as §235 defines it | **77 / 118 = 65.3 %** |
| Weighted by evidenced completion | **108.0 / 118 = 91.5 %** |

| Priority | PRDs | Strict | Weighted |
|---|---|---|---|
| P0 | 8 | 75.0 % | 90.6 % |
| P1 | 24 | 62.5 % | 93.4 % |
| P2 | 3 | 33.3 % | 75.0 % |

Both numbers are given because they answer different questions. §235's formula
is binary, and by it a PRD with one unmet line out of seventy scores zero — so
strict progress reads low while the product is substantially built. The
weighted column carries a judged completion fraction per PRD and is the better
guide to remaining effort; it is a judgement, not a measurement.

The gap between them is the real finding: **no PRD is far from done, but
thirteen are not done**, and four of those are missing something structural
rather than cosmetic.

---

## 2. Module readiness (§275)

| Module | Schema | Backend | UI | Permission | Integration | Reports/Search | Prod Ready |
|---|---|---|---|---|---|---|---|
| Projects | ✅ | ✅ | ✅ | ✅ | ✅ | search ✅ | ✅ |
| Tasks | ✅ | ✅ | ✅ | ✅ | ✅ | search ✅ | ✅ |
| Clients | ✅ | ✅ | ✅ | ✅ | ✅ | search ✅ | ✅ |
| Documents | ✅ | ✅ | ✅ | ✅ | ✅ | search ✅ | ✅ |
| Finance | ✅ | ✅ | ⚠️ | ✅ | ✅ | reports ✅ search ✅ | ⚠️ |
| HR | ✅ | ✅ | ✅ | ✅ | ✅ | reports ✅ | ✅ |
| Sales | ✅ | ✅ | ⚠️ | ✅ | ✅ | reports ✅ search ✅ | ⚠️ |
| Legal | ✅ | ✅ | ⚠️ | ✅ | ✅ | reports ✅ **search ✗** | ⚠️ |
| Procurement | ✅ | ✅ | ⚠️ | ✅ | ✅ | reports ✅ **search ✗** | ⚠️ |
| Inventory | ✅ | ✅ | ✅ | ✅ | ✅ | reports ✅ **search ✗** | ⚠️ |
| QA/QC | ✅ | ✅ | ⚠️ | ✅ | ✅ | reports ✅ **search ✗** | ⚠️ |
| HSE | ✅ | ✅ | ⚠️ | ✅ | ✅ | reports ✅ **search ✗** | ⚠️ |
| Team | ✅ | ✅ | ✅ | ✅ | ✅ | search ✅ | ✅ |

⚠️ in **UI** means one or more server actions exist with no interface reaching
them (§6.4). ⚠️ in **Prod Ready** follows §237: a module is not production-ready
while a documented capability has no route to it.

Scale at this SHA: 117 models, 138 enums, 20 migrations, 564 permissions,
355 pages, 217 API routes, 273 components, 279 service files, 1 368 vitest
across 52 files, 320 Playwright, 870 role-walk checks, 12 production guards.

---

## 3. Status by PRD (§297)

| PRD | Area | Pri | Status | Note |
|---|---|---|---|---|
| #1 | Product Foundation | P1 | DONE | |
| #2 | Design System | P1 | DONE | |
| #3 | Application Shell | P1 | DONE | |
| #4 | Module Shell | P1 | DONE | |
| #5 | Roles & Permissions | P0 | DONE | 564 permissions; 870/870 role walk |
| #6 | Authentication | P0 | DONE | |
| #7 | Dashboard | P1 | DONE | |
| #8 | Core Data Model | P0 | DONE | |
| #9 | Demo Data & Testing | P1 | DONE | |
| #10 | Projects | P1 | DONE | |
| #11 | Tasks | P1 | DONE | |
| #12 | Clients | P1 | DONE | |
| #13 | Documents | P1 | DONE | |
| #14 | Team | P1 | DONE | |
| #15 | Finance | P1 | PARTIAL | `voidPaymentAction` unreachable |
| #16 | HR | P1 | DONE | |
| #17 | Sales | P1 | PARTIAL | 3 assignment/duplicate actions unreachable |
| #18 | Legal | P1 | PARTIAL | owner assignment unreachable; attention list paged (§6.9) |
| #19 | Procurement | P1 | PARTIAL | 2 actions unreachable |
| #20 | Inventory | P1 | DONE | |
| #21 | QA/QC | P1 | PARTIAL | 1 action unreachable |
| #22 | HSE | P1 | PARTIAL | 1 action unreachable |
| #23 | Cross-Module Integration | P0 | PARTIAL | engine unused (§6.5) |
| #24 | Company Settings | P1 | PARTIAL | numbering never applied (§6.6) |
| #25 | Notifications | P1 | PARTIAL | nothing produces a notification (§6.2) |
| #26 | Global Search | P1 | PARTIAL | 5 required providers absent (§6.3) |
| #27 | Reporting | P2 | PARTIAL | metric registry unused (§6.7) |
| #28 | Audit Log | P0 | PARTIAL | 9 of 52 actions recorded (§6.1) |
| #29 | File Storage | P0 | DONE | deferrals documented in code |
| #30 | Production Security | P0 | DONE | 12 guards |
| #31 | Performance & Caching | P2 | PARTIAL | cache never used (§6.8) |
| #32 | Observability | P1 | DONE | |
| #33 | Backup & Retention | P2 | DONE | legal hold deliberately deferred |
| #34 | Deployment & CI/CD | P1 | DONE | |
| #37 | Master Prisma Schema | P0 | DONE | |

---

## 4. Critical blockers

One, at P0:

**The audit log records 9 of its 52 registered actions**, and 30-odd of the
missing ones are declared `required: true` — meaning the codebase itself states
they must not be allowed to happen unaudited. Detail in §6.1.

Nothing else blocks release on correctness grounds. The remaining findings are
absent features and dead infrastructure, not wrong behaviour.

---

## 5. Verified-clean invariants

Stated because a gap audit that only lists faults implies the rest was
inspected and was fine, which it should have to show.

- **Route authorisation.** 213 of 217 API routes resolve through
  `withContext`. The four exceptions are correct by design: the NextAuth
  handler, the two health probes, and the storage object route whose HMAC
  signature *is* the authorisation.
- **Action authorisation.** 248 of 255 server actions call a guard. The seven
  that do not are the genuinely public ones — sign in, sign out, password
  reset request and completion, the contact form, and the two dev/demo actions
  that `scripts/verify-production-guards.ts` proves are environment-gated.
- **Filter values do not leak.** Every `*FilterOptions` function takes the
  context and derives its options from records within scope
  (`where: { …, tasks: { some: scope } }`), so a dropdown cannot name a project
  the reader is refused. This is an explicit DoD line in several module PRDs
  and it genuinely holds.
- **No cross-company IDOR found.** 80 `findUnique`/`findFirst` calls whose
  where-clause carries no `companyId` were examined individually. Each either
  uses a `buildXWhere(context)` scope helper, addresses a genuinely global
  model (`Role`, `Module`, `User`, `Session`, token lookups), or re-reads a row
  whose ownership was proven immediately above — `updateParty` verifies
  `{ id: partyId, contractId }` before updating by bare id.
- **Money.** Every monetary column is `Decimal` with explicit precision; no
  `Float` or `Int` money anywhere. 40 columns at `(18,2)`, 35 at `(18,4)`.
- **Indexes.** 86 of 88 `companyId`-bearing models lead an index or unique
  constraint with `companyId`. The two that do not declare `companyId String @id`,
  which is the primary key.
- **No list-path N+1.** List repositories use
  `$transaction([findMany({ take }), count({ where })])` — paging and counts
  both database-side. The 16 awaited queries inside loops are all per-row
  writes in a transaction or bounded maintenance batches (≤ 500).
- **Rate limiting is wired** on search, upload and download.

---

## 6. Architecture violations and gaps

### 6.1 The audit log covers 9 of 52 registered actions — P0, #28

The writer works. `recordUserAction` and `recordSystemAction` are called from
six services — the three settings services and the three document-storage
services — and the read half (`listAuditEvents`, `/api/audit`, the settings
page) is fully wired. Redaction, the policy registry and the required-policy
transaction rule are all implemented and correct.

What is missing is call sites. `audit-policy.registry.ts` registers **52**
actions. Exactly **9** are emitted:

```
COMPANY_BASE_CURRENCY_CHANGED   COMPANY_INTEGRATION_SETTING_CHANGED
COMPANY_MODULE_ENABLED          COMPANY_MODULE_DISABLED
COMPANY_SETTINGS_UPDATED        COMPANY_TIMEZONE_CHANGED
DOCUMENT_DOWNLOAD_GRANTED       DOCUMENT_PREVIEW_GRANTED
DOCUMENT_REJECTED_MALWARE
```

The other 43 are registered, given a category, a severity, a snapshot mode and
a redaction list — and never recorded. They include every `FINANCIAL` action
(invoice approved/rejected/voided, payment recorded/reversed, expense approved,
budget approved, commitment created/cancelled), every `ACCESS_CONTROL` action
(member invited, role changed, suspended, deactivated, reactivated, department
changed), `HR_COMPENSATION_CHANGED` and `HR_EMPLOYMENT_STATUS_CHANGED`, the
`AUTHENTICATION` family, `SALES_PROPOSAL_ACCEPTED`, the project lifecycle and
the report-export actions.

Most of those carry `required: true`, which `audit.service.ts` defines as
writing inside the caller's transaction so that a failed audit rolls the
business mutation back — "an action that must be auditable is not allowed to
happen unaudited". The declaration is in the tree; the enforcement is not.

So the gap is not that nothing is recorded. It is that what a compliance
reviewer would ask for first — who approved this invoice, who changed this
salary, who was given this role — is exactly what is absent, while settings
changes and document downloads are captured faithfully.

Status **PARTIAL**. Complexity **M**: mechanical but broad, and the
`required: true` ones must be passed the caller's `tx`.

### 6.2 Notifications are never produced — P1, #25

Four models (`Notification`, `AttentionItem`, `NotificationPreference`,
`NotificationEventOutbox`), 389 lines of service, three read routes.

- No caller anywhere for `createNotification`, `enqueueNotificationEvent`,
  `upsertAttention`, `resolveAttention`, `suppressModuleAttention`.
- `markRead`, `markAllRead` and `dismissAttention` have neither a route nor a
  server action, so even the read-side controls are unreachable from the UI.
- No dedicated test anywhere in the suite.
- The seed creates no notification rows, so the feature is empty in the demo
  as well as in production.

Status **PARTIAL**. Complexity **L** — the producers have to be chosen and
placed across twelve modules, which is design work, not wiring.

### 6.3 Global search is missing five required providers — P1, #26

PRD #26 names each provider explicitly. Seven exist (project, task, client,
document, member, invoice, opportunity). Absent: **legal/contracts,
procurement, inventory, QA/QC, HSE**.

Consequence: a user searching for a contract number, a purchase order, a stock
item, an NCR or an incident gets nothing, with no indication that whole modules
are outside the index.

Status **PARTIAL**. Complexity **M** — the registry, ranking, isolation and
permission plumbing all exist and are proven by the seven live providers.

Note: a parent-access bypass in the document provider was found and fixed at
`7d33d98`; the regression test lives in `tests/integration/access/scope.test.ts`.

### 6.4 Thirteen server actions have no interface

Verified individually as having zero references outside `lib/actions/`:

| Module | Action |
|---|---|
| Legal | `assignContractOwnerAction` |
| Finance | `voidPaymentAction` |
| HSE | `updatePpeCheckAction` |
| Procurement | `inviteSupplierAction`, `orderFromQuoteAction` |
| QA/QC | `removeMaterialDecisionAction` |
| Sales | `assignLeadAction`, `assignOpportunityAction`, `checkLeadDuplicatesAction` |
| Settings | `setModuleEnabledAction`, `updateNumberingSchemeAction` |

Each maps to a DoD line in its PRD — "assignment works", "module enable/disable
works", "duplicate detection works". The server half is written, tested at the
service layer, and unreachable by a person using the product.

`setModuleEnabledAction` is the sharpest: PRD #24 requires module enablement to
be configurable, and the page that would do it does not call the action.

Status **PARTIAL** per module. Complexity **S** each.

### 6.5 The integration engine is unused — P0, #23

`runIntegration`, `listIntegrationLinks`, `integrationDefinitions` and
`recordIntegrationAction` have no callers; `IntegrationLink` rows are written
only inside `runIntegration`, so none are ever written.

The cross-module behaviours themselves are implemented and are idempotent —
`order.service.ts` documents "one commitment per order… keyed on the order, so
a retry", and `linkProject` sets `convertedProjectId` rather than creating, so
repeating it is harmless. So the functional DoD lines hold.

What does not hold are the lines requiring a durable trace: "IntegrationLink
exists", "IntegrationAttempt status is recorded", "correlation IDs exist for
cross-module actions". Those are satisfied by a component nothing runs.

Status **PARTIAL**: behaviour complete, observability absent.

### 6.6 Numbering schemes govern nothing — P1, #24

`allocateNumber` is never called. Invoice and contract numbers come from
`input.invoiceNumber` / `input.contractNumber` — typed by the user, checked for
uniqueness by `assertNumberIsFree`. `formatNumber` is used only to render a
preview on the settings page.

So an administrator can configure a numbering scheme, see it previewed, save
it, and have it apply to nothing. Combined with §6.4's unreachable
`updateNumberingSchemeAction`, the scheme cannot even be changed.

Status **PARTIAL**. Complexity **M** — allocation must be transactional and
gap-free under concurrency.

### 6.7 The reporting metric registry is unused — P2, #27

`metricDefinitions`, `findMetric`, `assertSingleCurrency`, `groupByCurrency`
and `groupByUnit` have no callers. Each module's `reports.service.ts` computes
its own figures.

The reports work. What is lost is the guarantee the registry exists for: that
"revenue" means the same thing in two modules, and that a report never sums
across currencies. `assertSingleCurrency` is the guard against exactly that,
and it is not in any path.

Status **PARTIAL**.

### 6.8 The caching layer is never used — P2, #31

`cached`, `getCached`, `setCached`, `invalidateNamespace`, `cacheKey` and
`accessSignature` have no production caller — only `tests/unit/cache/`. PRD #31
is therefore satisfied in unit tests and nowhere else.

No correctness impact. `accessSignature` deserves a note: it exists so a cache
entry cannot outlive the permissions that produced it, which is the part that
would be dangerous to add carelessly later.

Status **PARTIAL**.

### 6.9 Contract attention lists are computed over one page — P2, #18

`contractAttention` derives `renewalNoticeDue` and `inactiveOwners` by
filtering the first 50 ACTIVE contracts sorted `expiry-asc`, in memory.

`renewalNoticeDue` is largely fine — soonest-expiring first correlates with
renewal urgency. `inactiveOwners` does not correlate with expiry at all, so a
contract with a departed owner that expires in two years is invisible to the
attention list no matter how much it needs attention.

An attention surface that silently under-reports is worse than none, because
people stop checking manually. Status **NEEDS_REFACTOR**, complexity **S** —
the filter belongs in the query.

### 6.10 Smaller items

- `purgeExpiredSessions` is never scheduled; expired sessions accumulate
  indefinitely. **S**.
- `bootstrapCompanyConfiguration` and `invalidateCompanyConfig` are never
  called, so a newly created company receives no configuration bootstrap. **S**.
- `assertKeyBelongsToCompany` (#29, mine) is never called. Not a
  vulnerability — the signed URL binds the key, and a signature is only issued
  for a document the reader passed scope on — but it is a security helper whose
  presence implies a check that does not happen. Either wire it as
  defence-in-depth or delete it. **XS**.
- 16 `no-unused-vars` lint warnings (0 errors) across six files, all dead
  bindings from the module commits. **XS**.
- `--color-surface-2` is referenced by roughly 14 pages and never defined. It
  lives in `styles/globals.css`, owned by a concurrent session, and was left
  alone deliberately. **XS**.

---

## 7. Missing tests (§299)

Ranked by what the absence would let through.

| Area | Gap | Priority |
|---|---|---|
| Notifications #25 | No test of any kind. Appears in one unrelated retention test. | P1 |
| Audit #28 | The 43 unwired actions have no test asserting they record. | P0 |
| Caching #31 | Unit tests only, and they test code no request executes. | P2 |
| Integrations #23 | `runIntegration` idempotency and retry untested. | P1 |
| Numbering #24 | `allocateNumber` untested and uncalled. | P2 |
| Search #26 | No provider-level test for the five absent modules. | P1 |
| Settings #24 | Module enable/disable has no end-to-end coverage. | P1 |

The suite is strong where it exists — 1 368 vitest, 320 Playwright, 870 role
checks, authorisation never mocked, tests run against a real database. The
pattern in the gaps is consistent: **the untested areas are precisely the
unwired ones.** Nothing that runs in production is meaningfully untested.

---

## 8. Next implementation tasks (§299)

In dependency order. Complexity per §7 of the tracker.

| # | Task | PRD | Pri | Cx |
|---|---|---|---|---|
| 1 | Emit the 43 registered-but-silent audit actions, `tx` where required | #28 | P0 | M |
| 2 | Produce notifications and attention items from module events | #25 | P1 | L |
| 3 | Routes/actions for `markRead`, `markAllRead`, `dismissAttention` | #25 | P1 | S |
| 4 | Search providers: legal, procurement, inventory, QA/QC, HSE | #26 | P1 | M |
| 5 | Wire the 13 unreachable server actions into the UI | various | P1 | S×13 |
| 6 | Apply numbering schemes via `allocateNumber` | #24 | P1 | M |
| 7 | Record `IntegrationLink`/attempt traces on cross-module flows | #23 | P0 | M |
| 8 | Move contract attention filtering into the query | #18 | P2 | S |
| 9 | Route reports through the metric registry; enforce single currency | #27 | P2 | M |
| 10 | Use the cache on the hot read paths, keyed by access signature | #31 | P2 | M |
| 11 | Schedule session purge and company config bootstrap | — | P2 | S |
| 12 | Tests for every item above | — | P1 | M |

Then PRD #35 — Final System Integration & Release — which gates on this list:
its 26 critical workflows and its release-gate record cannot honestly be signed
off while a P0 blocker stands.

---

## 9. Deliberate deferrals

Recorded so they are not rediscovered as defects. Each is documented in the
code that defers it.

- **Thumbnails** (#29 §51, §53) — not generated.
- **Multipart upload** and its abort rule (#29 §124, §126, §228).
- **A real antivirus engine** (#29). The EICAR scanner is the honest test
  implementation per §373; with no scanner configured a file records
  `NOT_REQUIRED`, never `CLEAN`.
- **Legal hold** (#33 §75, §76). `isUnderLegalHold` returns `false` and says
  why: V0.1 has no hold UI, and the signature exists so adding one later means
  implementing one function rather than revisiting every policy. Two policies
  already declare `legalHoldAware: true`.

---

## 10. Addendum — what has been closed since

The audit above stays as it was written, pinned to `43d4886`. This section
records what changed afterwards, so the two can be read together rather than
the snapshot being quietly edited to look better than it was.

| § | Finding | Status | Commit |
|---|---|---|---|
| 6.1 | Audit log recorded 9 of 52 actions | **Closed** — 50 of 51 emitted | `a43d612` |
| 6.2 | Nothing produced a notification | **Closed** — producers, dispatcher, read routes | `9c5eb9d` |
| 6.3 | Five search providers absent | **Closed** — plus the `/search` page, which was also missing | `3a84bf9` |
| 6.5 | Integration engine unused | **Closed** — handoffs now write links and attempts | `1f685ec` |
| 6.4 | Thirteen unreachable server actions | **Closed** — every one now has an interface | `11a781c` |
| 6.6 | Numbering schemes govern nothing | **Closed** — invoices and expenses allocate through the scheme | `8ab0235` |
| 6.9 | Contract attention computed over one page | **Closed** — asked of the database | `6ae19b8` |
| 6.10 | Session purge, company config bootstrap | **Closed** — one was a duplicate and is deleted; the other is documented scaffolding | `6ae19b8` |
| 6.7 | Reporting metric registry unused | Open — P2 | — |
| 6.8 | Caching layer never used | Open — P2 | — |

**Both P0s and every P1 are closed.** Two P2s remain, both "implemented but not
wired" rather than anything incorrect, and both are carried into the release
record's known-limitations registry (`docs/release-readiness.md` §8).
`REPORT_EXPORTED_XLSX` remains deliberately silent and is an enforced exemption
in `tests/unit/audit/audit-coverage.test.ts`.

### Found while fixing, not in the original audit

- **The topbar command palette is a placeholder.** `Cmd+K` opens a panel that
  never calls `/api/search`; its own comment says the search "is not built in
  V0.1". So #26's UI half was unwired, not only its providers. The file is
  `components/layout/global-search.tsx`, which a concurrent session owns, so it
  was left alone and the `/search` page built instead.
- **The `/search` page did not exist at all**, though §12 requires it.
- **`.next-e2e` was not in the eslint ignore list**, a consequence of the
  isolated build directory added in `43d4886`. Fixed in `a43d612`.

### Guards added against regression

- `tests/unit/audit/audit-coverage.test.ts` fails if any registered audit
  policy has no call site, and separately if any `required` one does. This is
  the test that would have caught §6.1 on the day it appeared.
- `tests/api/search/search-providers.test.ts` fails if any module PRD #26 names
  has no registered provider.
- `tests/api/notifications/notification-dispatch.test.ts` follows a real
  assignment from producer to recipient, including the suspended-recipient case.
- `tests/api/integrations/integration-links.test.ts` holds the
  one-link-per-handoff guarantee.

Test count over this work: **1 368 → 1 440**, all passing, lint 0 errors.

The release review that followed (PRD #35) found two more things this audit had
not: Workflow K was implemented but entirely untested, and Workflow L — Sales
quote to invoice — did not exist at all. Both are recorded in
`docs/release-readiness.md` §2.

### PRD #38 (2026-09-14)

The "found while fixing" items above are closed by PRD #38: the topbar palette now
queries `/api/search` (`2550098`), and the notification layer gained a real bell,
preferences, a leased worker and re-authorising links. The full PRD #38 re-audit —
blockers, readiness matrix and weighted readiness — is `docs/release-readiness.md`
§10. New regression guards: registry-generated record/collaboration/document parent
matrices (`tests/api/records/record-parent-matrix.test.ts`), notification, attention
and job registry completeness (`tests/unit/notifications/notification-registry.test.ts`,
`tests/unit/records/record-registry.test.ts`), and production guards for the scanner,
the worker boundary and self-hosted fonts.
