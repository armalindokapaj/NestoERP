# Unified Approvals Center (PRD #41)

`/approvals` is the one place a person reviews, decides and tracks every
approval in NESTO — purchase orders, invoices, leave, contracts, documents —
without opening each module. It is an aggregation and review layer, never a
workflow engine: each module stays authoritative for its approval records,
rules, thresholds, state transitions, approvers, self-approval policy and side
effects.

```
Finance · Procurement · HR · Sales · Legal · Documents · QA/QC · HSE · Timesheets
        ↓ provider (module scope, module permissions, module service)
ApprovalProviderRegistry  →  UnifiedApprovalService  →  /api/approvals  →  /approvals
```

## Where things live

| Concern | Location |
| --- | --- |
| Types, schema, ordering, cursors | `lib/modules/approvals/approvals.{types,schema,order}.ts` |
| Provider contract, registry, service | `lib/modules/approvals/approvals.{provider,registry,service}.ts` |
| Shared provider over a module's approval table | `lib/modules/approvals/approvals.cycle-provider.ts` |
| Providers | `lib/modules/approvals/providers/*.provider.ts` |
| Delegation | `lib/modules/approvals/approvals.delegation.ts`, lookup in `lib/core/approvals/approval-delegations.ts` |
| Chain steps, decision guard | `lib/core/approvals/approval-{steps,guard}.ts` |
| Overdue reminders (job `approvals.overdue`) | `lib/modules/approvals/approvals.overdue.ts` |
| Purchase order limits (Procurement's) | `lib/modules/procurement/approvals/approval.policy.ts`, `/procurement/approvals/limits` |
| API | `app/api/approvals/**`, `app/api/procurement/approval-policy`, `app/api/document-reviews/[reviewId]/reassign` |
| UI | `app/(nesto)/approvals/page.tsx`, `components/approvals/*` |

## Sources

| Provider | Module's approval record | Decides through | Return |
| --- | --- | --- | --- |
| `finance` | `FinanceApproval` — invoice, expense, budget, commitment | `approve/reject/return<Record>` in each Finance service | Yes, to draft |
| `procurement` | `ProcurementApproval` — request, order (+ `ApprovalStep` chain) | `approve/reject/returnRequest`, `approve/reject/returnOrder` | Yes, to draft |
| `hr` | `LeaveRequest` itself | `approveLeave`, `rejectLeave` | No |
| `sales` | `SalesApproval` — proposal | `approve/reject/returnProposal` | Yes, to draft |
| `legal` | `ContractApproval` — contract, amendment | `approve/rejectContract`, `returnContractForRevision`, `approve/reject/returnAmendment` | Yes, to draft |
| `documents` | `DocumentReview` — one per reviewer | `decideReview` | No |
| `qaqc` | `QualityApproval` — inspection, NCR | QA/QC inspection and NCR services | No |
| `hse` | `HseApproval` — inspection, risk assessment, permit, incident closure | HSE services (incident closure approves only) | No |
| `timesheets` | `TimesheetApproval` — a week (+ one `ApprovalStep` naming the approver) | `approve/return/rejectTimesheet` (PRD #42, see `docs/timesheets.md`) | Yes, editable again |
| `projects` (*Unit publishing*) | `UnitPublicationApproval` — a unit, or its unpublished changes | `publishUnit`, `requestUnitRevision` (E-05D, see `docs/unit-publishing.md`); no reject | Yes, Revision Required |

QA/QC and HSE are included because both already own explicit approval records;
verifying a corrective action stays their own work and never enters the Center.

## Tabs and queries

| Tab | Shows | Order |
| --- | --- | --- |
| Waiting for me | Pending items this person can decide now — permission, current chain step, or a review addressed to them (or lent to them) | Urgency |
| Requested by me | Everything this person submitted, any status | Newest |
| Approved / Rejected | Decisions this person took, including chain steps | Newest decided |
| Returned | Returned by me, to me, or both (`returned=by\|to\|all`) | Newest decided |
| All history | Every cycle whose source approvals this person may view; needs `approvals.history.view` | Newest |

Every row survives only if the reader can reach its record through the
record registry (module on, the record type's view permission, the module's
own scope). Counts in the header are always the unfiltered "waiting for me",
from the same providers.

**Urgency** (`approvals.order.ts`): overdue, then critical, then due within
three days, then high priority, then the oldest request. Every sort ends in
provider key and approval id, so ordering is total and cursors never repeat or
skip. Date-ordered tabs page with an exact per-provider keyset
(`keysetWhere`); computed sorts order over a bounded window of 300 rows per
source, and the response says `windowed: true` when that bound was reached.

**Due dates** are only real source deadlines: a document review's due date,
leave's first day, a proposal's validity, a work permit's start. Nothing else
is given one.

**Priority** is presentation only: a module's own priority or severity, a
chain of three steps, or a value of at least 50,000 in the record's currency —
which also makes Approve ask for an explicit confirmation.

## Deciding

`POST /api/approvals/:provider/:approvalId/{approve|reject|return}` with
`{ note?, expectedVersion? }` and an optional `Idempotency-Key` header.

1. The provider key must be registered; the provider must be available to the
   reader (module on). A switched-off module's approvals cannot be decided.
2. The provider re-reads the approval in the reader's company and scope.
3. Already decided by this person with the same outcome → `alreadyApplied`.
   Already decided otherwise → `409 APPROVAL_ALREADY_DECIDED`; resubmitted since
   → `409 APPROVAL_SOURCE_CHANGED`.
4. `expectedVersion` (1 + decided chain steps; submissions for leave) must
   match, or `409 APPROVAL_SOURCE_CHANGED`.
5. The module's own service decides with an `ApprovalGuard` naming the cycle
   and step, re-checked inside the module's transaction; the conditional
   update on `PENDING` settles races once.
6. Reject and Return require a reason (1–5,000 characters), enforced by the
   service as well as the route.
7. With an idempotency key, the outcome is kept in `ApprovalDecisionReceipt`
   and a retry replays it; the same key for a different decision is refused.

Error codes (`details.code`): `APPROVAL_NOT_FOUND`, `APPROVAL_ALREADY_DECIDED`,
`APPROVAL_FORBIDDEN`, `APPROVAL_SELF_APPROVAL_BLOCKED`,
`APPROVAL_SOURCE_CHANGED`, `APPROVAL_PROVIDER_UNAVAILABLE`,
`APPROVAL_PROVIDER_UNKNOWN`, `APPROVAL_RETURN_NOT_SUPPORTED`,
`APPROVAL_REASON_REQUIRED`, `APPROVAL_IDEMPOTENCY_KEY_REUSED`,
`APPROVAL_NOT_CURRENT_APPROVER`, `APPROVAL_STEP_SEPARATION`.

## Purchase order chains

Procurement's policy (`ProcurementApprovalPolicy`, one per company) sets two
limits in the company's base currency:

```
total ≤ Finance limit      Procurement                      (procurement.order.approve)
above the Finance limit    Procurement → Finance            (+ procurement.order.finance_approve)
above the executive limit  Procurement → Finance → Executive (+ a role, CEO by default)
```

An order in another currency takes every configured step. The steps are
written when the order is submitted (`ApprovalStep`), so a later policy change
does not alter a chain in flight. Submission is refused
(`APPROVAL_NO_ELIGIBLE_APPROVER`) when a step has nobody, other than the
requester, who could decide it and read the order.

Rules for every step: only the current step is actionable; the requester
decides none; nobody decides two steps of one cycle; and somebody a later step
belongs to (the CEO, for the executive step) does not take an earlier one, so
the chain can always finish. Reject or Return at any step ends the cycle and
closes the unreached steps as `CANCELLED`.

`procurement.order.finance_approve` is held by the Finance role and the Owner
and is on no ladder: Finance answers "can we afford it" on large orders while
remaining, per PRD #15, not an approver of its own invoices.

Document reviews are the parallel case: several reviewers on one version
decide independently, every one must approve, and any rejection rejects.

## Delegation

`/approvals?panel=delegation`. A member holding `approvals.delegation.manage`
lends the approvals assigned to them — a review addressed to them, a chain step
belonging to their role — to a colleague for up to 90 days, for one source or
all. Refused: to yourself, across companies, to somebody who cannot open that
source (`DELEGATE_NO_ACCESS`), overlapping another of your delegations
(`DELEGATION_OVERLAP`), circular (`DELEGATION_CIRCULAR`), or to somebody who is
away themselves (`DELEGATE_AWAY`). Resolution is one hop only. The delegator
must still be able to decide the record. Decisions record both people
(`decidedByMemberId` and `onBehalfOfMemberId`). Created and revoked
delegations are audited; the delegate is notified.

A permission-based approval (an invoice) is not delegated: anyone holding the
permission can already decide it. A review whose reviewer has left is
reassigned explicitly (`POST /api/document-reviews/:id/reassign`, audited,
both reviewers notified); the Center warns when the assigned reviewer is
inactive.

## Notifications, attention, audit

- Events (category `approvals`): `APPROVAL_REQUESTED` (step-aware; role steps
  name their recipients), `APPROVAL_APPROVED`, `APPROVAL_REJECTED`,
  `APPROVAL_RETURNED`, `APPROVAL_REASSIGNED`, `APPROVAL_DELEGATED`,
  `APPROVAL_OVERDUE` (daily, from the `approvals.overdue` job). The old
  `APPROVAL_DECIDED` stays registered so existing outbox rows still dispatch.
- Approval notifications and attention items link to
  `/approvals?record=<type>:<id>`, which the page resolves to the approval the
  reader may open, or to the record itself.
- Attention: `PENDING_APPROVAL` now also covers document reviews and leave;
  `PROCUREMENT_ACTION_REQUIRED` follows the current chain step;
  `APPROVAL_OVERDUE` covers approvals past a real deadline. A decision resolves
  the record's approval attention in the same transaction.
- Audit (category `APPROVAL`): `APPROVAL_REQUEST_CREATED`,
  `APPROVAL_STEP_ASSIGNED`, `APPROVAL_STEP_APPROVED`, `APPROVAL_APPROVED`,
  `APPROVAL_REJECTED`, `APPROVAL_RETURNED`, `APPROVAL_CANCELLED`,
  `APPROVAL_REASSIGNED`, `APPROVAL_DELEGATION_CREATED`,
  `APPROVAL_DELEGATION_REVOKED`, `APPROVAL_POLICY_UPDATED`. Decisions are
  `required`: the decision rolls back if its audit cannot be written. Audit
  writes now take the request's correlation id when the caller passes none, so
  a decision, its outbox event and its audit share one.
- Metrics: `approvals_queue_*`, `approvals_provider_duration_ms_total`,
  `approvals_provider_failure_count`, `approval_decision_success_count`,
  `approval_decision_failure_count`, `approval_conflict_count`,
  `approval_overdue_count`.

## Permissions

`approvals` is a core module (always on). Its ladder: VIEW `approvals.view`;
APPROVE adds `approvals.history.view` and `approvals.delegation.manage`. There
is no global approve permission — deciding is always the source module's grant.

| Role | Approvals access |
| --- | --- |
| Owner | Manage |
| HR, CEO, Finance, Legal, Sales, Procurement, QA/QC, HSE | Approve (history, delegation) |
| Project Manager | Approve, project scope |
| Group IT, Inventory | View |
| Architect as company department manager or group head | Approve (history, delegation) |
| Architect, Engineer | View, project scope |
| Viewer | None |

## Dashboards

`pendingApprovals` (top five of Waiting for me) is on the Owner, HR, CEO,
Project Manager, Architect as manager or head, Finance, Legal, Sales,
Procurement, QA/QC and HSE dashboards.
`approvalBottlenecks` (pending by source, oldest wait, overdue) is on the Owner
and CEO dashboards and needs `approvals.history.view`.

## Seed

`prisma/seed/approvals.ts`: Procurement limits of 25,000 / 75,000 EUR with the
CEO as executive; `PO-2026-142` (EUR 81,600) with Procurement and Finance
approved and the CEO's step pending, its supplier quotation attached; and an
upcoming delegation from the Owner to the CEO. Every other module's seed already
provides pending approvals.

## Not in V0.1

No workflow builder, no quorum rule, no bulk decisions, no keyboard approve
shortcut, no delegation of permission-based approvals, no generic escalation
beyond the daily overdue reminder.
