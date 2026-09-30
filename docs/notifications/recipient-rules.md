# Recipient rules

Recipients are **candidates** from the event's own `recipients()` (assignee, mentioned members, approvers by permission, watchers, department heads, …). Nothing is decided in a frontend component.

## Filters, in order

1. The actor is removed (`memberId !== event.actorMemberId`) — nobody is told about their own action.
2. A discussion event (`discussion: true`) is dropped if the record type has no discussion, and requires the record's `collaboration.requires` permission.
3. The event's optional `permission` floor, evaluated against the candidate's current member context.
4. The record itself is read through the record registry **as that member** (`loadRecord`). If they cannot open it now, no notification is written. This covers Parent Group, Company, Project, module and record scope in one place.
5. Preferences: in-app (mandatory events are locked on), then push (below).

Role changes and removed project membership therefore take effect immediately: contexts are built from live memberships on every dispatch.

## Mentions and comments

`COMMENT_MENTIONED` (NORMAL) targets mentioned members. `COMMENT_ADDED` (LOW) targets watchers minus `excludeMemberIds`, which the comment writer fills with the mentioned and replied-to members, so one comment yields one meaningful notification per person. `COMMENT_ADDED` is LOW and never pushes. Mention pickers only list members the actor may reference in the record's context (comment surface, unchanged by MOB-10).

## Tasks, departments and claims

- `TASK_ASSIGNED` goes to the assignee only. There is no automatic broadcast to a department for unclaimed work.
- The repository has no Architecture claim queue or "Not Ready" status (see MOB-06 audit); return-to-architect notifications use the existing task status events.

## Reminders and cancellation

Reminder jobs (`calendar.reminders`, `approvals.overdue`, `timesheets.reminders`, `dailylogs.missing`, …) compute what is due from the current state of each record when they run, and claim each occurrence with a unique delivery row. A rescheduled meeting changes the start the next run sees; a cancelled or resolved record is no longer due; a removed participant fails the access check in step 4. There is no pre-stored reminder to cancel. Reminders are deterministic (one per occurrence), not repeated pushes.

## Push stage (in addition)

Per recipient and category: `decidePush` (`push.policy.ts`).

| Condition | Result |
|---|---|
| priority CRITICAL or mandatory event | push, urgent, regardless of category switch and project level |
| category push switch off | no push (in-app remains) |
| priority LOW | no push |
| project level MUTED, routine event | no push |
| project level IMPORTANT, routine event below HIGH | no push |
| direct event (assigned to you, mention, approval request, invitation, …) | not affected by project level |

Quiet hours delay non-urgent push to the end of the window in the person's own time zone; a critical alert goes immediately unless the person switched the override off.

## Bulk and storms

Fan-out is bounded by the outbox (one event → candidates resolved in one batch, `NOTIFICATION_BATCH_SIZE` events per tick, `PUSH_BATCH_SIZE` deliveries per tick), deduped by key, and LOW-priority bulk events never push. Critical alerts are never dropped by these limits.
