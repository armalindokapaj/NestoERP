# State machines

How a controlled record moves between states, and what stops it moving any
other way. PRD #49 §54-§67, §154-§156, §294.

## The two rules

**A controlled record moves by a declared transition.** The transition says
which states it is legal from, which state it leads to, what permission it
needs and whether it needs a reason. That declaration lives in one file per
domain — `<domain>/<record>.machine.ts` — and the action menu, the API
validator and the write all read it, so they cannot disagree.

**The state a transition moves from is part of the write.** Not an `if` above
it. A service that reads a record, decides the move is legal and then writes by
id alone is correct only until two people act at once: Postgres takes no lock
on a plain read, so both callers see the old state and both write, and the
second silently overwrites the first. `applyTransition` puts the state the
caller read into the `where` clause, so the database decides — the second write
matches no row and its caller is told the record moved.

The guard is the state the caller **read**, not every state the action is legal
from. Two people who both open an `OPEN` hazard and both control it are each
making a legal move; guarding on the legal set would let the second overwrite
the first with neither being told.

## Using it

```ts
const existing = await requireHazard(context, hazardId);      // reads status
assertPermission(context, "hse.hazard.control");

await prisma.$transaction(async (tx) => {
  await applyTransition(tx, {
    machine: hseHazardMachine,
    action: "control",
    id: hazardId,
    context,                      // scopes the write, and is checked against
                                  // the permission the transition declares
    from: existing.status,        // the guard
    data: { controlMeasure, updatedByMemberId: context.membershipId },
  });
});
```

The `permission` on each transition is enforced, not decorative:
`applyTransition` refuses a caller who does not hold it. Services keep their
own richer checks on top — a self-approval rule, an approval guard, a
domain-specific message — so this is the floor rather than the whole gate.

`applyTransition` refuses an illegal move with `HSE_HAZARD_ILLEGAL_TRANSITION`
and a move whose record has changed with `HSE_HAZARD_STALE`, both as `CONFLICT`
— 409 at the boundary, counted in `transition_conflict_total`. Pass
`expectedVersion` where the model carries a `version` column to layer the
user's view on top: the state guard asks whether the move is still legal, the
version guard asks whether this is still the record the person was looking at.
A record can pass the first and fail the second.

Pass `idempotent: true` where a replayed action should settle rather than raise
— publish, close, void. It returns `ALREADY_THERE` and writes nothing twice.

### Three things a transition can say beyond the simple case

**Several permissions, any one of which will do.** An invoice is approved by
somebody holding `finance.invoice.approve` or the module-wide
`finance.approval.decide`; the transition lists both rather than naming one
and leaving the other to an `if` the table cannot see.

**Several destinations, when the record decides which.** Restoring from the
archive returns to whatever the record held before; a goods receipt leaves an
order partly or wholly received. The transition declares every state it may
lead to, the service works out which from the record and passes it as `to`,
and `applyTransition` refuses one the table does not list. The client never
names it (§62).

```ts
await applyTransition(tx, {
  machine: purchaseOrderMachine,
  action: "restore",
  id: orderId,
  context,
  from: "ARCHIVED",
  to: existing.preArchiveStatus ?? "DRAFT",   // one of the declared targets
  data: { preArchiveStatus: null, archivedAt: null },
});
```

**An approval chain can conclude it.** In a chain (PRD #41 §21) whoever holds
the current step decides — by name, by role, or standing in for either under
a delegation — and may not hold the record's own approve permission at all. A
transition that a chain can conclude declares `concludedByApprovalStep`, and
the service passes the step it just settled as `approvalStepId`.
`applyTransition` then checks that step, in the same transaction, was decided
by this actor: an id is a claim the database checks, not a switch that turns
the permission off. A transition that does not declare it refuses a step.

## What is declared

Forty-five machines over 236 transitions: HSE and QA/QC, where this began,
the six domains PRD #49 §292 ranks highest risk that own a lifecycle of
their own — Documents, Finance, Procurement, Inventory, Legal and
Engineering — Projects, whose status E-05A made a lifecycle of its own, a
unit's publication (E-05D), a unit's sale (E-05E), and a unit sale's payment
schedule and Sales' request for its contract (E-05F), and an account request
from HR to Group IT (E-06). E-05F also gave the contract machine `complete`.
The tables below are generated from `lib/core/state/registry.ts` by
`scripts/architecture/state-docs.ts`; an edit belongs in the machine, and the
table is regenerated from it.

### HSE

5 machines.

#### `hse_inspection` — `hseInspection.status`

States: `DRAFT`, `SCHEDULED`, `IN_PROGRESS`, `PENDING_APPROVAL`, `APPROVED`, `REJECTED`, `CLOSED`, `CANCELLED`
Terminal: `CLOSED`, `CANCELLED`

| Action | From | To | Permission | Reason | Freezes |
|---|---|---|---|---|---|
| `start` | `DRAFT`, `SCHEDULED`, `REJECTED` | `IN_PROGRESS` | `hse.inspection.execute` | — | — |
| `submit` | `IN_PROGRESS` | `PENDING_APPROVAL` | `hse.inspection.submit` | — | the checklist answers and the overall result |
| `approve` | `PENDING_APPROVAL` | `APPROVED` | `hse.inspection.approve` | — | — |
| `reject` | `PENDING_APPROVAL` | `REJECTED` | `hse.inspection.reject` | — | — |
| `close` | `APPROVED` | `CLOSED` | `hse.inspection.close` | — | the whole inspection |
| `cancel` | `DRAFT`, `SCHEDULED`, `IN_PROGRESS` | `CANCELLED` | `hse.inspection.cancel` | — | — |

#### `hse_permit` — `hseWorkPermit.status`

States: `DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `ACTIVE`, `SUSPENDED`, `EXPIRED`, `CLOSED`, `CANCELLED`
Terminal: `CLOSED`, `CANCELLED`

| Action | From | To | Permission | Reason | Freezes |
|---|---|---|---|---|---|
| `submit` | `DRAFT` | `PENDING_APPROVAL` | `hse.permit.submit` | — | — |
| `approve` | `PENDING_APPROVAL` | `APPROVED` | `hse.permit.approve` | — | the work described and its window |
| `reject` | `PENDING_APPROVAL` | `DRAFT` | `hse.permit.approve` | — | — |
| `activate` | `APPROVED`, `SUSPENDED` | `ACTIVE` | `hse.permit.activate` | — | — |
| `suspend` | `ACTIVE` | `SUSPENDED` | `hse.permit.suspend` | required | — |
| `close` | `ACTIVE`, `SUSPENDED`, `EXPIRED` | `CLOSED` | `hse.permit.close` | — | the whole permit |
| `cancel` | `DRAFT`, `PENDING_APPROVAL`, `APPROVED` | `CANCELLED` | `hse.permit.cancel` | — | — |

#### `hse_action` — `hseAction.status`

States: `OPEN`, `IN_PROGRESS`, `PENDING_VERIFICATION`, `VERIFIED`, `REJECTED`, `CANCELLED`, `REOPENED`
Terminal: `CANCELLED`

| Action | From | To | Permission | Reason | Freezes |
|---|---|---|---|---|---|
| `start` | `OPEN`, `REOPENED`, `REJECTED` | `IN_PROGRESS` | `hse.action.assign` | — | — |
| `complete` | `OPEN`, `IN_PROGRESS`, `REOPENED`, `REJECTED` | `PENDING_VERIFICATION` | `hse.action.complete` | — | — |
| `verify` | `PENDING_VERIFICATION` | `VERIFIED` | `hse.action.verify` | — | the completion note and its evidence |
| `reject` | `PENDING_VERIFICATION` | `REJECTED` | `hse.action.verify` | — | — |
| `reopen` | `VERIFIED` | `REOPENED` | `hse.action.reopen` | required | — |
| `cancel` | `OPEN`, `IN_PROGRESS`, `PENDING_VERIFICATION`, `REJECTED`, `REOPENED` | `CANCELLED` | `hse.action.cancel` | — | — |

#### `hse_incident` — `hseIncident.status`

States: `OPEN`, `UNDER_INVESTIGATION`, `ACTIONS_OPEN`, `PENDING_CLOSE`, `CLOSED`, `CANCELLED`, `REOPENED`
Terminal: `CANCELLED`

| Action | From | To | Permission | Reason | Freezes |
|---|---|---|---|---|---|
| `investigate` | `OPEN`, `REOPENED`, `UNDER_INVESTIGATION` | `UNDER_INVESTIGATION` | `hse.incident.investigate` | — | — |
| `submit_close` | `UNDER_INVESTIGATION`, `ACTIONS_OPEN` | `PENDING_CLOSE` | `hse.incident.submit_close` | — | — |
| `close` | `PENDING_CLOSE` | `CLOSED` | `hse.incident.close` | — | the investigation, its root cause and its lessons |
| `reopen` | `CLOSED` | `REOPENED` | `hse.incident.reopen` | required | — |
| `cancel` | `OPEN`, `UNDER_INVESTIGATION`, `ACTIONS_OPEN`, `PENDING_CLOSE`, `REOPENED` | `CANCELLED` | `hse.incident.cancel` | — | — |

#### `hse_hazard` — `hseHazard.status`

States: `OPEN`, `CONTROLLED`, `IN_PROGRESS`, `PENDING_VERIFICATION`, `CLOSED`, `CANCELLED`, `REOPENED`
Terminal: `CANCELLED`

| Action | From | To | Permission | Reason | Freezes |
|---|---|---|---|---|---|
| `start` | `OPEN` | `IN_PROGRESS` | `hse.hazard.assign` | — | — |
| `control` | `OPEN`, `CONTROLLED`, `IN_PROGRESS`, `PENDING_VERIFICATION`, `REOPENED` | `CONTROLLED` | `hse.hazard.control` | — | — |
| `close` | `OPEN`, `CONTROLLED`, `IN_PROGRESS`, `PENDING_VERIFICATION`, `REOPENED` | `CLOSED` | `hse.hazard.close` | — | the controls and the residual risk |
| `reopen` | `CLOSED` | `REOPENED` | `hse.hazard.reopen` | required | — |
| `cancel` | `OPEN`, `CONTROLLED`, `IN_PROGRESS`, `PENDING_VERIFICATION`, `REOPENED` | `CANCELLED` | `hse.hazard.cancel` | — | — |

### QA/QC

2 machines.

#### `quality_inspection` — `qualityInspection.status`

States: `DRAFT`, `IN_PROGRESS`, `PENDING_APPROVAL`, `APPROVED`, `REJECTED`, `CLOSED`, `CANCELLED`
Terminal: `CANCELLED`

| Action | From | To | Permission | Reason | Freezes |
|---|---|---|---|---|---|
| `start` | `DRAFT` | `IN_PROGRESS` | `qaqc.inspection.execute` | — | — |
| `submit` | `IN_PROGRESS` | `PENDING_APPROVAL` | `qaqc.inspection.submit` | — | the checklist answers and the verdict |
| `approve` | `PENDING_APPROVAL` | `APPROVED` | `qaqc.inspection.approve` | — | — |
| `reject` | `PENDING_APPROVAL` | `REJECTED` | `qaqc.inspection.reject` | — | — |
| `rework` | `REJECTED` | `IN_PROGRESS` | `qaqc.inspection.execute` | — | — |
| `close` | `APPROVED` | `CLOSED` | `qaqc.inspection.close` | — | the whole inspection |
| `reopen` | `CLOSED` | `APPROVED` | `qaqc.inspection.reopen` | — | — |
| `cancel` | `DRAFT`, `IN_PROGRESS` | `CANCELLED` | `qaqc.inspection.cancel` | — | — |

#### `corrective_action` — `correctiveAction.status`

States: `OPEN`, `IN_PROGRESS`, `PENDING_VERIFICATION`, `VERIFIED`, `REJECTED`, `CANCELLED`, `REOPENED`
Terminal: `CANCELLED`

| Action | From | To | Permission | Reason | Freezes |
|---|---|---|---|---|---|
| `start` | `OPEN` | `IN_PROGRESS` | `qaqc.corrective_action.assign` | — | — |
| `complete` | `OPEN`, `IN_PROGRESS`, `REJECTED`, `REOPENED` | `PENDING_VERIFICATION` | `qaqc.corrective_action.complete` | — | — |
| `verify` | `PENDING_VERIFICATION` | `VERIFIED` | `qaqc.corrective_action.verify` | — | the completion note and its evidence |
| `reject` | `PENDING_VERIFICATION` | `REJECTED` | `qaqc.corrective_action.verify` | required | — |
| `reopen` | `VERIFIED` | `REOPENED` | `qaqc.corrective_action.reopen` | required | — |
| `cancel` | `OPEN`, `IN_PROGRESS`, `PENDING_VERIFICATION`, `REJECTED`, `REOPENED` | `CANCELLED` | `qaqc.corrective_action.cancel` | — | — |

### Organization

1 machine.

#### `user_provisioning_request` — `userProvisioningRequest.status`

States: `DRAFT`, `SUBMITTED`, `APPROVED`, `IN_PROGRESS`, `PROVISIONED`, `REJECTED`, `CANCELLED`
Terminal: `PROVISIONED`, `REJECTED`, `CANCELLED`

| Action | From | To | Permission | Reason | Freezes |
|---|---|---|---|---|---|
| `submit` | `DRAFT` | `SUBMITTED` | `provisioning_request.submit` | — | — |
| `approve` | `SUBMITTED` | `APPROVED` | `organization.provisioning_request.approve` | — | — |
| `reject` | `SUBMITTED` | `REJECTED` | `organization.provisioning_request.approve` | required | — |
| `return` | `SUBMITTED`, `APPROVED`, `IN_PROGRESS` | `DRAFT` | `organization.provisioning_request.approve` or `organization.provisioning_request.process` | required | — |
| `start` | `APPROVED` | `IN_PROGRESS` | `organization.provisioning_request.process` | — | — |
| `provision` | `APPROVED`, `IN_PROGRESS` | `PROVISIONED` | `organization.user.provision` | — | everything |
| `cancel` | `DRAFT`, `SUBMITTED`, `APPROVED`, `IN_PROGRESS` | `CANCELLED` | `provisioning_request.create` or `organization.provisioning_request.process` | — | — |

### Projects

1 machine.

#### `project` — `project.status`

States: `PENDING`, `ACTIVE`, `FINISHED`, `ARCHIVED`
Terminal: none

| Action | From | To | Permission | Reason | Freezes |
|---|---|---|---|---|---|
| `activate` | `PENDING` | `ACTIVE` | `project.status.manage` | — | — |
| `finish` | `PENDING`, `ACTIVE` | `FINISHED` | `project.status.manage` | — | — |
| `reopen` | `FINISHED` | `ACTIVE` | `project.status.manage` | — | — |
| `return_to_pending` | `ACTIVE`, `FINISHED` | `PENDING` | `project.status.manage` | required | — |
| `archive` | `PENDING`, `ACTIVE`, `FINISHED` | `ARCHIVED` | `project.archive` | — | — |
| `restore` | `ARCHIVED` | `PENDING` or `ACTIVE` or `FINISHED` | `project.restore` | — | — |

### Project structure

1 machine.

#### `unit_publication` — `projectUnit.publicationStatus`

States: `DRAFT`, `READY_FOR_PUBLISHING`, `PUBLISHED`, `REVISION_REQUIRED`, `ARCHIVED`
Terminal: none

| Action | From | To | Permission | Reason | Freezes |
|---|---|---|---|---|---|
| `submit` | `DRAFT`, `REVISION_REQUIRED` | `READY_FOR_PUBLISHING` | `project.unit.submit_for_publish` | — | — |
| `publish` | `DRAFT`, `READY_FOR_PUBLISHING`, `REVISION_REQUIRED`, `PUBLISHED` | `PUBLISHED` | `project.unit.publish` | — | the published version: its snapshot, Sales Plan version and primary image |
| `request_revision` | `READY_FOR_PUBLISHING`, `PUBLISHED` | `REVISION_REQUIRED` | `project.unit.revision_request` | required | — |
| `unpublish` | `PUBLISHED` | `READY_FOR_PUBLISHING` | `project.unit.unpublish` | required | — |
| `archive` | `DRAFT`, `READY_FOR_PUBLISHING`, `PUBLISHED`, `REVISION_REQUIRED` | `ARCHIVED` | `project.unit.archive` | — | — |
| `restore` | `ARCHIVED` | `DRAFT` or `PUBLISHED` or `REVISION_REQUIRED` | `project.unit.archive` | — | — |

### Sales

1 machine.

#### `unit_commercial` — `unitCommercialProfile.status`

States: `NOT_FOR_SALE`, `FOR_SALE`, `ON_HOLD`, `RESERVED`, `SOLD`
Terminal: none

| Action | From | To | Permission | Reason | Freezes |
|---|---|---|---|---|---|
| `put_on_sale` | `NOT_FOR_SALE` | `FOR_SALE` | `project.unit.sales_status.manage` | — | — |
| `take_off_sale` | `FOR_SALE` | `NOT_FOR_SALE` | `project.unit.sales_status.manage` | — | — |
| `hold` | `FOR_SALE` | `ON_HOLD` | `project.unit.sales_status.manage` | required | — |
| `release_hold` | `ON_HOLD` | `FOR_SALE` | `project.unit.sales_status.manage` | — | — |
| `reserve` | `FOR_SALE`, `ON_HOLD` | `RESERVED` | `project.unit.reserve` | — | — |
| `release_reservation` | `RESERVED` | `FOR_SALE` | `project.unit.reservation.release` | required | — |
| `expire_reservation` | `RESERVED` | `FOR_SALE` | `project.unit.reservation.release` | — | — |
| `mark_sold` | `RESERVED` | `SOLD` | `project.unit.mark_sold` | — | the reservation, converted to the sale, with its client, deal and agreed price |
| `reopen` | `SOLD` | `FOR_SALE` or `RESERVED` | `project.unit.reopen_sale` | required | — |

### Documents

3 machines.

#### `document` — `document.status`

States: `ACTIVE`, `ARCHIVED`
Terminal: none

| Action | From | To | Permission | Reason | Freezes |
|---|---|---|---|---|---|
| `archive` | `ACTIVE` | `ARCHIVED` | `document.archive` | — | its details, its file and its reviews, until it is restored |
| `restore` | `ARCHIVED` | `ACTIVE` | `document.restore` | — | — |

#### `document_version_review` — `documentVersion.reviewState`

States: `DRAFT`, `IN_REVIEW`, `APPROVED`, `REJECTED`, `SUPERSEDED`
Terminal: `SUPERSEDED`

| Action | From | To | Permission | Reason | Freezes |
|---|---|---|---|---|---|
| `request` | `DRAFT`, `IN_REVIEW`, `REJECTED` | `IN_REVIEW` | `document.review.request` | — | — |
| `approve` | `IN_REVIEW` | `APPROVED` | `document.review.decide` | — | its review: an approved version is not sent round again |
| `reject` | `IN_REVIEW` | `REJECTED` | `document.review.decide` | — | — |
| `supersede` | `APPROVED` | `SUPERSEDED` | `document.review.decide` | — | — |

#### `document_review` — `documentReview.status`

States: `PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`
Terminal: `APPROVED`, `REJECTED`, `CANCELLED`

| Action | From | To | Permission | Reason | Freezes |
|---|---|---|---|---|---|
| `approve` | `PENDING` | `APPROVED` | `document.review.decide` | — | — |
| `reject` | `PENDING` | `REJECTED` | `document.review.decide` | required | — |
| `cancel` | `PENDING` | `CANCELLED` | `document.review.decide` | — | — |

### Finance

6 machines.

#### `invoice` — `invoice.status`

States: `DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `REJECTED`, `SENT`, `CANCELLED`, `ARCHIVED`
Terminal: none

| Action | From | To | Permission | Reason | Freezes |
|---|---|---|---|---|---|
| `submit` | `DRAFT`, `REJECTED` | `PENDING_APPROVAL` | `finance.invoice.submit` | — | — |
| `approve` | `PENDING_APPROVAL` | `APPROVED` | `finance.approval.decide` or `finance.invoice.approve` | — | the client, project, dates, currency and lines |
| `reject` | `PENDING_APPROVAL` | `REJECTED` | `finance.approval.decide` or `finance.invoice.reject` | required | — |
| `return` | `PENDING_APPROVAL` | `DRAFT` | `finance.approval.decide` or `finance.invoice.reject` | required | — |
| `mark_sent` | `APPROVED` | `SENT` | `finance.invoice.mark_sent` | — | — |
| `cancel` | `DRAFT`, `REJECTED`, `APPROVED`, `SENT` | `CANCELLED` | `finance.invoice.cancel` | — | — |
| `archive` | `DRAFT`, `REJECTED`, `CANCELLED` | `ARCHIVED` | `finance.invoice.archive` | — | — |
| `restore` | `ARCHIVED` | `DRAFT` or `REJECTED` or `CANCELLED` | `finance.invoice.restore` | — | — |

#### `expense` — `expense.status`

States: `DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `REJECTED`, `CANCELLED`, `ARCHIVED`
Terminal: none

| Action | From | To | Permission | Reason | Freezes |
|---|---|---|---|---|---|
| `submit` | `DRAFT`, `REJECTED` | `PENDING_APPROVAL` | `finance.expense.submit` | — | — |
| `approve` | `PENDING_APPROVAL` | `APPROVED` | `finance.approval.decide` or `finance.expense.approve` | — | the whole expense |
| `reject` | `PENDING_APPROVAL` | `REJECTED` | `finance.approval.decide` or `finance.expense.reject` | required | — |
| `return` | `PENDING_APPROVAL` | `DRAFT` | `finance.approval.decide` or `finance.expense.reject` | required | — |
| `cancel` | `DRAFT`, `REJECTED`, `APPROVED` | `CANCELLED` | `finance.expense.cancel` | — | — |
| `archive` | `DRAFT`, `REJECTED`, `CANCELLED` | `ARCHIVED` | `finance.expense.archive` | — | — |
| `restore` | `ARCHIVED` | `DRAFT` or `REJECTED` or `CANCELLED` | `finance.expense.restore` | — | — |

#### `payment` — `payment.status`

States: `RECORDED`, `VOIDED`
Terminal: `VOIDED`

| Action | From | To | Permission | Reason | Freezes |
|---|---|---|---|---|---|
| `void` | `RECORDED` | `VOIDED` | `finance.payment.void` | required | the whole payment |

#### `payment_schedule` — `paymentSchedule.status`

States: `DRAFT`, `ACTIVE`, `SUPERSEDED`, `COMPLETED`, `CANCELLED`
Terminal: `SUPERSEDED`, `COMPLETED`, `CANCELLED`

| Action | From | To | Permission | Reason | Freezes |
|---|---|---|---|---|---|
| `activate` | `DRAFT` | `ACTIVE` | `project.unit.finance.manage_schedule` | — | its installments, amounts and due dates |
| `supersede` | `ACTIVE` | `SUPERSEDED` | `project.unit.finance.manage_schedule` | — | — |
| `discard` | `DRAFT` | `CANCELLED` | `project.unit.finance.manage_schedule` | — | — |
| `cancel_with_contract` | `DRAFT`, `ACTIVE` | `CANCELLED` | `project.unit.contract.cancel` or `project.unit.finance.correct` | required | — |
| `complete_with_contract` | `ACTIVE` | `COMPLETED` | `project.unit.contract.sign_status` or `project.unit.finance.manage_schedule` | — | — |

#### `project_budget` — `projectBudget.status`

States: `DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `REJECTED`, `ARCHIVED`
Terminal: `APPROVED`

| Action | From | To | Permission | Reason | Freezes |
|---|---|---|---|---|---|
| `submit` | `DRAFT`, `REJECTED` | `PENDING_APPROVAL` | `finance.budget.submit` | — | — |
| `approve` | `PENDING_APPROVAL` | `APPROVED` | `finance.approval.decide` or `finance.budget.approve` | — | the whole version — a change is the next version |
| `reject` | `PENDING_APPROVAL` | `REJECTED` | `finance.approval.decide` or `finance.budget.reject` | required | — |
| `return` | `PENDING_APPROVAL` | `DRAFT` | `finance.approval.decide` or `finance.budget.reject` | required | — |
| `archive` | `DRAFT`, `REJECTED` | `ARCHIVED` | `finance.budget.archive` | — | — |
| `restore` | `ARCHIVED` | `DRAFT` or `REJECTED` | `finance.budget.restore` | — | — |

#### `commitment` — `commitment.status`

States: `DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `REJECTED`, `CLOSED`, `CANCELLED`, `ARCHIVED`
Terminal: none

| Action | From | To | Permission | Reason | Freezes |
|---|---|---|---|---|---|
| `submit` | `DRAFT`, `REJECTED` | `PENDING_APPROVAL` | `finance.commitment.submit` | — | — |
| `approve` | `PENDING_APPROVAL` | `APPROVED` | `finance.approval.decide` or `finance.commitment.approve` | — | — |
| `reject` | `PENDING_APPROVAL` | `REJECTED` | `finance.approval.decide` or `finance.commitment.reject` | required | — |
| `return` | `PENDING_APPROVAL` | `DRAFT` | `finance.approval.decide` or `finance.commitment.reject` | required | — |
| `close` | `APPROVED` | `CLOSED` | `finance.commitment.close` | — | — |
| `cancel` | `DRAFT`, `REJECTED`, `APPROVED` | `CANCELLED` | `finance.commitment.cancel` | — | — |
| `archive` | `DRAFT`, `REJECTED`, `CANCELLED`, `CLOSED` | `ARCHIVED` | `finance.commitment.archive` | — | — |
| `restore` | `ARCHIVED` | `DRAFT` or `REJECTED` or `CANCELLED` or `CLOSED` | `finance.commitment.restore` | — | — |

### Procurement

6 machines.

#### `purchase_request` — `purchaseRequest.status`

States: `DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `REJECTED`, `IN_SOURCING`, `PARTIALLY_ORDERED`, `ORDERED`, `COMPLETED`, `CANCELLED`, `ARCHIVED`
Terminal: none

| Action | From | To | Permission | Reason | Freezes |
|---|---|---|---|---|---|
| `submit` | `DRAFT`, `REJECTED` | `PENDING_APPROVAL` | `procurement.request.submit` | — | — |
| `approve` | `PENDING_APPROVAL` | `APPROVED` | `procurement.request.approve` | — | the lines asked for |
| `reject` | `PENDING_APPROVAL` | `REJECTED` | `procurement.request.reject` | — | — |
| `return` | `PENDING_APPROVAL` | `DRAFT` | `procurement.request.reject` | — | — |
| `start_sourcing` | `APPROVED` | `IN_SOURCING` | `procurement.rfq.create` | — | — |
| `partially_order` | `IN_SOURCING` | `PARTIALLY_ORDERED` | `procurement.order.issue` or `procurement.order.cancel` or `procurement.order.close` or `procurement.receipt.create` or `procurement.receipt.void` | — | — |
| `order` | `IN_SOURCING`, `PARTIALLY_ORDERED` | `ORDERED` | `procurement.order.issue` or `procurement.order.cancel` or `procurement.order.close` or `procurement.receipt.create` or `procurement.receipt.void` | — | — |
| `complete` | `ORDERED` | `COMPLETED` | `procurement.order.issue` or `procurement.order.cancel` or `procurement.order.close` or `procurement.receipt.create` or `procurement.receipt.void` | — | — |
| `cancel` | `DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `REJECTED`, `IN_SOURCING`, `PARTIALLY_ORDERED` | `CANCELLED` | `procurement.request.cancel` | — | — |
| `archive` | `DRAFT`, `CANCELLED`, `COMPLETED` | `ARCHIVED` | `procurement.request.archive` | — | — |
| `restore` | `ARCHIVED` | `DRAFT` or `CANCELLED` or `COMPLETED` | `procurement.request.restore` | — | — |

#### `rfq` — `rFQ.status`

States: `DRAFT`, `ISSUED`, `CLOSED`, `CANCELLED`
Terminal: `CLOSED`, `CANCELLED`

| Action | From | To | Permission | Reason | Freezes |
|---|---|---|---|---|---|
| `issue` | `DRAFT` | `ISSUED` | `procurement.rfq.issue` | — | the lines suppliers are asked to price |
| `close` | `ISSUED` | `CLOSED` | `procurement.rfq.close` | — | — |
| `cancel` | `DRAFT`, `ISSUED` | `CANCELLED` | `procurement.rfq.cancel` | — | — |

#### `supplier_quote` — `supplierQuote.status`

States: `DRAFT`, `RECEIVED`, `DISQUALIFIED`, `SELECTED`, `NOT_SELECTED`
Terminal: `DISQUALIFIED`, `SELECTED`, `NOT_SELECTED`

| Action | From | To | Permission | Reason | Freezes |
|---|---|---|---|---|---|
| `disqualify` | `DRAFT`, `RECEIVED` | `DISQUALIFIED` | `procurement.quote.disqualify` | — | the quote as answered |
| `select` | `RECEIVED` | `SELECTED` | `procurement.quote.select` | — | the quote as answered |
| `pass_over` | `RECEIVED` | `NOT_SELECTED` | `procurement.quote.select` | — | the quote as answered |

#### `purchase_order` — `purchaseOrder.status`

States: `DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `REJECTED`, `ISSUED`, `PARTIALLY_RECEIVED`, `RECEIVED`, `CLOSED`, `CANCELLED`, `ARCHIVED`
Terminal: none

| Action | From | To | Permission | Reason | Freezes |
|---|---|---|---|---|---|
| `submit` | `DRAFT`, `REJECTED` | `PENDING_APPROVAL` | `procurement.order.submit` | — | — |
| `approve` | `PENDING_APPROVAL` | `APPROVED` | `procurement.order.approve`, or the approval step's approver | — | the lines and the amount committed |
| `reject` | `PENDING_APPROVAL` | `REJECTED` | `procurement.order.reject`, or the approval step's approver | — | — |
| `return` | `PENDING_APPROVAL` | `DRAFT` | `procurement.order.reject`, or the approval step's approver | — | — |
| `issue` | `APPROVED` | `ISSUED` | `procurement.order.issue` | — | — |
| `reconcile_receipts` | `ISSUED`, `PARTIALLY_RECEIVED`, `RECEIVED` | `ISSUED` or `PARTIALLY_RECEIVED` or `RECEIVED` | `procurement.receipt.create` or `procurement.receipt.void` | — | — |
| `cancel` | `DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `REJECTED`, `ISSUED` | `CANCELLED` | `procurement.order.cancel` | — | — |
| `close` | `PARTIALLY_RECEIVED`, `RECEIVED` | `CLOSED` | `procurement.order.close` | — | — |
| `archive` | `DRAFT`, `CLOSED`, `CANCELLED` | `ARCHIVED` | `procurement.order.archive` | — | — |
| `restore` | `ARCHIVED` | `DRAFT` or `CLOSED` or `CANCELLED` | `procurement.order.restore` | — | — |

#### `goods_receipt` — `goodsReceipt.status`

States: `RECORDED`, `VOIDED`
Terminal: `VOIDED`

| Action | From | To | Permission | Reason | Freezes |
|---|---|---|---|---|---|
| `void` | `RECORDED` | `VOIDED` | `procurement.receipt.void` | — | — |

#### `supplier` — `supplier.status`

States: `ACTIVE`, `INACTIVE`, `ARCHIVED`
Terminal: none

| Action | From | To | Permission | Reason | Freezes |
|---|---|---|---|---|---|
| `activate` | `INACTIVE` | `ACTIVE` | `procurement.supplier.update` | — | — |
| `deactivate` | `ACTIVE` | `INACTIVE` | `procurement.supplier.update` | — | — |
| `archive` | `ACTIVE`, `INACTIVE` | `ARCHIVED` | `procurement.supplier.archive` | — | — |
| `restore` | `ARCHIVED` | `INACTIVE` | `procurement.supplier.restore` | — | — |

### Inventory

9 machines.

#### `inventory_receipt` — `inventoryReceipt.status`

States: `DRAFT`, `POSTED`, `CANCELLED`, `REVERSED`
Terminal: `CANCELLED`, `REVERSED`

| Action | From | To | Permission | Reason | Freezes |
|---|---|---|---|---|---|
| `post` | `DRAFT` | `POSTED` | `inventory.receipt.post` | — | its lines, and the movements they posted |
| `cancel` | `DRAFT` | `CANCELLED` | `inventory.receipt.create` | — | the whole draft |
| `reverse` | `POSTED` | `REVERSED` | `inventory.receipt.reverse` | — | — |

#### `stock_issue` — `stockIssue.status`

States: `DRAFT`, `POSTED`, `CANCELLED`, `REVERSED`
Terminal: `CANCELLED`, `REVERSED`

| Action | From | To | Permission | Reason | Freezes |
|---|---|---|---|---|---|
| `post` | `DRAFT` | `POSTED` | `inventory.issue.post` | — | its lines, and the movements they posted |
| `cancel` | `DRAFT` | `CANCELLED` | `inventory.issue.cancel` | — | the whole draft |
| `reverse` | `POSTED` | `REVERSED` | `inventory.issue.reverse` | — | — |

#### `stock_return` — `stockReturn.status`

States: `DRAFT`, `POSTED`, `CANCELLED`
Terminal: `POSTED`, `CANCELLED`

| Action | From | To | Permission | Reason | Freezes |
|---|---|---|---|---|---|
| `post` | `DRAFT` | `POSTED` | `inventory.return.post` | — | its lines, and the movements they posted |
| `cancel` | `DRAFT` | `CANCELLED` | `inventory.return.create` | — | the whole draft |

#### `stock_transfer` — `stockTransfer.status`

States: `DRAFT`, `POSTED`, `CANCELLED`, `REVERSED`
Terminal: `CANCELLED`, `REVERSED`

| Action | From | To | Permission | Reason | Freezes |
|---|---|---|---|---|---|
| `post` | `DRAFT` | `POSTED` | `inventory.transfer.post` | — | its lines, and the movements they posted |
| `cancel` | `DRAFT` | `CANCELLED` | `inventory.transfer.cancel` | — | the whole draft |
| `reverse` | `POSTED` | `REVERSED` | `inventory.transfer.reverse` | — | — |

#### `stock_adjustment` — `stockAdjustment.status`

States: `DRAFT`, `POSTED`, `CANCELLED`, `REVERSED`
Terminal: `CANCELLED`, `REVERSED`

| Action | From | To | Permission | Reason | Freezes |
|---|---|---|---|---|---|
| `post` | `DRAFT` | `POSTED` | `inventory.adjustment.post` | — | its lines, and the movements they posted |
| `cancel` | `DRAFT` | `CANCELLED` | `inventory.adjustment.cancel` | — | the whole draft |
| `reverse` | `POSTED` | `REVERSED` | `inventory.adjustment.reverse` | — | — |

#### `stock_reservation` — `stockReservation.status`

States: `ACTIVE`, `PARTIALLY_FULFILLED`, `FULFILLED`, `RELEASED`, `CANCELLED`, `EXPIRED`
Terminal: `FULFILLED`, `RELEASED`, `CANCELLED`, `EXPIRED`

| Action | From | To | Permission | Reason | Freezes |
|---|---|---|---|---|---|
| `release` | `ACTIVE`, `PARTIALLY_FULFILLED` | `RELEASED` | `inventory.reservation.release` | — | — |
| `cancel` | `ACTIVE`, `PARTIALLY_FULFILLED` | `CANCELLED` | `inventory.reservation.cancel` | — | — |
| `expire` | `ACTIVE`, `PARTIALLY_FULFILLED` | `EXPIRED` | `inventory.reservation.release` | — | — |
| `fulfill` | `ACTIVE`, `PARTIALLY_FULFILLED` | `PARTIALLY_FULFILLED` or `FULFILLED` | `inventory.issue.post` | — | — |

#### `inventory_item` — `inventoryItem.status`

States: `ACTIVE`, `INACTIVE`, `ARCHIVED`
Terminal: none

| Action | From | To | Permission | Reason | Freezes |
|---|---|---|---|---|---|
| `activate` | `INACTIVE` | `ACTIVE` | `inventory.item.update` | — | — |
| `deactivate` | `ACTIVE` | `INACTIVE` | `inventory.item.update` | — | — |
| `archive` | `ACTIVE`, `INACTIVE` | `ARCHIVED` | `inventory.item.archive` | — | the item's details, until it is restored |
| `restore` | `ARCHIVED` | `INACTIVE` | `inventory.item.restore` | — | — |

#### `warehouse` — `warehouse.status`

States: `ACTIVE`, `INACTIVE`, `ARCHIVED`
Terminal: none

| Action | From | To | Permission | Reason | Freezes |
|---|---|---|---|---|---|
| `activate` | `INACTIVE` | `ACTIVE` | `inventory.warehouse.update` | — | — |
| `deactivate` | `ACTIVE` | `INACTIVE` | `inventory.warehouse.update` | — | — |
| `archive` | `ACTIVE`, `INACTIVE` | `ARCHIVED` | `inventory.warehouse.archive` | — | the warehouse's details, until it is restored |
| `restore` | `ARCHIVED` | `INACTIVE` | `inventory.warehouse.restore` | — | — |

#### `inventory_location` — `inventoryLocation.status`

States: `ACTIVE`, `INACTIVE`, `ARCHIVED`
Terminal: `ARCHIVED`

| Action | From | To | Permission | Reason | Freezes |
|---|---|---|---|---|---|
| `archive` | `ACTIVE`, `INACTIVE` | `ARCHIVED` | `inventory.location.archive` | — | — |

### Legal

4 machines.

#### `contract` — `contract.status`

States: `DRAFT`, `IN_REVIEW`, `PENDING_APPROVAL`, `APPROVED`, `SENT`, `SIGNED`, `ACTIVE`, `COMPLETED`, `EXPIRED`, `TERMINATED`, `CANCELLED`, `ARCHIVED`
Terminal: none

| Action | From | To | Permission | Reason | Freezes |
|---|---|---|---|---|---|
| `submit_review` | `DRAFT` | `IN_REVIEW` | `legal.contract.submit_review` | — | — |
| `return_to_draft` | `IN_REVIEW` | `DRAFT` | `legal.contract.review` | — | — |
| `submit_approval` | `IN_REVIEW` | `PENDING_APPROVAL` | `legal.contract.submit_approval` | — | — |
| `approve` | `PENDING_APPROVAL` | `APPROVED` | `legal.contract.approve` | — | the value, dates, parties and legal terms |
| `reject` | `PENDING_APPROVAL` | `IN_REVIEW` | `legal.contract.reject` | required | — |
| `return_for_revision` | `PENDING_APPROVAL` | `DRAFT` | `legal.contract.reject` | required | — |
| `mark_sent` | `APPROVED` | `SENT` | `legal.contract.mark_sent` | — | — |
| `mark_signed` | `SENT` | `SIGNED` | `legal.contract.mark_signed` | — | — |
| `activate` | `SIGNED` | `ACTIVE` | `legal.contract.activate` | — | — |
| `complete` | `ACTIVE` | `COMPLETED` | `legal.contract.complete` | — | the contract, its units and its schedule |
| `expire` | `ACTIVE` | `EXPIRED` | `legal.contract.expire` | — | — |
| `terminate` | `SIGNED`, `ACTIVE` | `TERMINATED` | `legal.contract.terminate` | required | — |
| `cancel` | `DRAFT`, `IN_REVIEW`, `PENDING_APPROVAL`, `APPROVED`, `SENT` | `CANCELLED` | `legal.contract.cancel` | — | — |
| `archive` | `DRAFT`, `COMPLETED`, `EXPIRED`, `TERMINATED`, `CANCELLED` | `ARCHIVED` | `legal.contract.archive` | — | — |
| `restore` | `ARCHIVED` | `DRAFT` or `COMPLETED` or `EXPIRED` or `TERMINATED` or `CANCELLED` | `legal.contract.restore` | — | — |

#### `contract_amendment` — `contractAmendment.status`

States: `DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `REJECTED`, `SENT`, `SIGNED`, `ACTIVE`, `CANCELLED`, `ARCHIVED`
Terminal: `ACTIVE`, `ARCHIVED`

| Action | From | To | Permission | Reason | Freezes |
|---|---|---|---|---|---|
| `submit` | `DRAFT`, `REJECTED` | `PENDING_APPROVAL` | `legal.amendment.submit` | — | the amendment's terms |
| `approve` | `PENDING_APPROVAL` | `APPROVED` | `legal.amendment.approve` | — | — |
| `reject` | `PENDING_APPROVAL` | `REJECTED` | `legal.amendment.reject` | required | — |
| `return_for_revision` | `PENDING_APPROVAL` | `DRAFT` | `legal.amendment.reject` | required | — |
| `mark_sent` | `APPROVED` | `SENT` | `legal.amendment.mark_sent` | — | — |
| `mark_signed` | `SENT` | `SIGNED` | `legal.amendment.mark_signed` | — | — |
| `activate` | `SIGNED` | `ACTIVE` | `legal.amendment.activate` | — | the whole amendment, and the contract values it replaced |
| `cancel` | `DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `REJECTED`, `SENT`, `SIGNED` | `CANCELLED` | `legal.amendment.cancel` | — | — |
| `archive` | `DRAFT`, `REJECTED`, `CANCELLED` | `ARCHIVED` | `legal.amendment.archive` | — | — |

#### `contract_obligation` — `contractObligation.status`

States: `OPEN`, `COMPLETED`, `CANCELLED`
Terminal: `COMPLETED`, `CANCELLED`

| Action | From | To | Permission | Reason | Freezes |
|---|---|---|---|---|---|
| `complete` | `OPEN` | `COMPLETED` | `legal.obligation.complete` | — | the whole obligation |
| `cancel` | `OPEN` | `CANCELLED` | `legal.obligation.cancel` | — | the whole obligation |

#### `unit_contract_request` — `unitContractRequest.status`

States: `OPEN`, `FULFILLED`, `DECLINED`, `CANCELLED`
Terminal: `FULFILLED`, `DECLINED`, `CANCELLED`

| Action | From | To | Permission | Reason | Freezes |
|---|---|---|---|---|---|
| `fulfil` | `OPEN` | `FULFILLED` | `project.unit.contract.create` | — | — |
| `decline` | `OPEN` | `DECLINED` | `project.unit.contract.review` | required | — |
| `cancel` | `OPEN` | `CANCELLED` | `project.unit.contract.request` or `project.unit.contract.review` | — | — |

### Engineering

6 machines.

#### `engineering_document` — `engineeringDocument.status`

States: `DRAFT`, `SUBMITTED`, `UNDER_REVIEW`, `APPROVED`, `APPROVED_WITH_COMMENTS`, `REVISION_REQUIRED`, `REJECTED`, `SUPERSEDED`, `VOID`
Terminal: `SUPERSEDED`, `VOID`

| Action | From | To | Permission | Reason | Freezes |
|---|---|---|---|---|---|
| `submit` | `DRAFT`, `APPROVED`, `APPROVED_WITH_COMMENTS`, `REVISION_REQUIRED`, `REJECTED` | `SUBMITTED` | `engineering_document.submit` | — | the title and type, while the reviewer has them |
| `start_review` | `SUBMITTED` | `UNDER_REVIEW` | `engineering_document.review` | — | — |
| `approve` | `SUBMITTED`, `UNDER_REVIEW` | `APPROVED` | `engineering_document.approve` | — | the title and type that were approved |
| `approve_with_comments` | `SUBMITTED`, `UNDER_REVIEW` | `APPROVED_WITH_COMMENTS` | `engineering_document.approve` | — | the title and type that were approved |
| `require_revision` | `SUBMITTED`, `UNDER_REVIEW` | `REVISION_REQUIRED` | `engineering_document.review` | — | — |
| `reject` | `SUBMITTED`, `UNDER_REVIEW` | `REJECTED` | `engineering_document.review` | — | — |
| `void` | `DRAFT`, `SUBMITTED`, `UNDER_REVIEW`, `APPROVED`, `APPROVED_WITH_COMMENTS`, `REVISION_REQUIRED`, `REJECTED` | `VOID` | `engineering_document.approve` | required | the whole document |
| `supersede` | `DRAFT`, `APPROVED`, `APPROVED_WITH_COMMENTS`, `REVISION_REQUIRED`, `REJECTED` | `SUPERSEDED` | `engineering_document.approve` | required | the whole document |

#### `engineering_revision` — `engineeringDocumentRevision.status`

States: `DRAFT`, `SUBMITTED`, `UNDER_REVIEW`, `FINALIZED`, `SUPERSEDED`, `VOID`
Terminal: `SUPERSEDED`, `VOID`

| Action | From | To | Permission | Reason | Freezes |
|---|---|---|---|---|---|
| `submit` | `DRAFT` | `SUBMITTED` | `engineering_document.submit` | — | the file, at the exact version submitted |
| `start_review` | `SUBMITTED` | `UNDER_REVIEW` | `engineering_document.review` | — | — |
| `decide` | `SUBMITTED`, `UNDER_REVIEW` | `FINALIZED` | `engineering_document.review` | — | the decision and the reviewer's comment |
| `supersede` | `SUBMITTED`, `UNDER_REVIEW`, `FINALIZED` | `SUPERSEDED` | `engineering_document.approve` | — | — |
| `void` | `DRAFT` | `VOID` | `engineering_document.edit` | — | — |

#### `rfi` — `rfi.status`

States: `DRAFT`, `OPEN`, `ANSWERED`, `CLARIFICATION_REQUIRED`, `CLOSED`, `VOID`
Terminal: `CLOSED`, `VOID`

| Action | From | To | Permission | Reason | Freezes |
|---|---|---|---|---|---|
| `open` | `DRAFT` | `OPEN` | `rfi.open` | — | the subject and the question |
| `respond` | `OPEN`, `ANSWERED`, `CLARIFICATION_REQUIRED` | `ANSWERED` | `rfi.respond` | — | — |
| `request_clarification` | `ANSWERED` | `CLARIFICATION_REQUIRED` | `rfi.edit` | — | — |
| `close` | `ANSWERED` | `CLOSED` | `rfi.close` | — | the whole RFI, its responses and its references |
| `void` | `DRAFT`, `OPEN`, `ANSWERED`, `CLARIFICATION_REQUIRED` | `VOID` | `rfi.void` | required | the whole RFI |

#### `technical_submittal` — `technicalSubmittal.status`

States: `DRAFT`, `SUBMITTED`, `UNDER_REVIEW`, `APPROVED`, `APPROVED_WITH_COMMENTS`, `REVISION_REQUIRED`, `REJECTED`, `CLOSED`, `VOID`
Terminal: `CLOSED`, `VOID`

| Action | From | To | Permission | Reason | Freezes |
|---|---|---|---|---|---|
| `submit` | `DRAFT`, `APPROVED`, `APPROVED_WITH_COMMENTS`, `REVISION_REQUIRED`, `REJECTED` | `SUBMITTED` | `submittal.submit` | — | the product details under review |
| `start_review` | `SUBMITTED` | `UNDER_REVIEW` | `submittal.review` | — | — |
| `approve` | `SUBMITTED`, `UNDER_REVIEW` | `APPROVED` | `submittal.approve` | — | the product details under review |
| `approve_with_comments` | `SUBMITTED`, `UNDER_REVIEW` | `APPROVED_WITH_COMMENTS` | `submittal.approve` | — | the product details under review |
| `require_revision` | `SUBMITTED`, `UNDER_REVIEW` | `REVISION_REQUIRED` | `submittal.review` | — | — |
| `reject` | `SUBMITTED`, `UNDER_REVIEW` | `REJECTED` | `submittal.review` | — | the product details under review |
| `close` | `APPROVED`, `APPROVED_WITH_COMMENTS`, `REJECTED` | `CLOSED` | `submittal.approve` | — | the whole submittal |
| `void` | `DRAFT`, `SUBMITTED`, `UNDER_REVIEW`, `APPROVED`, `APPROVED_WITH_COMMENTS`, `REVISION_REQUIRED`, `REJECTED` | `VOID` | `submittal.approve` | required | the whole submittal |

#### `submittal_revision` — `technicalSubmittalRevision.status`

States: `DRAFT`, `SUBMITTED`, `UNDER_REVIEW`, `FINALIZED`, `SUPERSEDED`, `VOID`
Terminal: `SUPERSEDED`, `VOID`

| Action | From | To | Permission | Reason | Freezes |
|---|---|---|---|---|---|
| `submit` | `DRAFT` | `SUBMITTED` | `submittal.submit` | — | the file, at the exact version submitted |
| `start_review` | `SUBMITTED` | `UNDER_REVIEW` | `submittal.review` | — | — |
| `decide` | `SUBMITTED`, `UNDER_REVIEW` | `FINALIZED` | `submittal.review` | — | the decision and the reviewer's comment |
| `supersede` | `SUBMITTED`, `UNDER_REVIEW`, `FINALIZED` | `SUPERSEDED` | `submittal.approve` | — | — |
| `void` | `DRAFT` | `VOID` | `submittal.edit` | — | — |

#### `document_transmittal` — `documentTransmittal.status`

States: `DRAFT`, `ISSUED`, `VOID`
Terminal: `VOID`

| Action | From | To | Permission | Reason | Freezes |
|---|---|---|---|---|---|
| `issue` | `DRAFT` | `ISSUED` | `transmittal.issue` | — | its items and the file version each carried |
| `void` | `DRAFT`, `ISSUED` | `VOID` | `transmittal.void` | required | — |

## What is not declared yet, and what is guarded without a machine

**Other domains.** QA/QC's defects, NCRs, requests and templates, the rest of
HSE, Sales' leads and opportunities, Clients, Team, Tasks, HR, Contractors, Calendar,
Meetings, and the notification, integration and mail infrastructure still
transition through their own services. That is held, not ignored. `pnpm
verify:state` counts every write that sets a state column without naming a
state column in its `where`, per file, against
`scripts/architecture/blind-state-writes.baseline.json` — 87 writes in 31
files, none of them a status write in the domains above. The count may fall and never
rise: a new blind write fails CI, and a domain converted to a machine ratchets
its own entry down. The baseline is the backlog, in the order the files appear
in it.

**Writes the gate cannot read.** A payload built by spreading, or passed by
name (`update({ where, data })`), hides which columns it writes, so the blind
count cannot tell whether it sets a state. On a model with a state column such
a write is counted against its own ratchet,
`scripts/architecture/unreadable-state-writes.baseline.json` — 19 writes in 16
files — unless its `where` names a state. Spelling the columns out is usually
the fix, and is what the Legal and Inventory edits did.

**Guarded on purpose, without a machine.** A machine is for a lifecycle a
person moves a record through. These are state columns too, and each binds
the state it read, but they are not that:

- *The document storage pipeline* — `storageStatus`, `scanStatus` and
  `previewStatus` on documents and versions, and `documentUploadSession.status`.
  Background workers drive most of it under a `SystemContext`, never a
  `UserContext`, and its table already lives in
  `lib/core/storage/storage-state.ts`. Every writer claims the upload session
  first, conditional on the state it read, and writes the document or version
  conditional on `VERIFYING`; the file is deleted only after that claim
  commits. See `docs/document-lifecycle.md`.
- *Approval cycle rows* — `financeApproval`, `procurementApproval`,
  `contractApproval` and `approvalStep`. Each decision is already conditional
  on `PENDING`; the record the cycle is about moves by its own machine.
- *Invitation rows on an enquiry* — `rFQSupplier` carries no company column,
  so it cannot be scoped the way `applyTransition` scopes a write. Recording a
  quote and disqualifying a supplier bind the invitation's status instead.
- *Unit reservations* — `unitReservation.status`. A reservation lives beside
  the unit's `unit_commercial` machine and moves only with it, in the same
  transaction under the profile's row lock: closing one is conditional on
  `ACTIVE` (and, for the expiry job, on the expiry having passed), so a release
  and the job racing end it once. The job itself moves the unit with the
  machine's `expire_reservation`, checked with `canMove` and written
  conditional on `RESERVED`, because it has no `UserContext`
  (`lib/modules/sales/units/unit-sales.core.ts`, `docs/unit-sales.md`).
- *Scheduled employment changes* — `employmentChange.status`. The job claims
  a due change `SCHEDULED` → `APPLIED` in the transaction that applies it, and
  cancelling or failing one is conditional on `SCHEDULED` too, so a cancel and
  the job racing settle it once. An employment's own status is not a column a
  service moves: it is recomputed from its status history
  (`docs/employment-history.md`).
- *Finance commitments moved through Procurement's door* —
  `ensureCommitmentForSource` and `settleCommitmentForSource`. The door's
  contract is that the caller authorises, and a buyer need not hold a finance
  permission; both writes bind the status they read, and settling one that
  lost a race is a quiet no-op rather than a rollback of the order.

**Known limits.**

- Legal's approvals need `legal.approval.decide` *and* the record's own
  permission. A transition says "any of", so the machines declare the record's
  permission and the service still checks both.
- Two stock issues drawing on the same partly fulfilled reservation both move
  it from `PARTIALLY_FULFILLED` to `PARTIALLY_FULFILLED`; a state guard cannot
  tell them apart. Closing that needs a row lock or a version column. Nothing
  links an issue line to a reservation today, so the path is dormant.
- Documents' review decisions take a row lock on the version rather than a
  state guard alone: completion is a count of requests still pending, and a
  count cannot see another reviewer's uncommitted decision.

## Adding a machine

1. Write `<domain>/<record>.machine.ts`, declaring the states, the terminal
   states and the transitions. Read them off the service, not off the PRD —
   the table is a claim about what the code does. `defineStateMachine` refuses
   a transition from no state, a state the machine does not declare, an action
   defined twice, and a terminal state something leads out of.
2. Register it in `lib/core/state/registry.ts`. An unregistered machine is
   checked by nothing — not the gate, not the docs, not the tests.
3. Replace the service's status writes with `applyTransition`, passing the
   state the service read as `from`.
4. Run `pnpm verify:state --update-baseline` and commit the fall in both
   baselines.
5. Regenerate the tables above with
   `npx tsx scripts/architecture/state-docs.ts` and the API security matrix
   with `pnpm security:matrix`. `applyTransition` is state-guard evidence
   there, so a converted endpoint keeps its evidence rather than losing it.

The transition matrix in `tests/architecture/state.test.ts` walks every
registered machine — every action from every state, with and without its
permissions and its reason — so a new machine is tested the day it is
registered, without a test written for it.

The gate refuses a machine that governs a model its own domain does not own.
A transition is a write, and `applyTransition` reaches its table through a
delegate name that PRD #48's ownership scanner cannot see — the registry is
what puts those writes back under the same rule as every other write.
