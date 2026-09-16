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

## What is declared

### `hse_inspection` — `hseInspection.status`

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

### `hse_permit` — `hseWorkPermit.status`

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

### `hse_action` — `hseAction.status`

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

### `hse_incident` — `hseIncident.status`

States: `OPEN`, `UNDER_INVESTIGATION`, `ACTIONS_OPEN`, `PENDING_CLOSE`, `CLOSED`, `CANCELLED`, `REOPENED`
Terminal: `CANCELLED`

| Action | From | To | Permission | Reason | Freezes |
|---|---|---|---|---|---|
| `investigate` | `OPEN`, `REOPENED`, `UNDER_INVESTIGATION` | `UNDER_INVESTIGATION` | `hse.incident.investigate` | — | — |
| `submit_close` | `UNDER_INVESTIGATION`, `ACTIONS_OPEN` | `PENDING_CLOSE` | `hse.incident.submit_close` | — | — |
| `close` | `PENDING_CLOSE` | `CLOSED` | `hse.incident.close` | — | the investigation, its root cause and its lessons |
| `reopen` | `CLOSED` | `REOPENED` | `hse.incident.reopen` | required | — |
| `cancel` | `OPEN`, `UNDER_INVESTIGATION`, `ACTIONS_OPEN`, `PENDING_CLOSE`, `REOPENED` | `CANCELLED` | `hse.incident.cancel` | — | — |

### `hse_hazard` — `hseHazard.status`

States: `OPEN`, `CONTROLLED`, `IN_PROGRESS`, `PENDING_VERIFICATION`, `CLOSED`, `CANCELLED`, `REOPENED`
Terminal: `CANCELLED`

| Action | From | To | Permission | Reason | Freezes |
|---|---|---|---|---|---|
| `start` | `OPEN` | `IN_PROGRESS` | `hse.hazard.assign` | — | — |
| `control` | `OPEN`, `CONTROLLED`, `IN_PROGRESS`, `PENDING_VERIFICATION`, `REOPENED` | `CONTROLLED` | `hse.hazard.control` | — | — |
| `close` | `OPEN`, `CONTROLLED`, `IN_PROGRESS`, `PENDING_VERIFICATION`, `REOPENED` | `CLOSED` | `hse.hazard.close` | — | the controls and the residual risk |
| `reopen` | `CLOSED` | `REOPENED` | `hse.hazard.reopen` | required | — |
| `cancel` | `OPEN`, `CONTROLLED`, `IN_PROGRESS`, `PENDING_VERIFICATION`, `REOPENED` | `CANCELLED` | `hse.hazard.cancel` | — | — |

### `quality_inspection` — `qualityInspection.status`

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

### `corrective_action` — `correctiveAction.status`

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

## What is not declared yet

Seven machines cover the two domains where a lost transition matters most —
safety and quality records, where the register is the evidence that something
was dealt with. Every other domain still transitions through its own service.

That is held, not ignored. `pnpm verify:state` counts every write to a state
column that does not name a state column in its `where`, per file, against
`scripts/architecture/blind-state-writes.baseline.json`. The count may fall and
never rise: a new blind write fails CI, and a domain converted to a machine
ratchets its own entry down. The baseline is the backlog, in the order the
files appear in it.

Several domains were already guarded before any of this and needed nothing:
procurement's purchase orders bind `status: existing.status` in `moveStatus`,
daily logs bind both the status and the row version, and the document storage
worker binds `storageStatus` before writing `scanStatus`. Those are the shape
the machine generalises, not exceptions to it.

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
4. Run `pnpm verify:state --update-baseline` and commit the fall.

The gate refuses a machine that governs a model its own domain does not own.
A transition is a write, and `applyTransition` reaches its table through a
delegate name that PRD #48's ownership scanner cannot see — the registry is
what puts those writes back under the same rule as every other write.
