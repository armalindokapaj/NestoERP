# Mobile tasks (MOB-06)

One Task system on every device. `/tasks/my-tasks` is My Tasks (`assignee = me`), `/projects/:id/tasks` is Project Tasks; both open the same `/tasks/:id`.

- **Status changes** go through `mutateTask` with the version the page showed; nothing is optimistic.
- **Claim**: an unassigned, open task shows **Claim** to a member with `task.status.update` (`capabilities.canClaim`). It is one atomic command; the loser sees "This task was claimed by another user." and the refreshed page. API: `POST /api/tasks/:id/claim { expectedVersion }`.
- **Phone header** keeps one verb (Claim → Start → Complete as they apply) and puts the rest in the More menu.
- **Overdue** is derived (`isOverdue`), never stored. Due labels: Due today / Due tomorrow / Overdue N days.
- **My Day** (`/my-day`) lists overdue, due-today and next-7-days tasks with the same DTOs.
- Not built: Department queues and a "Not Ready" status (neither exists in NESTO), see the audit.
