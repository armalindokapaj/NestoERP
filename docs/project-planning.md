# Project Milestones & Planning (PRD #44)

A high-level planning layer above tasks: each project's phases, the key
milestones it is working towards, their baseline, planned, forecast and actual
dates, the dependencies between them, the blockers in their way, and the tasks,
meetings, daily logs and documents behind them. It is not a scheduling engine —
no critical-path calculation, no resource levelling, no cost loading, no
automatic rescheduling.

```
Phase       = planning structure        (ordered, dated, progressed by hand)
Milestone   = key achievement or date   (baseline ≠ planned ≠ forecast ≠ actual)
Dependency  = high-level sequencing     (finish-to-start with lag; warnings, never moves dates)
Blocker     = known issue in the way    (severity, owner, due date, resolved not deleted)
Task        = executable work           (linked, or created through TaskService; never completed from here)
Timeline    = visual understanding      (read-only; dates change in the drawer)
```

## Where things live

| Concern | Location |
| --- | --- |
| Types, date rules, dependency graph, templates | `lib/modules/project-planning/planning.{types,dates,graph,template-catalog}.ts` (client-safe) |
| Validation | `lib/modules/project-planning/planning.schema.ts` |
| Access | `lib/modules/project-planning/planning.permissions.ts` |
| Reading a plan: overview, timeline, list, milestone detail | `lib/modules/project-planning/planning.service.ts` |
| Phases | `lib/modules/project-planning/planning.phases.ts` |
| Milestones: create, edit, complete, reopen, baseline, lock, archive, order | `lib/modules/project-planning/planning.milestones.ts` |
| Dependencies | `lib/modules/project-planning/planning.dependencies.ts` |
| Blockers | `lib/modules/project-planning/planning.blockers.ts` |
| Tasks, meetings and daily logs, pickers | `lib/modules/project-planning/planning.links.ts` |
| Templates and copying a plan | `lib/modules/project-planning/planning.templates.ts` |
| Notifications, attention, reminders (job `planning.milestones`) | `lib/modules/project-planning/planning.attention.ts` |
| Reporting, dashboard widgets, project card | `lib/modules/project-planning/planning.reports.ts` |
| Calendar | `lib/modules/project-planning/planning.calendar-provider.ts` |
| Company rules | `lib/modules/project-planning/planning.settings.ts` |
| API | `app/api/projects/[projectId]/{planning,phases,milestones}/**`, `app/api/project-phases/**`, `app/api/project-milestones/**`, `app/api/project-milestone-blockers/**`, `app/api/project-planning/**` |
| UI | `app/(nesto)/projects/[projectId]/planning`, `app/(nesto)/projects/milestones`, `components/project-planning/*` |

## Data

- **ProjectPhase** — name, description, order, planned/forecast/actual start and
  end, status, manual progress, owner, `version`; archived, never deleted.
- **ProjectMilestone** — phase, type, status, owner, `baselineDate`,
  `plannedDate`, `forecastDate`, `actualDate` (business dates at midday UTC,
  read in the company zone), progress, `critical`, `externallyCommitted`, order,
  `statusChangedAt`, completion note and who completed it, `reopenedAt`,
  `version`; archived, never deleted.
- **ProjectMilestoneDependency** — `FINISH_TO_START` only, `lagDays ≥ 0`,
  unique per predecessor and successor, same project.
- **ProjectMilestoneBlocker** — title, description, severity, owner, due date,
  linked task, resolution (who, when, note).
- **ProjectMilestoneTaskLink** — a task and how it relates: supports, blocks,
  delivers, related.
- **Meetings and daily logs** — `IntegrationLink` rows (`integrationType
  MILESTONE_RECORD`, mode `REFERENCE`, source `project_milestone`), cancelled on
  unlink.
- **Documents** — normal documents with the milestone as their registry parent.
- **Project** — `planningBaselineLocked`, `planningTemplateKey`.
- **ProjectPlanningSettings** (company) — due-soon reminders (7 days), a reason
  for every baseline change (on), tell executives about critical committed
  milestones (off).

## Rules

| Rule | Code |
| --- | --- |
| Shown date: actual, else forecast, else planned, else baseline | `displayDateOf` |
| Variance: actual (once completed) or forecast/planned, minus baseline | `varianceDaysOf` |
| Delayed: target date passed and not completed or cancelled — derived whatever the status | `isDelayed` |
| New milestone: forecast defaults to planned, baseline to planned | — |
| A baseline typed at creation needs the baseline grant | `MILESTONE_BASELINE_FORBIDDEN` |
| An edit never completes or reopens | `MILESTONE_COMPLETE_REQUIRED`, `MILESTONE_REOPEN_REQUIRED` |
| Only a completed milestone has an actual date; corrections need the complete grant | `MILESTONE_ACTUAL_NOT_ALLOWED` |
| Completion sets the actual date (today unless given, never in the future); tasks untouched | `MILESTONE_ACTUAL_FUTURE` |
| Reopening needs its grant and a reason | `MILESTONE_NOT_COMPLETED`, schema |
| First baseline: the grant; a later change: also a reason (company rule); locked: the planning authority | `MILESTONE_BASELINE_REASON_REQUIRED`, `MILESTONE_BASELINE_LOCKED` |
| Owners and blocker owners are active members of the project | `PLANNING_MEMBER_INVALID` |
| A phase belongs to the milestone's project | `PLANNING_PHASE_INVALID` |
| Dependencies: not itself, not twice, no loops, same project and company (checked serializably) | `DEPENDENCY_SELF`, `DEPENDENCY_DUPLICATE`, `DEPENDENCY_CYCLE`, `DEPENDENCY_CROSS_PROJECT`, `DEPENDENCY_MILESTONE_INVALID` |
| Tasks, meetings and logs linked from the same project, openable by the writer | `MILESTONE_TASK_PROJECT_MISMATCH`, `MILESTONE_RECORD_PROJECT_MISMATCH`, `MILESTONE_RECORD_INVALID` |
| A phase with live milestones is not archived; a milestone with live successors is not archived | `PHASE_HAS_MILESTONES`, `MILESTONE_HAS_DEPENDENTS` |
| Every write names the version it read | `PLANNING_STALE` (409) |
| An archived project's plan is read-only | `PLANNING_PROJECT_ARCHIVED` |
| Templates and copies only fill an empty plan | `PLANNING_NOT_EMPTY` |

Dependencies add warnings — "Predecessor delayed 5 days", "Forecast is before
its predecessors allow" — and a suggested forecast the user may apply. The
drawer also lists at-risk signals (forecast past baseline, an open critical
blocker, a late predecessor) without changing the status.

## Access

Planning is part of the Projects module. A plan is reached only through its
project: module + `project.view` + `project_planning.view` + project scope.
Owning a milestone grants nothing.

| Role | Can |
| --- | --- |
| Owner | Everything, company-wide; company rules; move a locked baseline and unlock it (`project_planning.settings.manage`) |
| Project Manager | Keep the plan on their projects: phases, milestones, dates, baseline, dependencies, blockers, completion, reopening, templates, lock |
| CEO, Finance, Legal, Sales, Procurement, Inventory | Read, on the projects their project scope reaches |
| Architect, Engineer, QA/QC, HSE, Viewer | Read their projects' plans |
| Admin, Company IT, HR | None |

Linked tasks, meetings, daily logs and documents keep their own access: a
reader sees "A task you cannot open" or "A daily log you cannot open" rather
than a title.

## Workspace

`/projects/:id/planning` — header with planning progress, counts and the
baseline lock; **Overview** (KPIs, upcoming, delayed and at-risk, phases with
drag and arrow reordering), **Timeline** (phases, milestones, baseline markers
and variance, dependencies, today; week/month/quarter zoom; sticky structure;
windowed past 200 rows), **Milestones** (grouped by phase or sorted by date,
status, variance or owner — the timeline's accessible equivalent) and
**Dependencies**. Search, quick filters (Upcoming 30 Days, Delayed, At Risk,
Critical, Completed), and phase, status, owner and date filters. The milestone
drawer carries the quick update, dates and baseline, dependencies, tasks,
blockers, documents, meetings, daily logs, activity and discussion; every
action opens inline. `?milestone=` opens the drawer, `?view=` and `?filter=`
choose the view. On a phone: milestone cards with an action menu (update
status, update forecast, add blocker, create task, mark complete) and a bottom
sheet; the timeline waits for a wider screen. An empty plan offers Create
Phase, templates (Residential, Commercial, Fit-Out, Infrastructure) and copying
another project's plan.

`/projects/milestones` — reporting across the reader's projects: totals, by
status, portfolio (next milestone, critical delays), overdue, forecast
variance, critical milestones, by project and by phase; the company rules for
the planning authority. Each project overview has a **Planning** card.

## Notifications, attention and jobs

| Event | To |
| --- | --- |
| `MILESTONE_ASSIGNED` | The new owner |
| `MILESTONE_UPDATED` (forecast moved; at risk, delayed, on hold, cancelled; reopened) | Owner and project manager |
| `MILESTONE_DUE_SOON` (job, once per target date) | Owner; project manager too when critical |
| `MILESTONE_OVERDUE` (job, once per target date) | Owner and project manager; executives for critical committed milestones when the company asks |
| `MILESTONE_COMPLETED` | Owner and project manager |
| `MILESTONE_BLOCKER_ASSIGNED` / `_RESOLVED` | Blocker owner / owner, creator and milestone owner |
| `BASELINE_CHANGED` | Project manager and owner; executives for critical committed milestones when the company asks |

Category `project_planning`. The actor never hears about their own change.

| Attention | Who | Until |
| --- | --- | --- |
| `MILESTONE_OVERDUE` (episode: the target date) | Owner and project manager | Completed, cancelled or re-forecast |
| `MILESTONE_AT_RISK` (episode: the status change) | Owner and project manager | Status moves on |
| `CRITICAL_MILESTONE_BLOCKED` (episode: first open critical blocker) | Owner, project manager, blocker owners | Resolved |

Only active projects raise attention and reminders. Services resolve items the
moment a change ends them; the reconciler would too.

## Also connected

- **Calendar** — provider `milestones`, category `MILESTONE`: one all-day,
  non-draggable event on the shown date, opening the planning drawer.
- **Record registry** `project_milestone` — documents (upload needs
  `project_planning.milestone.edit`) and discussion; owner, creator and project
  manager follow it. Tasks raised from a milestone carry it as their parent.
- **Search** — milestone name, project, phase and type.
- **Dashboard** — `upcomingMilestones` (Project Manager, Architect, Engineer),
  `criticalMilestones` (Owner, CEO).
- **Reporting metrics** — `planning.milestone.delayed`, `.critical`,
  `.variance`, `.completed`.
- **Audit** — phase created/updated/archived; milestone created, updated,
  completed, reopened, archived, baseline changed (old and new date, reason);
  dependency added/removed; blocker created/resolved; baseline lock, template,
  copy and settings.

## Seed

Riverside Residences has six phases and eleven milestones: three achieved,
Structure Complete ten days past baseline with tasks, a coordination meeting
and a locked daily log, a scaffold inspection five days overdue, Roof Watertight
at risk behind a critical blocker, and committed handover dates — with ten
dependencies. Company B has one milestone.

## Tests

| Suite | Covers |
| --- | --- |
| `tests/unit/project-planning` | Role grants, baseline lock, date priority, variance, delay, suggestions, cycle detection, validation, templates |
| `tests/api/project-planning` | Phases, milestones, completion and reopening, tasks untouched, baseline and lock, dependencies, blockers and attention, task/meeting/daily-log links and their access, documents, roles, projects and companies, archived projects, templates and copying, calendar, reminders and notifications, attention resolution, reporting, search |
| `tests/e2e/modules/planning.spec.ts` | PM builds and runs a plan; calendar opens the drawer; outsider refused |
| `tests/e2e/responsive/planning-mobile.spec.ts` | Filter delayed, update forecast, add blocker on a phone |
| `tests/perf/planning.perf.test.ts` | 100 projects and a 500-milestone plan (`NESTO_PERF=1`) |
