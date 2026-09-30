# MOB-06 — Daily work audit

Audit of Tasks, Approvals, Calendar, Meetings and Notifications before MOB-06 (2026-09-30), with what MOB-06 changed and what it left.

## Findings

| Area | What exists | Mobile state before | MOB-06 |
| --- | --- | --- | --- |
| Tasks | `Task` model (TODO / IN_PROGRESS / BLOCKED / COMPLETED / ARCHIVED, priority, due date, optimistic `version`), one state machine (`task.machine.ts`), one mutation path (`mutateTask`), scope in `buildTaskScopeWhere`, sections My Tasks / All / Overdue / Completed / Archived | Record cards from MOB-03, header keeps one verb + More menu (AUD-04) | added `claim`, `canClaim`, Claim verb |
| "My Tasks" | `assigneeMemberId = me` (`mine` query). There is no Department queue on a Task | fine | unchanged, My Day reuses it |
| Claim / Accept | **Did not exist.** No claim command, no Department assignment on `Task`, no Architecture queue | — | minimal claim added (below) |
| Not Ready | **Does not exist** (no such status or transition) | — | not built; see deviations |
| Comments | Collaboration threads/comments (PRD #38), shown by `CollaborationPanel` on the task page | works on phones | unchanged |
| Attachments | Task documents tab through the canonical document architecture | works | unchanged (MOB-07) |
| Approvals | Unified Approvals Center, provider registry (finance, procurement, hr, sales, legal, documents, qaqc, hse, timesheets, projects, unit_sales), decision service with versions and receipts, group variant | Full-screen review sheet with decision bar under the thumb, documents preview, list updates after a decision (`approvals-mobile.spec`) | fixed clipped search field on phones; My Day reads the same queue |
| Calendar | Provider registry aggregator (`getCalendar`), views month/week/day/agenda, phone uses agenda | Agenda first on phones (PRD #39) | My Day reads it through the same aggregator |
| Meetings | Full module with agenda, participants, minutes, decisions, actions, calendar provider | responsive (`meetings-mobile.spec`) | unchanged, events open their canonical href |
| Notifications | `Notification` with read state, attention items re-read in the reader's context, deep link route `/notifications/[id]` | bell + centre | unchanged; access is already re-validated on open (PRD #38 §82, #47 §77) |
| Dashboards | widgets/KPIs, "Needs attention" | no single "what needs me" view | My Day |

## What MOB-06 built

- **My Day** (`/my-day`, `GET /api/my-day`): `lib/modules/productivity/my-day.service.ts`. One authorised aggregate over Tasks (overdue / due today / next 7 days, mine), Approvals (waiting queue + counts) and Calendar (my events today and tomorrow). Each section is read through the owning service's own scope; sections fail independently (`status: ok | unavailable | error`) and a failed section is never drawn as empty. Attention order is fixed: overdue tasks, tasks due today, approvals, next event. The Group workspace aggregates tasks and approvals across companies (rows carry their company); events are company-only and say so.
- **Claim**: `claim` command in `mutateTask` (`task.mutation.ts`), `POST /api/tasks/:id/claim`, `claimTask`, `capabilities.canClaim`, Claim button on the task page. Atomic under the existing row lock: the first claimant becomes the assignee; a later claimant, whatever version they name, gets `409 "This task was claimed by another user."`; claiming a task that is already yours is unchanged. Permission: `task.status.update`. Records a `TASK_CLAIMED` activity and subscribes the claimant.
- **Approvals**: search field no longer shrinks to "Searcl" on a phone.
- **My Tasks views** Today / Upcoming / All (the canonical `due` filter), **quick Complete** on My Day rows (the canonical complete command, server-confirmed, then refresh), **notification centre** New above Earlier.
- Dashboard shows an "Open My Day" entry; `/my-day` is a workspace-neutral route.

## Deviations (to decide)

1. **No Architecture claim workflow to preserve.** The PRD says to preserve "Sales creates Task → Architecture Department → unclaimed → Architect claims". The repo has no such workflow and no Department queue on `Task`. MOB-06 adds only the generic claim of an *unassigned* task by a member who may update task status. Department-queue eligibility, Department Manager visibility for unclaimed Department tasks and Sales↔Architecture hand-offs need a product decision and a data-model change (a department on the task), so they are not built.
2. **No "Not Ready" status.** The task machine has no such state; MOB-06 does not invent a mobile-only one (§25).
3. **Already responsive, not rebuilt:** the Approvals review, Agenda-first Calendar and Meetings. Still open: a dedicated phone Day/Month calendar treatment, a tablet split view, and notification quick actions beyond Open / mark read.
4. **Real-time updates** are not added: NESTO has no push channel for these records; pages refresh on navigation and after every command.

## Tests

`tests/e2e/responsive/aud04-mob06-daily-work.spec.ts`, run at 320 / 360 / 390 / 768 / 1280: claim race (one 200, one 409 with the message, version +1, idempotent repeat), Claim button, My Day overdue row and counters, quick Complete, My Tasks views, My Day for eleven roles with no failed section, identity switch leaks nothing, axe on My Day and the notification centre (found and fixed an invalid `<dl>`), New/Earlier grouping.

Regression: `collaboration/tasks`, `task-reliability`, `approvals` and `approvals-mobile` pass. Two `aud04-tasks` specs fail for reasons outside MOB-06 (a duplicate-toast strict-mode match and a streamed 200 where 404 is expected). The Claim button was first in the phone header and pushed Start into More, which broke five task specs; it is now a separate button and those pass.
