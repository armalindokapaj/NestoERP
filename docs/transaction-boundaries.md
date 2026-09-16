# Transaction boundaries

Per PRD #48 §21–§38, §114–§127, §142–§154.

A transaction boundary is one atomic business operation. Everything that must
be true together commits together; everything that can happen afterwards
happens afterwards.

```
authorize
→ validate
→ mutate the source record
→ call the target owner's door, in this transaction
→ audit
→ outbox intent
→ commit
→ deliver notifications, index, project
```

## The two rules that decide what goes inside

**Inside:** database writes that must not disagree with each other. The source
record and the foreign-domain record it requires. The audit entry for a
sensitive change (PRD #48 §120). The outbox row that promises a notification
(§122).

**Outside:** anything irreversible or slow. Email, object storage, an external
API, a webhook — none of them can be rolled back, so none of them may happen
before the commit that justifies them (§29, §115, §119). Search indexing and
reporting projections are outside too: they are derived, and a failure to
index must not undo a business fact (§37, §38).

Object storage cannot be in a database transaction at all. Uploads use the
staged design instead: authorise, presign, upload, verify, then a short
transaction that finalises the row (§116, §117). An object left behind by an
abandoned upload is collected by a worker (§118).

## Running one

`runInTransaction(name, fn)` in `lib/core/transactions/transaction.ts` wraps
`prisma.$transaction` with two things and nothing else:

- a **bounded retry** for transient serialisation failures and deadlocks —
  the database asking for the work to be repeated, which is safe because the
  failed attempt left nothing behind (§124, §245). A business conflict is
  never retried: the caller's intent is out of date (§244).
- the operation's **name** in the metrics and the log, so `conflict_total` and
  `transaction_retry_total` can say *which* operation is contended (§176,
  §181).

The name is low-cardinality by construction — `procurement.order.approve`,
never an id (§177).

## The matrix

"Atomic" means the listed writes commit or roll back together. "Concurrency"
is what stops two people doing it at once.

| Operation | Source → target | Atomic | Outbox | Idempotency | Concurrency |
|---|---|---|---|---|---|
| Purchase order approval | procurement → finance | Yes — the order's status, the Finance commitment, the integration link, audit and activity | Notification of the decision | Commitment keyed by source record, with a unique index behind it | Conditional status write; approval step settled only while PENDING |
| Purchase order cancel / close | procurement → finance | Yes — status and the commitment's settlement | — | Settling twice reports the second call changed nothing | Conditional status write; `canTransitionCommitment` refuses an illegal move |
| Goods receipt → inventory receipt | procurement → inventory | Yes, within Inventory: the receipt, its lines and its number | — | `@@unique(goodsReceiptId)` — one inventory receipt per delivery | The unique index; the delivery must be RECORDED |
| Stock posting | inventory | Yes — the movement, the balance and the document | — | Movements are immutable; a correction is a counter-entry | Balance row taken `FOR UPDATE` |
| Meeting action → task | meetings → tasks | Yes — the task, the action's link claim and audit | Assignment notification | The link is claimed conditionally; a lost race rolls the task back | `updateMany … linkedTaskId: null` decides the winner |
| QA corrective action → task | qaqc → tasks | Yes — the task, activity and the integration link | Assignment notification | Integration link keyed by source | — |
| HSE action → task | hse → tasks | Yes — the task and the integration link | Assignment notification | Integration link keyed by source | — |
| Task status → meeting action | tasks → meetings | Yes — inside the task's own transaction | Action-completed notification | The action is found by `linkedTaskId`; re-applying the same status is a no-op | The task's own status guard |
| Timesheet submit | timesheets → approvals | Yes — status, approval cycle, steps, attention, audit | Submitted notification | `submissionVersion` distinguishes a resubmission from a repeat | `expectedVersion` plus a conditional status write |
| Timesheet decision | timesheets ← approvals | Yes — status, cycle, steps, attention, audit | Decision notification | `ApprovalDecisionReceipt` keyed by `Idempotency-Key` replays the first answer | Version increment; the step settles only while PENDING |
| Approval decision (any source) | approvals → source domain | The source domain's transaction | Decision notification | Decision receipt per (company, member, key) | `settleStep` is conditional on PENDING; two approvers of one step settle it once |
| Document review decision | documents | Yes — the review, the version's state, attention, audit | Review notifications | The decision is conditional on the review being open | Conditional write on the review row |
| Engineering revision review | engineering → documents | Yes — the revision, its parent's status, superseded siblings, audit | Review notification | Conditional on the revision still being in review | `updateMany … status IN (IN_REVIEW)`; the loser gets a conflict |
| RFI response / close | engineering | Yes — the response, the RFI's status, audit | RFI notifications | Conditional on the expected status | Status-guarded transition |
| Submittal review | engineering | Yes, as the revision review above | Review notification | Conditional on the revision's status | Status-guarded transition |
| Transmittal issue | engineering → documents | Yes — the transmittal, its items' snapshots, audit | Issue notification | Conditional on DRAFT | `updateMany … status: "DRAFT"` |
| Contractor compliance expiry | contractors → attention | Reconciled, not transactional | — | The attention dedupe key absorbs a repeated run | Idempotent reconciliation; the worker holds a lease |
| Daily log lock | daily-logs | Yes — status, audit, activity | Lock notification | Conditional on REVIEWED | `expectedVersion` |
| Milestone status | project-planning | Yes — the milestone, its blockers, audit | — | Conditional on the expected status | `expectedVersion` |
| Announcement publish | announcements | Yes — status, targets, audience snapshot, audit | Publication notification | The write is conditional on DRAFT or SCHEDULED, so the scheduler may retry a publish that already happened and change nothing | `expectedVersion` from a person, the row's own version from the worker |
| Invitation accept | team → auth | Yes — the account, the membership, the invite's consumption, activity, audit | — | The invite is consumed conditionally on PENDING | `updateMany … status: "PENDING"` decides a double-click |
| Password change | account → auth | Yes — the credential, the reset links it voids, the other sessions, audit | — | — | The current password is verified first |

## Failure policy

| If this fails | Then |
|---|---|
| The foreign-domain write a business rule requires | The whole operation rolls back. An approved order with no commitment is a financial defect (§143). |
| A mandatory audit write | The business transaction fails. Evidence is part of the change, not a report of it (§35, §120). |
| Notification delivery | Nothing rolls back. The outbox retries with backoff and a dead-letter state (§36, §247). |
| Search indexing, reporting | Nothing rolls back. Neither is authoritative in V0.1 (§37, §38). |
| A transient deadlock | Retried up to three times with backoff, then surfaced (§124, §245). |
| A stale version, a record already decided | 409, with the record's current state. Never retried automatically (§48, §244). |

## What is deliberately not atomic

- **Watchers.** `subscribeStakeholders` runs after the commit, because who may
  read a record depends on the record existing. A missing subscription is a
  missing notification, not a wrong number.
- **Attention reconciliation.** Most conditions are recomputed by a scheduled
  reconciler rather than written by the service that made them true. Services
  resolve the obvious ones immediately so the item disappears when the person
  expects (§123, PRD #38 §85).
- **A multi-step wizard.** Only the final submit is a transaction. A
  transaction is never held open across a screen (§209, §211).

## Bulk and raw writes

`updateMany`, `deleteMany` and raw SQL get extra review because each can pass
underneath a per-record invariant (PRD #48 §258–§262). The audit as of PRD #48:

**233 bulk writes.** Every one is bound by at least one of:

- the caller's `companyId`;
- a specific `id`, loaded a moment earlier through a company-scoped read —
  which is also the conditional-write pattern that makes a transition safe
  under concurrency;
- a parent id the caller has already been authorised for: every participant of
  *this* meeting, every location in *this* warehouse, every supplier on *this*
  RFQ.

The remainder are the platform sweepers, bound by policy rather than by
tenancy and correct for that reason: retention deleting past its horizon, the
throttle clearing expired buckets, the worker claiming by job key, the approval
engine closing the open steps of one cycle.

A new bulk write that is bound by none of those is a tenancy defect. The
reviewer's question is simply: *what stops this touching another company's
rows?*

**16 raw SQL statements**, every one parameterised — there is no string
interpolation into SQL anywhere in `lib/`. They exist because Prisma's query
API cannot express two things that concurrency needs:

- **`FOR UPDATE` row locks** (12 uses), taken inside a transaction so two
  writers serialise on the row rather than both reading the same value: the
  numbering sequence, an inventory balance, a storage quota, a leave balance, a
  contract, an opportunity, a company's member count. The outbox claim uses
  `FOR UPDATE SKIP LOCKED`, so two workers take different batches rather than
  queueing behind each other.
- **`INSERT … ON CONFLICT`** (7 uses), where the row must appear exactly once
  under concurrency without a pre-check: a collaboration thread, a rate-limit
  bucket, a worker's lease, a company's storage usage row.

Four statements belong to the company-integrity scan, the only `Unsafe`
variants. They build a temporary table of owned ids, and every identifier they
interpolate comes from Prisma's own DMMF — never from a request.

## Proving it

`tests/integration/transactions/` runs against a real database:

- `rollback.test.ts` — a failure injected after a foreign-domain write leaves
  nothing behind; the same operation twice makes one record; a cancelled
  commitment cannot be reopened; another company's caller moves nothing.
- `concurrency.test.ts` — ten simultaneous number allocations produce ten
  distinct numbers; a rolled-back allocation does not consume one; two
  concurrent transitions settle once; a business failure is not retried.
