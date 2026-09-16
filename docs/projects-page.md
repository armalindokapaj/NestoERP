# Projects page and multi-company access (E-05A)

The Projects page is where a person finds every project they may open, in every
company they belong to, and opens one. It does not choose a company first: the
list crosses companies, and opening a project moves the session into the
project's own company.

```
Person → Projects → authorised projects across companies
       → search / filter / favorite → open → session moves to the project's company
       → project workspace
```

One continuous collection, not sections. Favorites first, then the most recently
active projects, then by name. Finished projects stay in it; archived ones leave
it (they are on **Archived**, in the session's company).

## Where things live

| Concern | Location |
| --- | --- |
| The person's memberships, the cross-company list, filters, opening | `lib/modules/projects/project.portfolio.ts` |
| Status machine | `lib/modules/projects/project.machine.ts` (registered in `lib/core/state/registry.ts`) |
| Create, edit, change status, cover choice | `lib/modules/projects/project.service.ts` |
| Query from a URL, both directions | `project.query.ts` (`parsePortfolioQuery`), `project.portfolio-url.ts` |
| Project types | `config/project-types.ts` |
| Gallery / list preference | `lib/modules/projects/project.view-preference.ts` (cookie `nesto.projects.view`) |
| Cover thumbnails | `lib/modules/documents/storage/thumbnail.service.ts` |
| Moving a session between memberships | `lib/auth/session-store.ts` (`moveSessionToMembership`) |
| Last activity | `lib/modules/shared/activity.ts` (`touchProjectActivity`) |
| API | `app/api/projects/route.ts`, `app/api/projects/filter-options`, `app/api/projects/[projectId]/{status,favorite,open,cover,archive}` |
| UI | `app/(nesto)/projects/page.tsx`, `app/(nesto)/projects/[projectId]/open`, `app/(nesto)/projects/new`, `components/projects/portfolio/*` |

## Authorisation: one person, several companies

NESTO resolves one company per request. The session row points at one
membership, and every scope builder starts from that membership's company. The
Projects page is the one place that looks past it, and it does so without a
second access model:

1. `resolveProjectPortfolio(session)` takes the person's other active
   memberships in active companies and builds each into a `UserContext` through
   `buildMemberContexts` — the same `assembleContext` the session resolver uses.
   The session's own context is used for its own company, so the development
   role switcher still applies there.
2. A membership joins the portfolio only where Projects is switched on, the role
   reaches the module and holds `project.view`.
3. The list's `where` is the **union of each membership's own
   `buildProjectScopeWhere`**. Every branch carries its company, so a project is
   matched only through the membership in its company. Search, filters, sort and
   the cursor are applied on top, in the database (E-05A §42).
4. Everything a card allows — edit, change status, archive, favorite — is decided
   with *that* membership's context: `can(context, …)` plus the project already
   being in that context's scope. No role names (E-05A §59).

Actions reached from the page (`status`, `favorite`, `archive`, `cover`) find the
project with `contextForProject(session, id)` and act with the membership in the
project's company. Create takes an optional `companyId`; `contextForCompany`
refuses a company the person does not belong to and one where they lack
`project.create` with the same 403.

`GET`/`PATCH /api/projects/:id`, restore and every project tab still work in the
session's company only. A deep link to another company's project goes through
opening.

## Opening a project in another company

```
card / deep link → /projects/:id[/tab]
  └ loadProject: not in the session's company, but in the portfolio
      → redirect /projects/:id/open?next=/projects/:id/tab
          └ page renders (no side effect) → browser POSTs /api/projects/:id/open
              → openPortfolioProject: re-finds the project through the portfolio
              → moveSessionToMembership: re-checks the membership, moves the row
              → AuthEvent COMPANY_CONTEXT_SWITCHED (+ audit AUTH_COMPANY_CONTEXT_SWITCHED
                in the company moved into)
          └ full page load of `next`
```

- **The move is a POST.** Rendering a page never moves a session, so a prefetch,
  a crawler or a link preview cannot. Cards for other companies' projects do not
  prefetch.
- **`next` is confined** to paths inside the project being opened.
- **It is the whole session.** Other tabs open in the old company are in the new
  one on their next request. A stale form from the old company fails closed —
  its record is not found in the new company — rather than writing anywhere.
- **Unauthorised is 404** at every step, naming nothing: no project name, company,
  cover, status or code (E-05A §49).
- The page path needs the requested URL; `middleware.ts` sets
  `x-nesto-request-path` on every page request, overwriting anything a client
  sent.

## Status

`PENDING` → `ACTIVE` → `FINISHED`, and `ARCHIVED` out of discovery. The enum was
renamed by migration `20260916210000_projects_page_e05a`: DRAFT → PENDING,
COMPLETED → FINISHED, and ON_HOLD → ACTIVE (a decision taken with the product
owner; E-05A has no paused state). `preArchiveStatus` was mapped the same way.
Activity and audit rows written before keep the words of the day.

| Action | From | To | Permission | Reason |
| --- | --- | --- | --- | --- |
| `activate` | Pending | Active | `project.status.manage` | — |
| `finish` | Pending, Active | Finished | `project.status.manage` | — |
| `reopen` | Finished | Active | `project.status.manage` | — |
| `return_to_pending` | Active, Finished | Pending | `project.status.manage` | required |
| `archive` | Pending, Active, Finished | Archived | `project.archive` | — |
| `restore` | Archived | the pre-archive status | `project.restore` | — |

`return_to_pending` is the correction E-05A §12 allows. Every move goes through
`applyTransition`, so the state the caller read is in the write, and records
`PROJECT_STATUS_CHANGED` in activity and audit with the previous and new status
and the reason. The edit form offers the status only to somebody with
`project.status.manage`, and never the correction (it has no reason field).

New projects start Pending. Creating one in any other status needs
`project.status.manage`. Sales' won-deal conversion creates Pending.

### Default permissions (E-05A §60)

| Role | Create | Edit | Status | Archive |
| --- | --- | --- | --- | --- |
| Owner | yes | yes | yes | yes |
| Admin | yes | yes | yes | no |
| Project Manager | **no** | own projects | own projects | own projects |
| Architect, Engineer | no | assigned | no | no |
| CEO, Finance, Legal, Sales, others | no | no | no | no |

Admin's grants are `extra` overrides on its View cell; the Project Manager's
loss of `project.create` is a `deny`. A Project Manager therefore cannot turn a
won opportunity into a new project any more — they can still link one to an
existing project. NESTO has no Parent Group Owner or Architecture Manager role;
E-05A's rows for them are policy for when those roles exist.

## Ordering and pagination

Recommended = favorites, then `lastActivityAt` desc, then name, then id. The
other sorts: recently active, name A–Z / Z–A, company A–Z, newest, oldest — each
ends on `id`, so the order is total.

Paging is keyset, not offset: the cursor is the last row's sort values. The
recommended order is paged as two runs — favorites, then the rest — and the
cursor says which run it is in, so "is starred" never has to be a column. A
cursor from a different sort is refused. The page renders the first 24 on the
server; **Load more** asks `GET /api/projects` with the same URL and the cursor.

## Last activity

`Project.lastActivityAt` (not null, backfilled from the newest activity or
`updatedAt`) moves whenever `recordActivity` or `recordActorActivity` writes an
activity whose entity is the project or whose metadata names it — tasks,
documents, meetings, daily logs, status changes, edits, planning, anything that
already records activity. It is written:

- by raw SQL, so `updatedAt` — the edit form's concurrency token — does not move
  when somebody adds a task;
- at most once a minute per project, so a burst of work locks the row once;
- with `FOR UPDATE SKIP LOCKED`, so it never waits for, or deadlocks with, a
  transaction already holding the project row.

The column is co-owned: Projects owns the row, the activity recorder owns this
column. Raw SQL is invisible to the ownership scanner, and the scanner refuses an
exception it never sees used, so the decision is written down in
`docs/data-ownership.md` instead of the registry.

## Favorites

The PRD #45 `UserFavorite` row with `entityType = project`, per membership. A
star on a card is the same favorite as the star on the project header. The list
reads favorites across all the person's memberships, in companies with favorites
switched on; one person's star changes nothing for anyone else and grants
nothing.

## Search and filters

Search (debounced 300 ms) matches name, code, company name, city, country and
project type label, inside the authorised set. Quick filters: All, Active,
Pending, Finished, Favorites. Filters: Company (shown when there is more than
one), My role (an effective project role label, or *All my assignments*),
Project type, Location (`country:` or `city:`). All combine with AND. Every
option is drawn from the authorised projects only (`portfolioFilterOptions`), so
a dropdown never names a company, role or place the person cannot see.

URL: `/projects?q=&status=&favorites=1&company=&role=&type=&location=&sort=`.
`/projects/all` and `/projects/my-projects` redirect there, carrying search and
status (and `role=@assigned` for My Projects). Clear Filters resets everything
but the gallery/list preference.

**My role** is the person's `ProjectMember.projectRole` on that project, or
*Project Manager* where they manage it — never the job title or the company
role (E-05A §52). An Owner on no project's team shows none.

## Covers

`Project.coverImageDocumentId` points at one document; nothing is copied. On the
edit page the cover is chosen from the project's own JPEG, PNG or WEBP documents
that the editor can open; the service re-checks that on save.

The card shows `GET /api/projects/:id/cover?v=…`, which needs the project through
the person's membership **and** the document through the documents module's
download gate in that company. The list includes a cover only for a reader who
passes that gate; anybody else sees the placeholder. The thumbnail is 600×800
WEBP, built with `sharp` on first request and kept at the document's derived
`thumb` key; promoting a new version clears it. Thumbnail reads are not audited
one by one.

## Tests

- `tests/api/projects/portfolio.test.ts` — cross-company visibility for the
  seeded `multicompany` person (Architect in A on Greenline Villas, Project
  Manager in B on Isarvorstadt Studio Refit), filter options that never leak a
  company, search inside scope, opening and the session move, E-05A §65's
  ordering with a cursor walk across the favorites boundary, every filter,
  per-person favorites, card permissions and roles, cover visibility and the
  thumbnail's shape, status permissions and audit, two simultaneous moves,
  create in a chosen company and its refusal, and the activity marker.
- `tests/e2e/modules/projects.spec.ts` — the gallery and its 3:4 covers, filters
  and URL state with Back, Clear Filters, list view remembered, favorites without
  navigating, change status, create; `tests/e2e/modules/projects-multi-company.spec.ts`
  — both companies on one page, opening a project in the other company, a deep
  link into its tab, and a refused project that names nothing;
  `tests/e2e/responsive/mobile.spec.ts` — two cards a row and the filter sheet.
- `tests/perf/projects-page.perf.test.ts` (opt-in, `NESTO_PERF=1`) — 600 visible
  projects in a table of 5,600: first page, a page ten cursors deep, a filtered
  page and the filter options each under 500 ms at P95 (about 15 ms locally),
  and the same number of queries for 12 cards as for 60.

## Limits

- **Covers are chosen, not uploaded, on the edit page.** Upload the render to the
  project's documents first. The create form has no cover.
- **Project codes are typed.** There is no project numbering scheme yet.
- **Project types are a code list**, not a company-editable taxonomy.
- **Opening moves the whole session.** There is no per-tab company.
- **The sidebar is the session company's.** Somebody whose session is in a
  company where they have no Projects access reaches the page by URL or by
  opening a project, not from the sidebar of that company.
- **Archived projects are not on the page**; there is no Archived filter yet.
- **Last activity is minute-accurate**, and can be one transaction late when the
  project row was locked.
