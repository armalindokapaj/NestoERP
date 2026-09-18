# Domain dependencies

Per PRD #48 §155–§162, §268–§274.

Which way the arrows point, and the six places they point both ways.

## The intended direction

```
                    business domains
   projects  tasks  finance  procurement  inventory  hse  qaqc  …
        │        │       │         │          │       │     │
        └────────┴───────┴────┬────┴──────────┴───────┴─────┘
                              ↓
                      shared foundation
        auth · access · records · audit · attention · outbox
              integrations · collaboration · storage
```

Business domains depend on the foundation. The foundation does not depend on a
business domain — with one deliberate exception, below (PRD #48 §272).

## Registries: the one inversion

A registry is how this codebase inverts a dependency without a container. One
file lists the record types, the scheduled jobs, the attention conditions, the
calendar sources, the approval sources, the searchable types — and that list
names every domain.

```
lib/core/records/record.registry.ts            every record type
lib/core/jobs/job.handlers.ts                  every scheduled job
lib/core/notifications/attention.conditions.ts every attention condition
lib/core/search/search.providers.ts            every searchable type
lib/modules/calendar/calendar.providers.ts     every source of dated things
lib/modules/approvals/approvals.registry.ts    every approval source
lib/modules/productivity/navigable.registry.ts every starrable type
lib/modules/dashboard/dashboard.service.ts     every KPI
```

The platform does not depend on Finance because it wants to; it depends on the
list, and the list happens to name Finance. `pnpm verify:ownership` cuts these
files' imports from the dependency graph — counting them makes every domain
everyone's neighbour and the graph stops saying anything. They are declared in
`AGGREGATION_POINTS` with what each one lists (PRD #48 §273).

Adding a file to that list is a decision, not a convenience: it is only honest
for a file that exists to hold a list.

## The six circles

After the registries are cut, six pairs of domains still import each other.
Each is recorded in `scripts/architecture/dependency-cycles.baseline.json`, and
a seventh fails the gate.

| Circle | Why it is there | What would remove it |
|---|---|---|
| `meetings ↔ tasks` | The handoff genuinely runs both ways: a meeting action becomes a task, and completing that task closes the action (PRD #40 §59, §60). Forbidding the import would forbid the feature. | Nothing, and it should not be removed. Tasks already imports the narrow `meeting.task-sync` rather than the meeting service (PRD #48 §156). |
| `finance ↔ sales` | Leaf helpers, not services: Finance's invoice list reads `sales.scope`, and Sales' approval formats money with `finance.money`. | Move the shared scope and money helpers into a neutral module. Worth doing; not urgent, because neither import can call the other domain's writes. |
| `engineering ↔ work-packages` | An RFI may be scoped to a work package, and a work package lists its engineering records. | A read contract on one side, in the shape of the record registry. |
| `contractors ↔ engineering` | Engineering records belong to a contractor's scope, and the contractor view shows them. | As above. |
| `contractors ↔ engineering ↔ work-packages` | The three-way consequence of the two above. | Removing either of them removes this. |
| `calendar ↔ contracts ↔ meetings ↔ tasks` | Calendar's non-registry modules reach for contract dates; the rest is the meetings/tasks pair above. | Route the contract dates through the calendar provider registry, like every other source. |

None of the six can produce a wrong number: an import cycle between modules in
one process is a maintainability cost, not a correctness one. What it costs is
the ability to reason about a domain on its own, which is why a new one has to
be argued for rather than merged.

## Rules

1. **A domain imports another domain's door, not its internals.** The door is
   an exported function that takes `(tx, context, …)`. See
   [data ownership](data-ownership.md) for the list.
2. **The foundation does not import a business domain** outside a declared
   registry.
3. **Type-only imports do not count.** A shape is not a call and cannot make a
   runtime circle; the gate ignores `import type`.
4. **A new circle fails CI.** If it is genuinely the right design — a handoff
   that runs both ways — extract the narrow interface the other side needs,
   then record it with `pnpm verify:ownership --update-baseline` and add a row
   to the table above saying why.
5. **When the door's owner already imports the caller, the door is passed in.**
   The organization imports Team's branch doors, and HR's person record is
   reached from Finance, Sales and Projects, so Team cannot import either back.
   Team declares the shape it needs (`PersonDoor` in the invitation service,
   `PlacementDoor` in `team.placement.ts`) and the server action or route that
   calls Team hands in HR's `ensurePersonForUser` and the organization's
   `placeMembership` (E-01, ADR 0002; E-13, ADR 0003). The call is required, so
   no caller can skip it. HR's employment changes take `placeMembership` the
   same way — the organization imports HR — and the organization's door calls
   HR's `followMembership` directly (E-03, ADR 0004).
