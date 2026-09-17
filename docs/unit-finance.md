# A unit's contract and collection (E-05F)

A unit sale reaches Legal and Finance on the same canonical unit E-05B created,
E-05D publishes and E-05E reserves. There is no Legal copy of a unit and no
Finance copy of a sale: Sales asks Legal for the contract, Legal drafts a
**sale agreement** from the reservation's client, deal and agreed price, and
Finance collects against that contract with a payment schedule, invoices and
payments allocated to what they settle.

```
ONE UNIT · ONE LIVE CONTRACT · ONE ACTIVE SCHEDULE · MANY PAYMENTS · ONE ALLOCATION ENGINE
```

```
Sales                     Legal                               Finance
─────                     ─────                               ───────
Reserved unit
  │ Request contract
  ↓
OPEN request ──decline (reason)──→ DECLINED
  │  (withdraw / reservation ends → CANCELLED)
  │ Draft contract (+ other units of the same client, deal, project, currency)
  ↓
FULFILLED   Contract DRAFT → Under review → Ready for signature
                          → Sent for signature → SIGNED → ACTIVE
                                                  │        │ Create schedule (DRAFT)
                                                  │        │ Activate → ACTIVE
                                                  │        │ Raise invoice per installment
                                                  │        │ Record payment → allocations
                                                  │        ↓
                                                  │   FINANCIALLY_COMPLETE
                                                  │        │
                                                  └── complete ──→ COMPLETED (schedule completes)
                   cancel / terminate / expire → units released, schedules cancelled
```

The contract keeps the Legal module's statuses (§9); the unit page names two of
them the E-05F way: `IN_REVIEW` reads *Under review* and `APPROVED` reads *Ready
for signature*. `COMPLETED` is new, reached only from `ACTIVE` and only once the
contract is financially complete.

## Where things live

| Concern | Location |
| --- | --- |
| The one allocation engine: allocate, reverse, what a payment has left | `lib/modules/finance/payments/payment.allocations.ts` |
| Paid amounts for invoices, expenses, installments, contracts and payments | `lib/modules/finance/finance.settlement.ts` |
| Statuses, labels, DTOs (client-safe) | `lib/modules/finance/units/unit-finance.types.ts` |
| Installment and financial status, schedule target, allocation proposal (pure) | `lib/modules/finance/units/unit-finance.rules.ts` |
| Contract facts, capabilities, the Sold readiness Sales reads | `lib/modules/finance/units/unit-finance.core.ts` |
| Schedules, installment invoices, contract payments and allocations; the doors Legal calls | `lib/modules/finance/units/unit-finance.service.ts` |
| Audit, activity and notifications for money | `lib/modules/finance/units/unit-finance.events.ts` |
| The project's Finance units query | `lib/modules/finance/units/unit-finance.inventory.ts` |
| The installments job | `lib/modules/finance/units/unit-finance.overdue.ts` (`finance.unit-installments`) |
| Schedule machine | `lib/modules/finance/units/payment-schedule.machine.ts` (`payment_schedule`) |
| Requests, drafting from a request, unit values | `lib/modules/contracts/units/unit-contract.service.ts` |
| What a sale contract's moves do to its units and schedules | `lib/modules/contracts/units/sale-contract.ts` (called from `contract.service.ts`) |
| Request machine | `lib/modules/contracts/units/unit-contract-request.machine.ts` (`unit_contract_request`) |
| The Sold rule and sale approvals | `lib/modules/sales/units/unit-sales.rules.ts` (`canMarkUnitSold`), `unit-sale-approval.service.ts`, approvals provider `lib/modules/approvals/providers/unit-sales.provider.ts` (`unit_sales`) |
| The company's Sold rule | `lib/modules/settings/sales-settings.service.ts` (`CompanySettings.unitSoldRule`) |
| API | see [API](#api) |
| UI | `components/contracts/unit-contract/*`, `components/finance/unit-finance/*`, `app/(nesto)/projects/[projectId]/units/[unitId]/{legal,finance}`, `app/(nesto)/projects/[projectId]/finance/units`, `app/(nesto)/contracts/requests`, `app/(nesto)/settings/sales` |
| Demo data | `prisma/seed/unit-finance.ts` |

Ownership (`scripts/architecture/ownership.ts`): **finance** owns
`PaymentAllocation`, `PaymentSchedule` and `PaymentInstallment`; **contracts**
owns `ContractUnit` and `UnitContractRequest`; **sales** owns `UnitSaleApproval`.
The import edges are the ones that already existed — contracts reads finance and
sales, sales and finance read each other. Finance never imports contracts: when
Legal cancels, terminates or completes a sale contract, `sale-contract.ts` calls
finance's doors (`cancelSchedulesWithContract`, `contractFinancialStatus`,
`completeScheduleWithContract`). Sales asks finance whether a unit is ready to be
sold (`unitSaleReadiness`), never the contract tables.

## Data

Migration `20260918090000_unit_finance_e05f`.

- **ContractUnit** — a unit on a contract: its `value` and `currency` (the
  contract value is their sum), a `valueNote` when the value differs from the
  agreed price, and `releasedAt`/`releaseReason` once the contract stops being
  live for it.
- **UnitContractRequest** — Sales asking Legal: the unit, reservation, client and
  deal it was asked for, `status` (`OPEN`, `FULFILLED`, `DECLINED`,
  `CANCELLED`), notes, who asked and when, the contract it became, who closed it
  and why.
- **PaymentSchedule** — per contract, versioned: `versionNumber`, `status`
  (`DRAFT`, `ACTIVE`, `SUPERSEDED`, `COMPLETED`, `CANCELLED`), `currency`, a
  `totalExceptionReason` when its total deliberately differs, who activated,
  superseded, cancelled or completed it.
- **PaymentInstallment** — `sequence`, `label`, `type` (`DEPOSIT`,
  `INSTALLMENT`, `BALANCE`, `OTHER`), `amount`, `currency`, `dueDate`. Its status
  is derived, never stored.
- **PaymentAllocation** — part of a payment settling one thing: an installment
  (with its contract), an invoice, both, or an expense; `amount`; reversed softly
  with `reversedAt`, who and why. Never deleted.
- **UnitSaleApproval** — a sale waiting for approval under the Manual approval
  rule, for one reservation; pending, approved, rejected or cancelled.
- **Payment** gains `clientId`, `projectId`, `contractId` and
  `replacesPaymentId` (a payment recorded to replace a voided one) and **loses
  `invoiceId` and `expenseId`**.
- **Invoice** gains `contractId` and `installmentId`.
- **Contract** gains `completedAt` and `completedByMemberId`; `ContractStatus`
  gains `COMPLETED`, `ContractType` gains `SALE_AGREEMENT`.
- **CompanySettings.unitSoldRule** — `RESERVATION`, `SIGNED_CONTRACT` (default),
  `DEPOSIT_RECEIVED`, `SIGNED_CONTRACT_AND_DEPOSIT`, `MANUAL_APPROVAL`.

### The one step that is not additive

A payment used to settle exactly one invoice or one expense through
`payments.invoiceId` / `payments.expenseId`. Every payment now settles through
allocations, so the migration first gives each existing payment its client and
project from what it paid, then writes **one allocation of its whole amount**
(`alloc_<paymentId>`) to that invoice or expense, and only then drops the two
columns and the old one-parent check. A voided payment's allocation counts for
nothing, exactly as the voided payment did. The backfill was run on a restored
copy of the development database first: every invoice and expense read the same
paid amount before and after.

Anything reading `payments.invoiceId` or `payments.expenseId` — the invoice and
expense pages, the finance overview, KPIs, reports, attention conditions, the
calendar provider — now reads live allocations (`finance.settlement.ts`).

### Held by the database, not only the service

| Rule | How |
| --- | --- |
| One live contract per unit (§8) | partial unique `contract_units_one_live_per_unit` on `(unitId) WHERE releasedAt IS NULL` |
| One open request per unit (§12) | partial unique `unit_contract_requests_one_open_per_unit` |
| One active and one draft schedule per contract (§20, §25) | partial uniques `payment_schedules_one_active_per_contract`, `…_one_draft_per_contract` |
| One live invoice per installment (§26) | partial unique `invoices_one_live_per_installment` (not cancelled or archived) |
| One pending sale approval per unit (§42) | partial unique `unit_sale_approvals_one_pending_per_unit` |
| An allocation settles an expense alone, or an installment and/or an invoice; it names a contract exactly when it names an installment; it moves money | `payment_allocations_one_target`, `…_contract_with_installment`, `…_amount_positive` |
| An installment, its schedule, its invoice and its allocations belong to one contract | composite FKs `(installmentId, contractId)`, `(scheduleId, contractId)`; `invoices_installment_names_contract` |
| A contract's units, schedules and requests belong to its company, and a unit's rows to its project and company | composite FKs `(contractId, companyId)` → `contracts`, `(unitId, projectId, companyId)` → `project_units` |
| A receipt names its client; a disbursement names no client and no sale contract | `payments_receipt_names_client`, `payments_disbursement_has_no_client` |
| No negative installment or unit value; sequence and version from 1 | `CHECK` constraints |

## Rules

### The contract (Legal)

| Rule | Where |
| --- | --- |
| Sales asks for a contract only for a unit it holds reserved, once: *A contract has already been requested for this unit.* (§12) | `requestUnitContract`; `CONTRACT_ALREADY_REQUESTED` |
| A request whose reservation has ended reads *Withdrawn — The reservation ended.*; the stale row is closed when the next request is made | `listContractRequests`, `requestUnitContract` |
| Legal drafts only from an open request: *Sales has not requested a contract for this unit yet.* The client, deal, project and currency come from the reservation; each unit's value starts at its agreed price, and a different value needs a note (§13, §14) | `createUnitContract`; `CONTRACT_NOT_REQUESTED`, *Record the agreed price on the reservation first.* |
| More units join the same contract only when reserved for the same client, deal, project and currency — an apartment with its parking (§15) | `createUnitContract` candidates |
| A unit has one live contract: *This Unit already has an active primary Contract.* (§8) | the partial unique index; `UNIT_CONTRACT_EXISTS` |
| The contract number is typed, or given by the company's numbering when it is automatic | `allocateNumber` |
| Every move of a sale contract needs the unit grant as well as the Legal one — `sign_status` to send for signature, record the signature or activate; `review` to review; `cancel` to cancel, terminate or expire; `update` to edit; `amend` to amend (§54) | `assertSaleContractGrant` in `contract.service.ts` |
| The generic contract form cannot create a sale agreement; editing one cannot change its type, client, deal, project, value or currency: *A sale contract's type, client, deal, project, value and currency come from the units it sells.* | `createContract`, `assertSaleTermsUnchanged`; `SALE_CONTRACT_TERMS_FIXED` |
| A unit's value changes only while the contract is a draft; an approved contract changes by amendment | `updateContractUnitValue`; `CONTRACT_TERMS_FROZEN` |
| A draft sale contract is not archived | `assertSaleContractArchivable` |
| Cancelling, terminating or expiring a sale contract releases its units and cancels its schedules, with the reason, in the same transaction (§82) | `afterSaleContractMove` → `cancelSchedulesWithContract` |
| Recording the signature audits `UNIT_CONTRACT_SIGNED` and tells the contract owner, the salesperson and the deal owner | `afterSaleContractMove` |
| Completing needs an active contract that is **financially complete**, and completes its schedule (§86) | `completeContract`; `CONTRACT_NOT_FINANCIALLY_COMPLETE` |
| A unit under a live contract keeps its reservation: the expiry job skips it, and releasing the reservation or reopening the sale is refused (§45) | `unit-sales.expiry.ts`, `assertNoLiveContract`; `UNIT_UNDER_CONTRACT` |

### The schedule (Finance)

| Rule | Where |
| --- | --- |
| A schedule is drafted for a contract with a value and currency; one draft at a time: *This contract already has a draft schedule. Edit that one.* (§20) | `createPaymentSchedule`; `CONTRACT_VALUE_MISSING`, `SCHEDULE_DRAFT_EXISTS` |
| A draft is edited as a whole; the version it read is checked | `updatePaymentSchedule`; `SCHEDULE_STALE` |
| Activation needs a signed, active or completed contract: *A payment schedule is activated once the contract is signed.* (§21) | `activatePaymentSchedule`; `CONTRACT_NOT_SIGNED` |
| The installments must add up to what the contract still needs — its value less everything already paid, on any version (§24). A deliberate difference needs `project.unit.finance.correct` and a reason, kept on the schedule | `scheduleTarget`; `SCHEDULE_TOTAL_MISMATCH` (*Payment schedule total does not match the Contract value.*) |
| Activating a new version supersedes the one in force in the same transaction; the old version keeps its installments and what was paid on them (§25) | `activatePaymentSchedule` |
| An unwanted draft is discarded (cancelled), never deleted | `discardPaymentSchedule` |
| One invoice per installment of the active schedule, for what it still owes; an installment invoice cannot be edited afterwards (§26) | `issueInstallmentInvoice`, `createInstallmentInvoiceRecord`; `SCHEDULE_NOT_ACTIVE`, `INSTALLMENT_INVOICE_FIXED` |

### Payments and allocations

| Rule | Where |
| --- | --- |
| Every payment, of every kind, settles through allocations: invoice receipts and expense disbursements from the Finance pages become one allocation each, in the same transaction (§31, §114) | `recordReceipt`, `recordDisbursement` → `allocate` |
| A contract payment is recorded against a signed contract and may be split across installments in the same step; what is not allocated stays unallocated on the payment (§27, §77) | `recordContractPayment`; `CONTRACT_NOT_SIGNED` |
| A payment with the same amount and date as one already recorded on the contract (and the same reference, when one is given) is offered back first (409 with the matches); the reader records it anyway only if it is different money — the same amount alone is never blocked (§78) | `DuplicatePaymentError`; `DUPLICATE_PAYMENT` |
| An allocation never exceeds what the payment has left or what the target still owes, and never crosses currencies | `allocate`; `PAYMENT_FULLY_ALLOCATED`, `ALLOCATION_EXCEEDS_PAYMENT`, `ALLOCATION_EXCEEDS_OUTSTANDING`, `INSTALLMENT_PAID`, `CURRENCY_MISMATCH` |
| Paying an installment's invoice settles the installment too: one allocation names both | `allocate` |
| Two payments allocated at once to the same installment cannot overpay it | the payment row is locked, then the contract, invoice or expense row, always in that order |
| An allocation is corrected by reversing it with a reason (`project.unit.finance.correct`); the money becomes unallocated again (§79) | `reverseContractAllocation` → `reverseAllocation` |
| Voiding a contract payment needs `project.unit.finance.correct`; a payment recorded to replace it names the voided one | `voidPayment`; `PAYMENT_NOT_VOIDED` |
| Only live allocations count: not reversed, on a recorded payment | `LIVE_ALLOCATION` in `finance.settlement.ts` |

### Derived statuses

Installment (§22), for the active schedule: **Paid** when fully allocated;
**Overdue** once its due date has passed with money owed; **Partially paid**
when some is allocated; **Due** within seven days; otherwise **Upcoming**. A
superseded or cancelled schedule's installments read *Paid* or *Cancelled*.

Financial status (§40, §41, §85, §121), in this order:

1. **No contract** — the unit has no live contract.
2. **Contract pending** — the contract is not yet signed, active or completed.
3. With nothing outstanding: **Financially complete** when no money is
   unallocated and no installment is still open, otherwise **Paid**.
4. **Overdue** — an installment of the active schedule is past due.
5. **Payment pending** — nothing paid yet.
6. **Partially paid**.

A contract's figures belong to the contract: a unit sold with its parking shows
the contract's value, paid, outstanding and overdue, and says which other units
it sells.

### The Sold rule (§42-§44, §122)

The company chooses what a reserved unit needs before Sales may mark it Sold
(Settings → Sales). Meeting the rule **only unlocks Mark Sold**; Sales still
makes the sale.

| Rule | Mark Sold needs, beyond E-05E's reservation, client, deal and agreed price |
| --- | --- |
| Reservation | nothing more |
| Signed contract (default) | a live contract that is signed, active or completed |
| Deposit received | a Deposit installment in the active schedule, paid in full |
| Signed contract and deposit | both |
| Manual approval | a sale approved in the Approvals Center by someone holding `project.unit.sale.approve`, not the person who asked |

The Sales section shows the rule, the contract and what is missing. A unit under
a signed contract can be sold even after its reservation's date has passed — the
reservation is held by the contract. A released or expired reservation cancels
its pending approval.

## The installments job

`finance.unit-installments` runs hourly, per company, skipping suspended
companies and companies with Finance or Projects switched off
(`docs/worker-matrix.md`). For
each installment of an active schedule:

- due within seven days and still owed: tells whoever activated the schedule,
  the salesperson and the deal owner once per installment and due date
  (`due:{installmentId}:{date}`);
- past due and still owed: tells them once per installment
  (`overdue:{installmentId}`);
- a contract becoming Overdue is audited once as the system, keyed to its
  earliest overdue installment (`overdue-status:{contractId}:{installmentId}`).

Nothing is written to the schedule: installment status is derived when read, so
the page is right between runs. The job counts what it found in
`UNIT_INSTALLMENTS_OVERDUE` and `UNIT_INSTALLMENTS_DUE_SOON`.

## Authorisation (§54-§56, §123, §130)

| Permission | Owner | Admin | CEO | PM | Finance | Legal | Sales | Sales Manager | Viewer |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `project.unit.legal.view` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `project.unit.contract.request` | ✓ | ✓ | | | | | ✓ | ✓ | |
| `project.unit.contract.{create,update,review,sign_status,cancel,documents.manage,amend}` | ✓ | | | | | ✓ | | | |
| `project.unit.finance.view` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `project.unit.finance.{manage_schedule,issue_invoice,record_payment,allocate_payment,documents.manage,correct}` | ✓ | | | | ✓ | | | | |
| `project.unit.sale.approve` | ✓ | ✓ | ✓ | | | | | ✓ | |
| `legal.contract.complete` | ✓ | | | | | ✓ | | | |

Architecture, the Architecture Manager and Engineering hold none of them: they do
not see a unit's Legal or Finance section, and the pages send them to
*Access denied*. Company IT, HR, Procurement, Inventory, QA/QC and HSE hold none
either.

**A module switched off is gone** (PRD #47 §25). The unit grants are Projects
grants, so a company with **Finance** switched off has no unit finance at all —
no Finance section, no project Finance units, no schedule, payment or
allocation route, no installment job — and one with **Contracts** switched off
has no unit Legal section and no requests. A foreign contract is looked up
before the reader's own modules are checked, so it is still *not found*, never
*forbidden*. Settings → Sales marks a Sold rule that needs a switched-off module:
no unit could be sold under it. A unit grant alone is not enough to act — Legal's actions also
need the Legal module's own grant, Finance's the Finance module's — and every
read is scoped to projects the reader can open. Clients' names follow the CRM's
own grant.

## API

| Route | Does |
| --- | --- |
| `GET /api/project-units/:unitId/legal` | The unit's live contract, request history, earlier contracts, candidates and capabilities |
| `GET, POST /api/project-units/:unitId/contracts` | The unit's contracts; draft one from the open request |
| `POST /api/project-units/:unitId/contract-requests` | Request a contract |
| `GET /api/contracts/requests` · `POST …/:requestId/decline` · `POST …/:requestId/withdraw` | Legal's queue; decline with a reason; withdraw |
| `PATCH /api/contracts/:contractId/units/:unitId` | A unit's value on a draft contract |
| `POST /api/contracts/:contractId/complete` | Complete a financially complete contract |
| `GET, POST /api/contracts/:contractId/payment-schedules` | A contract's schedules; draft one |
| `GET, PATCH /api/finance/payment-schedules/:scheduleId` · `POST …/activate` · `POST …/discard` | Read or edit a draft; activate; discard |
| `POST /api/finance/installments/:installmentId/invoice` | Raise an installment's invoice |
| `POST /api/contracts/:contractId/payments` | Record a contract payment, with allocations |
| `POST /api/finance/payments/:paymentId/allocations` | Allocate what a payment has left |
| `POST /api/finance/payment-allocations/:allocationId/reverse` | Reverse an allocation with a reason |
| `GET /api/project-units/:unitId/finance` · `GET …/finance-summary` | The unit's collection; its figures alone |
| `POST /api/project-units/:unitId/sale-approval` · `…/approve` · `…/reject` | Ask for, approve or reject a sale |
| `GET /api/projects/:projectId/finance/units` | The project's Finance units |

Every route is company-scoped and swept both ways between companies
(`tests/security`): a foreign id answers 404.

## Notifications, audit and activity (§94, §96)

Category **Finance** (translated). Every notice is filtered again by the reader's
grant when delivered, and no title names a client or what a client owes.

| Event | Goes to |
| --- | --- |
| Contract requested | members who may draft unit contracts, not the requester |
| Request declined | the requester |
| Contract signed · contract cancelled | the contract owner, the salesperson and the deal owner |
| Installment due soon · installment overdue | whoever activated the schedule, the salesperson and the deal owner |
| Payment received · financially complete | the salesperson and the deal owner (and, for completion, the contract owner) |

Audit: `UNIT_CONTRACT_REQUESTED`, `…_REQUEST_DECLINED`, `…_CREATED`,
`…_UPDATED`, `…_STATUS_CHANGED`, `…_SIGNED`, `…_CANCELLED`, `…_COMPLETED`,
`CONTRACT_AMENDMENT_CREATED`, `PAYMENT_SCHEDULE_CREATED`, `…_ACTIVATED`,
`…_SUPERSEDED`, `…_CANCELLED`, `PAYMENT_ALLOCATED`,
`PAYMENT_ALLOCATION_CORRECTED`, `INVOICE_ISSUED`,
`UNIT_FINANCIAL_STATUS_CHANGED`, `UNIT_SALE_APPROVAL_REQUESTED`, `…_DECIDED`.
The unit's activity shows contract and money events to readers who may see them.
The Approvals Center lists unit publish reviews, contract reviews and sale
approvals.

## Screens

- **The unit's Legal section** `/projects/:projectId/units/:unitId/legal` — the
  live contract with number, client, deal, value, dates, owner and every unit it
  sells with its value; the actions the reader may take (Send for review, Submit
  for approval, Mark sent for signature, Record signature, Activate, Complete,
  Cancel contract, Terminate, New amendment); contract documents; the request
  history and earlier contracts. Without a contract: Request contract, Withdraw
  request, Draft contract, Decline request. `?action=create` opens the draft
  dialog.
- **The unit's Finance section** `/projects/:projectId/units/:unitId/finance` —
  status, contract value, paid, outstanding, overdue, next payment and progress;
  the schedule in force with each installment's status and invoice, the draft
  and earlier versions; payments with their allocations (Allocate, Attach proof,
  Void payment, Reverse); invoices; proof of payment. On a phone the installments
  read as stacked rows.
- **Project → Finance → Units** `/projects/:projectId/finance/units` — totals
  per currency counting each contract once (contracted, collected, outstanding,
  overdue); quick filters by financial status with counts; search by unit,
  client, contract, invoice number or payment reference; filters (building,
  floor, type, contract status, overdue only, currency, next due between); sort;
  50 a page, the filters in the URL. Cards on a phone. Finance's project tab
  opens here for readers who cannot see the budget.
- **Legal → Unit requests** `/contracts/requests` — waiting and answered
  requests with unit, place, client, deal, agreed price, who asked and notes;
  Draft contract and Decline.
- **The unit's Sales section** — the Sold rule, the contract, and under Manual
  approval the approval with Ask for approval, Approve sale and Reject; the Mark
  Sold refusal names the rule and what is missing.
- **Settings → Sales** (translated) — the Sold rule, with a warning on a rule
  that needs a module the company has switched off.

## Seed

Riverside Residences: **A-201** is sold to Beta Properties under
**CTR-2026-041**, active, €176,000, with a four-installment schedule — the
deposit (€17,600, invoiced as INV-SA-2026-001 and paid), Installment 1 past due
with €20,000 of €52,800 paid, two more ahead — so it reads **Overdue**. **A-102**
has an open request in Legal's queue. Company B's **OF-001** is under a signed
contract CTR-B-2026-011 with a fulfilled request, a schedule and a paid deposit.
Every seeded finance payment now carries its client, project and one allocation.
The demo company's Sold rule is the default, Signed contract.

## Tests

| Suite | Covers |
| --- | --- |
| `tests/unit/finance/unit-finance-rules.test.ts` | Installment and financial status in order; progress and the schedule target; the allocation proposal; every Sold rule and a contract holding a lapsed reservation; the machines; the default role policy |
| `tests/api/contracts/unit-contracts.test.ts` | Drafting the canonical contract from Sales' request, and the refusals in the PRD's words; decline, withdraw and a request whose reservation ended; an apartment and its parking on one contract, its value the sum of its units; the signature keeping the unit through its reservation's expiry and refusing its release; cancel and terminate releasing units and cancelling schedules with history; no archiving a draft sale contract, no reopening a sale under contract |
| `tests/api/finance/unit-finance.test.ts` | Schedules drafted, total checked, activated once signed and superseded keeping paid history; allocation across installments and several payments to one, never beyond the payment or the installment; reversing an allocation and voiding a payment with the correction grant; every financial status in order; an installment's invoice raised once and settled by the installment's allocations; each Sold rule unlocking Mark Sold only once met, and Manual approval for this reservation only; who sees and does what, Company B included; the inventory's filters, counts and totals once per contract |
| `tests/api/jobs/finance.unit-installments.test.ts` | Overdue announced and the Overdue status audited once, as the system; due soon once per due date, never a paid or later installment; a contract no longer selling the unit left alone; two runs at once announcing once; company isolation; suspended companies and Finance or Projects switched off; one failure rolling back alone |
| `tests/api/finance/finance-service.test.ts`, `tests/integration/release/data-invariants.test.ts` | Invoices and expenses settling through allocations exactly as before; no payment allocated beyond its amount |
| `tests/security/*` | The 22 new routes swept both ways between companies: 33 calls each way, all 31 foreign-id calls 404, nothing uncovered or unvalidated; with Finance and Contracts switched off, no route of theirs answers with data |
| `tests/e2e/modules/unit-contracts-finance.spec.ts` | Sales requests; Sold refused under the default rule; Legal drafts from its queue with the parking and sends it for review; Finance creates and activates a schedule, records a payment and sees the unit Overdue; the project's totals count the contract once and filter; an Architect sees neither section |
| `tests/e2e/responsive/unit-finance-mobile.spec.ts` | The Overdue quick filter and a card opening A-201's Finance section on a phone, without horizontal scroll |

## Limits

- **Admin does not collect or contract.** Admin may ask for a contract, approve
  a sale and read, but holds neither the Legal nor the Finance module's acting
  grants.
- **Finance is not notified when a contract is signed.** It finds new signed
  contracts under *Payment pending* on the project's Finance units.
- **No "contract nearing completion" notice** (§94 lists it as recommended).
- **No separate supersede or per-installment endpoints**: a schedule changes by
  drafting a new version and activating it.
- **Unit values are informational after an amendment.** The amendment records
  the new terms; the contract units keep the values they were drafted with.
- **No currency conversion**; totals are per currency.
- **Module pages are English**; Settings → Sales and the notification category
  are translated.
- **The development server needs a restart** after this migration and
  `prisma generate` — its old client still reads `payments.invoiceId`, which is
  gone, so the Finance payment pages fail until it restarts — and `pnpm db:seed`
  (or `pnpm access:sync`) before anybody holds the new permissions.
