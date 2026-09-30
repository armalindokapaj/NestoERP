# Mobile Project workspace (MOB-05)

The workspace is the existing `/projects/[projectId]` layout, not a second app.

Sticky stack on a phone: global header → breadcrumb bar (`‹ Projects` + current crumb, the project switcher) → **project identity row** (name, managing company, status; scrolls away) → **context tabs** (sticky, horizontally scrollable, More for the rest) → content. Offsets come from `--nesto-shell-*`; nothing is hard-coded.

## Phone Overview (`ProjectMobileOverview`, `sm:hidden`)

- **View Project in 3D** — only when a published viewer exists for this reader.
- **Quick actions** — Task, Document, Site diary, Meeting: links to the canonical create routes with `?projectId=` (site diary is the project's own route). Each appears only if the module tab is visible *and* the create permission is held; none on an archived project.
- **Requires attention** — overdue tasks (links to `/projects/{id}/tasks?due=overdue`) and pending approvals (links to `/approvals?projectId=`). From existing states; no new alert engine.
- **Project** metrics — plan progress (absent when the plan has none), units, open tasks; each tile only when the reader has the door to it.

Counters come from `projectMobileSummary` (three counts in one round, tasks under `buildTaskScopeWhere` — the same set the Tasks tab lists) plus the existing `projectMyWork`. The desktop hero is hidden on phones only (`max-sm:hidden`); the My work, Upcoming, Activity (permission-gated), summary and media sections below are unchanged and stay single-column.

## Switching project

The breadcrumb's current crumb opens the same-company project list. Choosing one keeps the section (`switchProjectHref`): Tasks → the other project's Tasks. A section the current tabs do not include, or one that belongs to one project alone (3D, edit, media), lands on Overview; a record page (a unit) lands on that section's list. Unsaved-changes protection is the shell's navigation guard.
