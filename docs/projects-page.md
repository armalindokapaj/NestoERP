# Projects page and multi-company access (E-05A, Projects Workspace Grid)

Built from the first E-05A PRD and brought in line with the final one
(`NESTO_V0.1_Enhancement_PRD_E05A_Projects_Page_and_Project_Discovery_FINAL`),
which renumbered its sections. Citations from the first pass — in this document
and in code comments — use the first PRD's numbers; everything added for the
final PRD cites the final one.

The **Projects Workspace Grid PRD**
(`NESTO_V0.1_Projects_Workspace_Grid_and_Simplified_Project_Discovery_PRD`,
cited as "Projects Workspace Grid §n") then simplified the page. Where it and
E-05A differ, it is the contract: the workspace is the organisational filter,
so the page no longer offers the company, role, type or location filters, the
status and favorites pills, the chips, the sort, Recommended, or the list view.

The Projects page is where a person finds every project they may open in the
active workspace, and opens one. The workspace has already chosen the
companies — every company of the group they can open projects in, in the Group
workspace, or the one company in a company workspace — so the page never asks
for a company again. Opening a project in the Group workspace moves the session
into the project's own company.

```
Person → workspace → Projects → authorised projects in that workspace
       → search / star → open → (Group workspace) session enters the project's company
       → project workspace
```

## Where things live

| Concern | Location |
| --- | --- |
| The person's memberships in the workspace, the list, opening | `lib/modules/projects/project.portfolio.ts` |
| Status machine | `lib/modules/projects/project.machine.ts` (registered in `lib/core/state/registry.ts`) |
| Create, edit, change status, cover choice | `lib/modules/projects/project.service.ts` |
| Query from a URL; retired parameters | `project.query.ts` (`parsePortfolioQuery`, `canonicalPortfolioHref`) |
| Project types: the defaults a company starts with | `config/project-types.ts` |
| Project types: the company's own list | `lib/modules/projects/project-type.service.ts`, page `app/(nesto)/projects/types` |
| Cover thumbnails | `lib/modules/documents/storage/thumbnail.service.ts` |
| Moving a session between memberships | `lib/auth/session-store.ts` (`moveSessionToMembership`) |
| Last activity | `lib/modules/shared/activity.ts` (`touchProjectActivity`) |
| API | `app/api/projects/route.ts`, `app/api/projects/[projectId]/{status,favorite,open,cover,archive}`, `app/api/projects/types`, `app/api/projects/types/[typeId]`, `app/api/projects/types/reorder` |
| UI | `app/(nesto)/projects/(portfolio)/page.tsx` and its `error.tsx`, `app/(nesto)/projects/[projectId]/open`, `app/(nesto)/projects/new`, `components/projects/portfolio/*` (grid shape in `gallery.ts`), `components/projects/change-project-status-dialog.tsx`, `components/projects/project-types-manager.tsx` |
| Route skeleton | `GalleryPageSkeleton` in `components/layout/page-skeletons.tsx` (same grid and card shape) |

## Authorisation: one person, several companies

NESTO resolves one company per request. The session row points at one
membership, and every scope builder starts from that membership's company. The
Projects page is the one place that looks past it, and it does so without a
second access model:

1. `resolveProjectPortfolio(session)` asks the workspace resolver
   (`resolveWorkspaceContexts`) for a `UserContext` per company the active
   workspace reads — every company of the group the person belongs to in the
   Group workspace, the one company in a company workspace — each built the way
   the session resolver builds one.
2. A membership joins the portfolio only where Projects is switched on, the role
   reaches the module and holds `project.view` — workspace access, module access
   and project access together (Projects Workspace Grid §13).
3. The list's `where` is the **union of each membership's own
   `buildProjectScopeWhere`**. Every branch carries its company, so a project is
   matched only through the membership in its company. The search and the
   cursor are applied on top, in the database (E-05A §42; Projects Workspace
   Grid §93-§95). Nothing is fetched and then hidden in the browser.
4. Whether a card offers the star is decided with *that* membership's company
   (favorites switched on there). No role names (E-05A §59).

Actions reached from the page (`favorite`, `cover`) and from a project (`status`, `archive`) find the
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

Change status is in the project page's own actions menu (it left the card menu
with the Projects Workspace Grid PRD, §56, §57). `return_to_pending` is the
correction E-05A §12 allows. Every move goes through
`applyTransition`, so the state the caller read is in the write, and records
`PROJECT_STATUS_CHANGED` in activity and audit with the previous and new status
and the reason. The edit form offers the status only to somebody with
`project.status.manage`, and never the correction (it has no reason field).

New projects start Pending, except those a platform admin creates, which start Active. Creating one in any other status needs
`project.status.manage`. Sales' won-deal conversion creates Pending.

### Default permissions (E-05A §60)

| Role | Create | Edit | Status | Archive |
| --- | --- | --- | --- | --- |
| Owner | yes | yes | yes | yes |
| CEO | yes | yes | yes | no |
| Project Manager | **no** | own projects | own projects | own projects |
| Architect, Engineer | no | assigned | no | no |
| Finance, Legal, Sales, others | no | no | no | no |

E-06 retired Admin. Its project setup went to the CEO, as `extra` overrides
on the CEO's View cell, and its technical authority to Group IT, which holds no
project authority (`docs/organization.md`). The Project Manager's loss of
`project.create` is a `deny`. A Project Manager therefore cannot turn a won
opportunity into a new project any more — they can still link one to an
existing project. The Owner is the Group Owner since E-06, a member of every
company of the group. An Architect who manages the company's Architecture
branch or heads Group Architecture (E-05D's Architecture Manager, a position
since E-06) edits projects across the company like an Architect on assigned
ones, and — as E-05A §8 and §58 set — creates projects or manages their status
only where a company grants it.

## Ordering and pagination

One order, with no control to change it (Projects Workspace Grid §33-§36):
**Active, then Pending, then Finished, each by name, then id.** Favorites and
recent activity order nothing. The status enum sorts Pending first in the
database, so the list is read as three keyset runs — Active, Pending,
Finished — each by `(name, id)`, and the cursor names the run and the last
row's name and id. A cursor from anywhere else (the old favorites-first order
included) is refused as stale. The three runs are read together, so a page
costs one round trip whichever runs it crosses.

The page renders the first 24 on the server; **Load more** asks
`GET /api/projects` with the search and the cursor. There is no numbered
pagination and no infinite scroll (§109-§113).

## Last activity

`Project.lastActivityAt` (not null, backfilled from the newest activity or
`updatedAt`) moves whenever `recordActivity` or `recordActorActivity` writes an
activity whose entity is the project or whose metadata names it — tasks,
documents, meetings, daily logs, status changes, edits, planning, anything that
already records activity. The Projects page no longer orders by it (Projects
Workspace Grid §33); it is kept for the rest of the product. It is written:

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
star on a card is the same favorite as the star on the project header. The page
reads the stars of the projects on it in one query, across the person's
memberships in companies with favorites switched on. A star changes nothing for
anyone else, grants nothing, and no longer moves a project up or filters the
page (Projects Workspace Grid §31, §32, §124); a starred project the person can
no longer open is simply not on the page (§126). Favorites are gathered in the
top bar's Search and in My Work.

## Search

One field, **Search projects…**, under the title (Projects Workspace Grid
§21-§25, §145): the projects already in the workspace, never the product — the
top bar's Search is that. It matches name, code, city and country, and the
company's name in the Group workspace. It does not match a project type: the
card does not show one. It is a clause added to the authorised set in the
database, so it can only narrow it.

Debounced 250 ms into `?q=` (replace, not push), so a search survives a refresh
and Back. The header keeps counting the workspace's projects; beside the field
the page says *N projects found*, or *No projects found.* when nothing matches.
The clear button and Escape empty it; Escape on an empty field leaves it.

**Retired parameters.** `status`, `favorites`, `company`/`companyId`,
`role`/`roleId`, `type`/`projectType`, `location`, `sort`, `view` and the old
`search`: the page redirects (replace) to `/projects` with only `q`, and the
API ignores them. No parameter can choose a company (§108, §183, §184).
`/projects/all` and `/projects/my-projects` redirect there, carrying the search
only.

## The header

*11 projects across 6 companies* in the Group workspace; *4 projects in
ARLIS - NDERTIM* where they are one company's, in either workspace (§16, §17).
Counted from the projects the person can see, so nothing hidden is hinted at,
and unmoved by a search (§15, §18, §19). No line while the page loads (a
skeleton bar, §103) or when there are no projects. There is no *New project*
button: **+ Create** in the top bar is where projects are started (§74, §75).

## The card and the grid

Cover (or initials over architectural line art, never a broken image), status
bottom-left on it, star and menu top-right, then the name, the company — always,
in either workspace — and the place when the project records one (§42-§62). The
name is a real link stretched over the card, so Cmd/Ctrl and middle click open
a new tab; the star and the menu are separate buttons after it in the tab order
(§166-§169). The menu: *Open project*, *Open in new tab*, *Add to / Remove from
favorites*, *Copy project link*. Edit, Change status and Archive are on the
project's own page (§56, §57). The DTO is `ProjectCardDTO` (§88, §89).

Grid: one card a row under 640 px, two to 1023, three to 1439, four from
1440 px, never more; the shell's 1600 px content width stops cards growing on
an ultra-wide screen (§39, §40, §157). Covers are portrait 3:4 from two columns
up and landscape 4:3 on a phone's single column (§41, §152). The star and the
menu are 44 px on a phone (§154). Hover lifts the card, tints its border and
eases the render in 200 ms, none of it under reduced motion (§158-§160).

## Switching the workspace on this page

`/projects` is a workspace collection, so the route resolver keeps it when the
new workspace can use Projects (§76-§81) and falls back to the Dashboard only
where it cannot. The in-place switch (OW, ADR 0015) keys the page by workspace
and covers the content region until the new tree has committed, so no card of
the old workspace shows under the new header (§82, §83). The search, if any,
is kept and re-run in the new workspace. Other tabs follow through the
workspace channel (§87).

## Project types

Each company keeps its own list (§30, §62) in `project_types`: a name, whether
it is in use, and its place in the order. A company starts with the eight
defaults in `config/project-types.ts` — the migration wrote them for every
company that existed, `bootstrapCompany` and `bootstrapCompanyConfiguration`
write them for a new one (only when it has none, so a rerun never brings back a
type an administrator removed). A project points at one by `projectTypeId`.

| Action | Who | Rule |
| --- | --- | --- |
| Read the list, with each type's project count | `project.type.manage` | the session's company |
| Add | `project.type.manage` | names unique per company, whatever their case |
| Rename, retire, use again | `project.type.manage` | audited `PROJECT_TYPE_UPDATED` with before and after |
| Reorder | `project.type.manage` | the request names every type once; anything else is refused |
| Delete | `project.type.manage` | only a type no project has; a used one is retired instead |

`project.type.manage` is on no module ladder — it is company configuration —
and the Owner and the CEO hold it as overrides (Admin until E-06). The section
tab **Project types** shows only to them.

- **A new project must have a type** (§13): the create schema requires
  `projectTypeId`, and the service accepts only a type of the chosen company
  that is in use — another company's type, a retired one, or an unknown id is a
  422 naming the field. Sales' won-deal conversion creates without one.
- **An edit keeps a retired type.** The form offers the types in use plus the
  project's own, marked *(retired)*, so saving other details never strips it.
  Older projects without a type may stay without one.
- **The page does not filter by type** any more (Projects Workspace Grid §138);
  the D-01 group dashboard still groups projects by type name across companies.

## Loading and failure

The route's skeleton and the page's own Suspense fallback both draw the grid's
columns and card shape (Projects Workspace Grid §101). If building the page
fails, the page's own error boundary — scoped by the `(portfolio)` route group
so a project's pages keep their own — says *Projects could not be loaded.* with
**Retry**, which asks the server again (§104). A failed **Load more** says the
same inline and turns the button into Retry. Every page of cards is timed into
the `project_discovery_query_ms` histogram (labels `scope` group/company,
`outcome`); a failure that is not a refusal also counts
`project_discovery_error_total` (§172).

## Covers

`Project.coverImageDocumentId` points at one document; nothing is copied. On the
edit page the cover is chosen from the project's own JPEG, PNG or WEBP documents
that the editor can open; the service re-checks that on save.

The card shows `GET /api/projects/:id/cover?v=…`, which needs the project through
the person's membership **and** the document through the documents module's
download gate in that company. The list includes a cover only for a reader who
passes that gate; anybody else sees the placeholder. The version is the
document's, so the same cover keeps the same URL between loads (§98). The
thumbnail is 600×800 WEBP, built with `sharp` on first request and kept at the
document's derived `thumb` key; promoting a new version clears it. It loads
lazily, with `sizes` matching the grid, and is decorative (`alt=""`): the name
is right under it (§46, §165). A cover the route cannot serve counts
`project_cover_load_error_total{reason}`, and the card falls back to the
placeholder (§105, §172). Thumbnail reads are not audited one by one.

## Tests

- `tests/api/projects/portfolio.test.ts` — cross-company visibility for the
  seeded `multi-architect` person in the Group workspace and one company in a
  company workspace; counts that include only what the person sees; search
  inside scope (name, code, place, company name only in the Group workspace,
  never the type); no request parameter choosing a company, filter or sort;
  Active → Pending → Finished by name with cursor walks across both
  boundaries; favorites ordering nothing; a starred project whose access was
  removed not shown; the card DTO's exact fields; initials; cover visibility,
  its stable URL and the thumbnail's shape; the discovery histogram; opening
  and the session move; status permissions and audit; create; the activity
  marker.
- `tests/unit/projects/portfolio-url.test.ts` — the parser, the canonical
  address for retired parameters, and the legacy redirects.
- `tests/e2e/modules/projects-workspace-grid.spec.ts` — no filter, sort, pill or
  view control; a retired bookmark rewritten; group and company headers;
  switching group → company → group on `/projects` without leaving it or
  showing the old cards; the order; search, its count, zero state, clear and
  Escape; the card's tab order and menu; 4/3/2 columns; an empty workspace.
  `projects.spec.ts` keeps the roles, create/edit/archive, covers, the star,
  status from the project page and the legacy links;
  `projects-multi-company.spec.ts` the cross-company opening;
  `responsive/mobile.spec.ts` one full-width card a row with 44 px controls.
- `tests/perf/projects-page.perf.test.ts` (opt-in, `NESTO_PERF=1`) — 600 visible
  projects across two companies in the Group workspace, in a table of 5,600:
  first page, a page ten cursors deep (in the Pending run) and a search each
  under 500 ms at P95 (57, 10 and 41 ms locally on 2026-09-24), and the same
  number of queries for 12 cards as for 60.

## Limits

- **Covers are chosen, not uploaded, on the edit page.** Upload the render to the
  project's documents first. The create form has no cover (E-05A §13 lists it as
  optional): a new upload waits on the malware scan before it can be read, so a
  cover chosen in the same step would show the placeholder anyway.
- **Project codes are typed.** There is no project numbering scheme yet.
- **Project types are per company, not per Parent Group.** NESTO has no Parent
  Group entity; two companies keep two lists.
- **Somebody granted `project.create` without a wide enough scope** — an
  Architect given it, say — sees the project they create only if they manage it
  or join its team. The create form offers them as manager.
- **Opening moves the whole session.** There is no per-tab company.
- **Archived projects are not on the page**; they are on **Archived**, in the
  session's company (Projects Workspace Grid §128).
- **No search threshold.** The search shows whenever the workspace has a project;
  §146-§147's "only above N projects" is left for later.
- **No product analytics events** (§170 is optional); the operational metrics are
  in *Loading and failure*.
- **Back restores the search** and the browser's scroll position on the first
  page; pages added with Load more are fetched again rather than kept.
