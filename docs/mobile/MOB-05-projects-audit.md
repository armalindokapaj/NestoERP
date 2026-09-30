# MOB-05 — Projects & Project Workspace audit

Audit of what Projects already were before MOB-05, so nothing already built is rebuilt.

## What already existed

| Area | Where | State before MOB-05 |
|---|---|---|
| Projects gallery | `app/(nesto)/projects/(portfolio)/page.tsx`, `components/projects/portfolio/*` | Card grid (one column on phone), server search (`q`), cursor "Load more", favorites, empty and no-result states, skeletons. Cover images are thumbnails with a fixed aspect ratio. |
| Discovery query | `lib/modules/projects/project.portfolio.ts` | One authorised set per membership; the workspace (Group / Company) is the organisational filter. `GET /api/projects` shares the same parser. |
| Project route | `/projects/[projectId]` and 20 tab routes | Canonical; no `/mobile` routes. Other-company projects enter through `/projects/[id]/open`. |
| Tabs | `project-tabs.tsx` → `ContextTabs` | Server-filtered by permission and module (`projectActions`); six primary tabs, the rest under More; sticky under the breadcrumb bar via `--nesto-shell-*` offsets. |
| Breadcrumb / Back | `components/ui/breadcrumbs.tsx` | Phone shows `‹ parent` and the current crumb; the current crumb carries the project switcher (same-company siblings). |
| Overview | `[projectId]/page.tsx` | Desktop hero (430 px), summary, My work, Upcoming, Recent activity (permission-gated), media, 3D tile only when a published viewer exists. |
| Project actions | `ProjectActions` | Edit, status, archive, media, team — each behind `projectActions(context)`. |
| Create with project | `/tasks/new`, `/documents/new`, `/meetings/new` read `?projectId=`; site diary is `/projects/[id]/daily-logs/new`. |
| 3D | `hasActiveProject3DViewer`, `getProject3DAvailability`, `(project-viewer)` route | Conditional; the editor is a separate Platform Admin surface. |
| Progress | `projectPlanningSummary` | Real plan progress; absent when the plan has none. |

## Gaps MOB-05 closed

1. Phone Overview was the desktop hero (≈430 px) before any operational content → compact phone Overview (quick actions, requires attention, metrics, 3D button); hero hidden on phone only.
2. Project identity on phone showed only the name in the breadcrumb → a compact identity row (name, managing company, status) above the pinned tabs.
3. Project switching always landed on the target's Overview → the section is preserved (`lib/modules/projects/project.switch.ts`).
4. Projects grid had no compact list → a Cards/List toggle.

## Deliberate decisions

- **Company filter not built** (owner decision): the Projects Grid PRD (df5e74b8) stands; the workspace is the company filter and search matches company names.
- **Project role on the card** is not shown: there is no canonical per-user project role on the card projection, and inventing one is barred by §13.
- **Recent projects** not built (§16): no existing tracking to reuse.
- **Project switcher search** not added: the switcher lists at most 100 same-company projects in the existing menu.
