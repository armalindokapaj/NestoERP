# Project routing on mobile (MOB-05)

No `/mobile/projects` routes. Canonical routes only:

| Route | Notes |
|---|---|
| `/projects` | gallery; `?q=` search |
| `/projects/{id}` | Overview |
| `/projects/{id}/{planning,units,sales,tasks,calendar,…}` | tabs, real URLs, active tab from the path |
| `/projects/{id}/tasks?due=overdue` | target of "N tasks overdue" |
| `/projects/{id}/3d` | full-screen viewer, opens beside the ERP |

**Deep links** authenticate, then `loadProject` validates access; a project of another of the person's companies goes through `/projects/{id}/open?next=…`, which moves the session and returns to the exact page. Anything else is a 404 with no project information.

**Switch** — `lib/modules/projects/project.switch.ts` (unit-tested): same section if available, else Overview.

**Company context** — the project page always names its managing company (identity row, breadcrumb). A company-workspace switch that the project does not belong to is handled by the shell's MOB-02 fallback.
