# Audit

What audit is for, what it is not, and why it is a different system from the
activity timeline. PRD #28 §11, §25, §34, §45-§50, §134-§137, §189, §192-§194;
PRD #49 §68-§88, §296.

## Audit and activity are not the same thing

| | Audit | Activity |
|---|---|---|
| Answers | who did what to which record, when, from what value to what value, under which company and request | what has been happening on this record |
| Written | once, never updated or deleted | alongside the work, and editable with it |
| Read by | compliance, security, an investigation | whoever is looking at the record |
| Authority | evidence | a convenience |
| Retention | the retention policy's own schedule | the record's |

They are kept apart because merging them makes the timeline unusable (every
scan result, every derived recalculation) or the evidence untrustworthy (an
entry that can be edited is not evidence). Activity is never sufficient
evidence that something happened.

## The writer is insert-only

`lib/core/audit/audit.service.ts` exposes four writers — `recordAuditEvent`,
`recordUserAction`, `recordSystemAction`, `recordIntegrationAction` — and they
all insert. The module contains no update and no delete, and no
`auditEvent.update` or `auditEvent.delete` call exists anywhere in `lib/`,
`app/` or `scripts/`, so an application path that rewrites an audit row does
not exist to be called by mistake. The guarantee is structural rather than a
rule somebody has to remember.

Where a policy is `required`, the write happens **inside the caller's
transaction**, so a failed audit rolls the business mutation back: an action
that must be auditable is not allowed to happen unaudited. 92 of the 188
policies are required.

## The policy registry

Every audited action is declared once in `lib/core/audit/audit-policy.registry.ts`
with its module, category, severity, snapshot mode and the exact fields that may
be recorded. Anything not on `allowFields` is dropped before the row is written,
which is what keeps record content out of the audit trail — the trail says a
salary changed and by whom, not to what, unless the policy says that field is
safe to keep.

Action keys are constants because a renamed key breaks historical evidence:
rows written last year still carry the old string.

As it stands: 188 policies across 18 modules, 8 of them `CRITICAL` and 86
`IMPORTANT`; 44 record a full before/after, 132 record only the fields that
changed, and 12 record neither because the action has no payload worth keeping.

## Actor and context are server-derived

The actor on an audit row comes from the resolved `UserContext`, never from the
request body — `auditContextFromUser` reads the company, the user, the
membership and a snapshot of the display name and role as they were at the
time. Background work has its own actor: `recordSystemAction` names the job,
one company at a time, with the correlation id the run carries.

## Transitions

Every significant state transition creates an audit event (§66). The transition
itself and the audit write share the caller's transaction, so a record cannot
move without the row that says it moved.

The transition's `before` and `after` are the two states, which is what makes a
record's history reconstructable from the trail alone: the states in order,
each with an actor and a time, are how the current state is explained.

## What audit cannot do

Reading an audit row never grants access to the record it names. The audit
viewer is gated on its own permission and scoped to the reader's company, and
a row naming a record the reader cannot open shows what happened without
becoming a way to read the record through the back door.
