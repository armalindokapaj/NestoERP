# UI-02 — Design system and interaction: gap analysis

Written 2026-10-12 against the repository on branch `ui-ux-test` (head d2d83591 plus the uncommitted foundation stage).
This is the WP-00 exit artifact of PRD UI-02 §32, with its two companions:

- `docs/ui/UI-02-route-register.json` — one entry per page route.
- `docs/ui/UI-02-tickets.json` — the implementation tickets.

Status words follow PRD §32 WP-00: **existing / partial / missing / conflicting / not-applicable**.
Nothing was run in a browser or against a server in this stage, and no source file was changed. Every status
comes from the repository's own records and its source. "Existing" means the behaviour is implemented and a
named test or document covers it; a run under version 2 is still owed, and WP-06 collects those.

## How this was built

1. The route list comes from the file system: every `app/**/page.tsx`, 553 files.
2. A scan read each page and the module components it imports, up to three imports deep, stopping at the shared
   layer (`components/ui`, `data`, `forms`, `detail`, `modules`, `unsaved`, `charts`) and skipping shell plumbing.
   It recorded the shared components reached, the nearest `loading.tsx` and `error.tsx`, how an empty result is
   shown, the phone presentation, and what is drawn by hand.
3. Template, ruler policy and version-2 status were judged from a decision table written after reading the pages:
   every module landing, every route whose path does not say what it is, and a sample of each family. The
   553 pages were not each read line by line; a route's `v2Reason` states the rule that applied to it, so a
   wrong call can be found and corrected.
4. Hand-drawn signals are counted by pattern. A class string that also carries a `ds2:` class is not counted,
   because its version-2 answer is written beside it. A signal on a shared module file is attributed to every
   route that imports the file, whether or not that route renders the offending part.

The scripts are scratch files outside the repository. Ticket WP02-06 checks them in.

## What was found

| Measure | Count |
| --- | --- |
| Page routes | 553 |
| In the company and group workspace shell (`components/layout/app-shell.tsx`) | 467 |
| In the Platform Admin shell | 54 |
| In the Group shell | 8 |
| Public site, sign-in and recovery, viewers, editor, offline, bare system pages | 24 |
| Migrated to version 2 | 3 |
| Restyled by tokens alone, probably fine | 390 |
| Need work | 150 |
| Not applicable (redirect only) | 10 |
| Ruler-eligible | 109 |
| Ruler wired | 3 |
| Implementation tickets | 77 |

By surface:

| Surface | Routes | Migrated | Token-only | Needs work | Not applicable |
| --- | --- | --- | --- | --- | --- |
| company | 397 | 0 | 293 | 97 | 7 |
| platform | 56 | 1 | 39 | 16 | 0 |
| project | 49 | 0 | 22 | 27 | 0 |
| personal | 19 | 1 | 10 | 5 | 3 |
| system | 13 | 1 | 12 | 0 | 0 |
| public | 11 | 0 | 10 | 1 | 0 |
| group | 8 | 0 | 4 | 4 | 0 |
| portal | 0 | — | — | — | not applicable: the repository has no external portal |

By template (PRD §26.3):

| Template | Routes | Migrated | Token-only | Needs work | Not applicable | Ruler-eligible |
| --- | --- | --- | --- | --- | --- | --- |
| record | 147 | 0 | 110 | 37 | 0 | 69 |
| directory | 130 | 0 | 94 | 36 | 0 | 0 |
| form | 114 | 0 | 110 | 4 | 0 | 0 |
| settings | 53 | 1 | 45 | 7 | 0 | 0 |
| system | 42 | 1 | 31 | 0 | 10 | 1 |
| overview | 27 | 1 | 0 | 26 | 0 | 27 |
| report | 14 | 0 | 0 | 14 | 0 | 12 |
| review | 12 | 0 | 0 | 12 | 0 | 0 |
| explorer | 6 | 0 | 0 | 6 | 0 | 0 |
| viewer | 3 | 0 | 0 | 3 | 0 | 0 |
| calendar | 2 | 0 | 0 | 2 | 0 | 0 |
| admin-canvas | 1 | 0 | 0 | 1 | 0 | 0 |
| timeline | 1 | 0 | 0 | 1 | 0 | 0 |
| board | 1 | 0 | 0 | 1 | 0 | 0 |

States and phone presentation:

| Measure | Count |
| --- | --- |
| Routes with no `loading.tsx` above them | 30 (the 8 `/group` routes, the public site and sign-in pages, the three viewers, the offline and bare system pages, the catalog) |
| Routes with no `error.tsx` above them | 0 (`app/error.tsx` is the last resort; `/group` and the public pages have only that one) |
| Routes where the scan found no empty state | 221, of which 81 forms and 39 settings pages that have nothing to be empty; 11 directories and 50 record pages are the ones to look at |
| Phone: a presentation of its own (DataTable record cards or a mobile component) | 130 |
| Phone: stacked table | 32 |
| Phone: responsive layout only | 391 |

What is drawn by hand, counted in files and in the routes that reach them:

| Signal | Files | Routes | Can tokens answer it? |
| --- | --- | --- | --- |
| Raw `<table>` | 32 | 53 | No: row height, sticky header and phone stack never reach it |
| Raw text field, select or textarea | 32 | 27 | No: control border and density height never reach it |
| Literal pixel or rem text size | 37 | 47 | No |
| Movement on hover | 7 | 9 | No (§9.2 forbids it) |
| Shadow on an ordinary card | 6 | 7 | No |
| Literal radius | 9 | 9 | No |
| Raw hex colour | 4 | 4 | No (all four are 3D files) |
| Raw `<button>` | 98 | 79 | In part: colours yes, pressed state and heights no |
| Literal 36px or 40px control | 93 | 88 | In part: compact density is answered by a rule in `tokens-v2.css`, comfortable is not |
| Own card (border, surface, radius, padding on a div) | 165 | 204 | In part: colours and radius yes, padding no |
| `.nesto-card` class instead of `Card` | 316 | 324 | In part: the class is restyled; its padding is the caller's |
| Gold fill (`bg-accent`) | 51 | 53 | In part: with `text-accent-fg` it becomes the primary; alone it stays gold |
| Serif face | 19 | 14 | Yes inside a signed-in shell; kept on the public site and sign-in by design |
| `rounded-full` | 104 | 119 | Not judged: avatars, dots and progress tracks are legitimate (§6.3) |
| Uppercase label | 55 | 40 | Not judged: short section labels are allowed (§6.2) |

## (a) Acceptance cases UI02-01 to UI02-80

Counts: **14 existing, 59 partial, 4 missing, 3 conflicting, 0 not-applicable.**

No case is wholly not applicable: each applies to at least one surface that exists. The clauses that do not apply
are named where they occur and collected here: the external portal (none exists), German (not a supported
language), a document folder tree and drag-and-drop move (documents are a flat directory), a task board (tasks are
lists; the sales pipeline is the only board), report generation jobs (every report renders synchronously), mail
and file views of an integration (none present), Billing and Group Settings (no such destinations).

| ID | Scenario | Status | Evidence | Closed by |
| --- | --- | --- | --- | --- |
| UI02-01 | Route coverage | **partial** | `docs/ui/UI-02-route-register.json` classifies all 553 pages with template, states and migration result. No owner is recorded per route: the repository has domain ownership (`docs/data-ownership.md`) but no page owner. Migration result today: 3 migrated. | WP02-06, WP06-03 |
| UI02-02 | Platform Admin parity | **partial** | Dashboard restyled and ruler wired (`app/admin/page.tsx`, `app/admin/_dashboard/sections.tsx`). Of 56 platform routes, 16 need work; the surface has its own status badge (`components/platform/admin-status-badge.tsx`, 23 importers) and hand-drawn filters. | WP02-05, WP02-08, WP03-15, WP04-11, WP05-19, WP05-21 |
| UI02-03 | Universal controls | **partial** | UI-01: Search, Notifications, Account on all three shells for desktop and tablet (`tests/e2e/shell/universal-header.spec.ts`). The phone company shell keeps the bell in the bottom bar and Account in More (`docs/ui/UI-01-universal-header-gap-analysis.md`, gap 1). | WP02-01, WP02-08, OV-07 |
| UI02-04 | Sticky layers | **partial** | `--nesto-sticky-stack` sums header, breadcrumb and tab rows (`styles/globals.css:239`); `StickyStack` measures a page's own layers (`components/ui/sticky.tsx`); the ruler starts below the stack. The banner height is a constant, the version-2 heights are not applied, and no test asserts that nothing is covered. | WP02-01, WP02-03 |
| UI02-05 | Sidebar collapse | **partial** | Collapse state in a cookie read on the server (`lib/layout/sidebar-state.ts`), rail tooltips and accessible names (`docs/a11y/surface-inventory.md`, Shell rows), `tests/e2e/shell/organization-header.spec.ts`. Version-2 widths (208/64px) are not applied. | WP02-01, WP02-02 |
| UI02-06 | Navigation history | **conflicting** | Filters, sort and page live in the URL, so Back restores them (`lib/tables/list-url.ts`, `tests/e2e/modules/record-navigation.spec.ts`). Scroll is the conflict: `components/navigation/scroll-to-top.tsx` switches browser restoration off and returns every page to its top, by design. | WP02-04, WP06-03 |
| UI02-07 | Dirty navigation | **existing** | AUD-03: `docs/unsaved-work.md`, ADR 0018, `lib/unsaved/coordinator.ts`, `tests/e2e/modules/unsaved-work.spec.ts`, `tests/unit/unsaved/*`. Stay, Discard and Save and continue, with a failed save staying on the form. | WP06-03 |
| UI02-08 | Group/company scope | **partial** | Admin Console PRDs #7-#14: `docs/audits/AUD-ADMIN-01.md`, `tests/e2e/modules/admin-journey.spec.ts`, `group-company-access.spec.ts`, `group-user-detail.spec.ts`. The `/group` routes have no error or loading boundary of their own. | WP05-18, WP05-19, WP05-21 |
| UI02-09 | Standalone contexts | **existing** | Standalone companies, group-only people and unassigned projects: `tests/api/platform/standalone-company.test.ts`, `group-workspace.test.ts`, `organizations.test.ts`; `docs/organization.md`. Owed: a look at each under version 2. | WP04-05, WP05-06, WP05-21 |
| UI02-10 | Theme coverage | **partial** | Both schemes are `light-dark()` tokens in `styles/tokens.css` and `styles/tokens-v2.css`; the first paint is server-rendered; portals inherit the scheme (`docs/a11y/surface-inventory.md`, Theme rows). Version 2 covers the primitives listed in part (b); the rest of the product is restyled by tokens only. | WP02-07, WP06-08 |
| UI02-11 | Theme persistence | **conflicting** | The preference is the cookie `nesto.theme` (`lib/layout/theme-state.ts`): it survives a reload and other tabs, but it belongs to the browser, so another person signing in on it inherits it. The pass condition needs a per-user record (part (d)). | PREFS-01, PREFS-02 |
| UI02-12 | System mode | **existing** | System renders no `data-theme` attribute and the OS decides through `light-dark()`; a pinned choice overrides it both ways (`lib/layout/theme-state.ts`, `docs/a11y/surface-inventory.md` Theme row, `tests/e2e/shell/universal-header.spec.ts` theme radio). | PREFS-02 |
| UI02-13 | Density | **partial** | Comfortable, compact and touch are tokens (`styles/tokens-v2.css`), chosen by the cookie `nesto.density` (`lib/layout/design-state.ts`, `tests/unit/ui/design-state.test.ts`). Per browser, not per user. 93 files write a 36px or 40px control as a literal class and 32 draw a raw field. | WP03-02, WP03-09, PREFS-01, WP06-05 |
| UI02-14 | Token contrast | **partial** | `tests/unit/a11y/contrast.test.ts` measures every pair of `lib/a11y/contrast-pairs.ts` against version 2 in both schemes. Not measured: disabled styles (`opacity-50`), alpha blends, chart series, focus surroundings (PRD §6.5). | WP03-09, WP04-08, WP06-01, WP06-02 |
| UI02-15 | Typography | **partial** | The §6.2 scale is in tokens; headers break long names (AUD-04). 37 files set a literal pixel or rem size with no version-2 answer. 200% text scaling has not been tried. | WP02-05, WP06-04, WP06-09 |
| UI02-16 | Ruler eligibility | **partial** | The conditions of §8.1 are implemented (`lib/ui/ruler-math.ts`, `components/ui/scroll-ruler.tsx`). 3 of 109 eligible routes are wired. | WP02-06, WP04-02, WP04-04, WP04-07, WP04-10 |
| UI02-17 | Ruler disabled preference | **partial** | Cookie `nesto.ruler`, `<html data-ruler="off">`, the control in `components/settings/display-preferences.tsx`, and the On this page links (`PageSectionLinks`, `components/ui/page-sections.tsx`). Per browser, not per user. | PREFS-01 |
| UI02-18 | Ruler progress math | **existing** | `lib/ui/ruler-math.ts` with `tests/unit/ui/ruler-math.test.ts`. | WP06-03 |
| UI02-19 | Ruler active section | **partial** | Implemented in `lib/ui/ruler-math.ts` and unit-tested there. In the browser it is verified only by a scratch harness of 105 assertions that is not in the repository. | WP06-03 |
| UI02-20 | Ruler click/drag | **partial** | Implemented in `components/ui/scroll-ruler.tsx` (pointer capture, cancel, Escape). Same scratch harness; no checked-in spec. | WP06-03 |
| UI02-21 | Ruler keyboard | **partial** | Implemented (scrollbar role, arrows, Page keys, Home, End). Same scratch harness; no checked-in spec; no screen-reader pass (§8.5). | WP06-03 |
| UI02-22 | Section jumps | **partial** | Implemented (sticky-aware offset, hash by history replacement, heading focus). Same scratch harness; no checked-in spec. | WP06-03 |
| UI02-23 | Ruler dynamic extent | **partial** | ResizeObserver and section registration are implemented; the frame cost (§8.7) has not been measured. | WP06-06 |
| UI02-24 | Ruler permissions | **partial** | A section registers only when its element renders (`components/ui/page-sections.tsx`), so a section the reader may not see is never in the registry. Revocation during a session is not tested. | WP06-03 |
| UI02-25 | Ruler collisions | **partial** | Clustering near the bottom is implemented in the ruler math. No page with more than eight sections exists yet to exercise the list. | WP06-03 |
| UI02-26 | Ruler viewer/table exclusion | **existing** | The ruler mounts only where a page declares sections, and it yields to a blocking dialog (`components/ui/scroll-ruler.tsx:63-64`). The register marks 444 routes `never`, every grid, timeline, board, viewer and editor among them. | WP05-20 |
| UI02-27 | Ruler mobile/zoom | **partial** | Below 1280px the same links render as On this page (`PageSectionLinks`). Not tried at 400% zoom. | WP06-04, WP06-05 |
| UI02-28 | Hover stability | **partial** | Button, Card and Table do not move under the pointer in version 2. 7 files still translate or scale on hover (9 routes), the project card and the project overview among them. | WP02-02, WP04-06 |
| UI02-29 | Focus equivalence | **partial** | AUD-11 made hover-only actions visible on focus where it found them (`docs/a11y/surface-inventory.md`). No version-2 sweep. | WP03-03, WP06-04 |
| UI02-30 | Tooltip/preview | **partial** | `IconButton` opens its tooltip at 400ms; the app shell's provider uses 200ms (`components/layout/app-shell.tsx:89`). No entity preview exists. | OV-03, OV-09 |
| UI02-31 | Motion reduction | **existing** | Global reduced-motion rule and static skeletons in `styles/globals.css`; `tests/e2e/a11y/aud11-shared.spec.ts`, `tests/unit/a11y/theme-drift.test.ts`. Owed: a run under version 2. | WP06-04 |
| UI02-32 | Button loading | **partial** | `Button loading` keeps width and focus and refuses a second activation (`components/ui/button.tsx`, catalog entry). Forms still disable their submit button while a save runs. | WP03-08 |
| UI02-33 | Disabled/read-only | **partial** | A control the person may not use is not rendered at all (`components/modules/module-page.tsx`, PRD #7 §13). Read-only exists in `FormSelect` and `RelationSelector` only; disabled is `opacity-50` on the whole control, with no reason attached. | OV-06, WP04-10, WP05-10 |
| UI02-34 | Card semantics | **partial** | `Card` and `CardLink` carry the navigable and selected rules (catalog entry). Only the catalog imports `CardLink`; 324 routes reach the `.nesto-card` class directly. | WP04-06, WP05-06, WP05-10, WP05-15 |
| UI02-35 | Card media | **partial** | The project cover reserves its geometry (`components/projects/portfolio/project-cover.tsx`). No document card exists; broken-image fallbacks are not audited. | WP04-02, WP04-06, WP05-06 |
| UI02-36 | Metric definitions | **partial** | Two registries: `lib/core/reporting/metric.registry.ts` (value type, aggregation, currency behaviour, period field) and `config/kpis.ts` (permission, workspace). Neither records freshness or the drilldown, and module KPI grids do not all read them. | WP04-01, WP04-03 |
| UI02-37 | Honest bars | **partial** | `ProgressBar` and `MiniBars` are real values with text alternatives (AUD-11). Bars drawn as divs inside pages were not audited one by one. | WP04-01, WP04-03 |
| UI02-38 | Currency/null handling | **partial** | AUD-01 settled it for Finance (`docs/finance-registers.md`, `tests/e2e/modules/finance-accuracy.spec.ts`, `lib/core/reporting/report-currency.service.ts`). Other modules' figures were not audited. | WP04-01, WP05-07, WP05-08, WP05-11 |
| UI02-39 | Role dashboard | **partial** | Widgets and KPIs come from a role registry (`config/dashboards.ts`, `config/widgets.ts`, `tests/unit/dashboard/dashboard-resolver.test.ts`). The §17 structure is not built on any overview. | WP04-02, WP04-03, WP04-04, WP04-05, WP04-11 |
| UI02-40 | Table sorting/paging | **partial** | AUD-08: allowlisted server sort with `withTieBreaker`, paging and filters in the URL, one row per list in `docs/tables/list-manifest.md`, `tests/e2e/tables/aud08-*.spec.ts`. The manifest names nested lists with no id tie-breaker. | WP03-01, WP03-02, WP03-15 |
| UI02-41 | Table controls | **partial** | Show and hide columns with per-person persistence (`components/data/table-columns.tsx`, `lib/tables/preferences.ts`, `tests/unit/tables/preferences.test.ts`). Resize and pin do not exist. | WP03-04, PREFS-03 |
| UI02-42 | Table selection | **partial** | Selection is a phone mode only, page-scoped and cleared by any query change (`components/data/selection.tsx`, `lib/data/selection.ts`). No all-matching token. | WP03-03, WP03-06 |
| UI02-43 | Bulk mutation | **missing** | No shared preview or per-item outcome. The nearest thing is the check step of the project-structure bulk dialogs (`components/project-structure/bulk-dialogs.tsx`). | WP03-06 |
| UI02-44 | Inline editing | **missing** | No inline-edit pattern. The conflict review it would need exists for tasks (AUD-02, `docs/task-mutations.md`). | WP03-13, WP03-14 |
| UI02-45 | Saved views | **missing** | Only a type: `SavedViewShape` and `toSavedView` in `lib/data/query-state.ts`. No storage, API or selector. | WP03-05, PREFS-03 |
| UI02-46 | Totals/export | **partial** | One authorised exporter with formula guarding and refusal past its limits (`lib/core/export/exporter.ts`, `lib/utils/csv.ts`, `tests/e2e/tables/aud08-exports.spec.ts`). No export job or status; no page or all-filtered label on totals. | WP03-07, WP05-07 |
| UI02-47 | Form labels/units | **partial** | AUD-09: `docs/forms/form-manifest.md`, `components/forms/form-contract.tsx`, `lib/forms/decimal.ts`, `tests/e2e/forms/aud09-*.spec.ts`. `UnitInput` has no importer; the second form kit (`components/engineering/form-kit.tsx`) has its own field markup. | WP03-08, WP03-09, WP03-10, WP03-15, WP05-11, WP05-12, WP05-13, WP05-16 |
| UI02-48 | Validation | **partial** | Summary, links to fields and first-invalid focus for every `RecordForm` (125 importers; `tests/e2e/forms/aud09-shared.spec.ts`). The 31 files on the other form kit show one message line instead. | WP03-08 |
| UI02-49 | Save/submit distinction | **existing** | AUD-03 save kinds: a workflow-only editor offers Stay and Discard and never sends (`docs/unsaved-work.md`, `tests/architecture/form-save-kind.test.ts`, `docs/state-machines.md`). | WP03-10, WP05-07, WP05-14 |
| UI02-50 | Unknown mutation outcome | **partial** | The client distinguishes not saved from unknown and never retries a create by itself (`lib/unsaved/outcome.ts`). An idempotency key exists only for uploads, approval decisions and jobs. | WP03-13 |
| UI02-51 | Dependent fields | **partial** | `RelationSelector` handles scoped search and its states; one form uses it. Most pickers are preloaded selects with no dependency handling. | WP03-12 |
| UI02-52 | Date/time | **partial** | Date-only helpers and the company-day rule (`lib/forms/dates.ts`, `tests/architecture/date-number-format.test.ts`). Controls are native date inputs; a time zone is not shown beside timed events. | WP03-11, WP05-04 |
| UI02-53 | Overlay stack | **partial** | One shell panel at a time (`lib/navigation/panel-host.ts`, `tests/unit/navigation/panel-host.test.ts`); Radix focus trap; safe initial focus (`lib/a11y/overlay-focus.ts`). Sizes and timings are version 1's. | OV-01, OV-02 |
| UI02-54 | Dirty drawer/dialog | **existing** | `components/unsaved/guarded-root.tsx`: backdrop, Escape and Cancel all ask; a dialog is locked while its request runs (`tests/e2e/modules/unsaved-work.spec.ts`). | OV-01 |
| UI02-55 | Destructive confirmation | **partial** | `ConfirmDialog` (74 importers) with the safer control focused first. Copy was not audited for object and consequence; no typed confirmation exists. | OV-04, WP05-02, WP05-08, WP05-09 |
| UI02-56 | Async states | **partial** | AUD-05: empty, no-results and first-use are distinct (`components/ui/empty-state.tsx`, `listEmptyKind`), with error variants for network, permission and not found (`components/ui/error-state.tsx`), `tests/e2e/ux/aud05-states.spec.ts`. The platform and group shells show no connectivity state. | WP02-07, OV-06 |
| UI02-57 | Toast/undo | **partial** | Polite or assertive by tone, pause on hover and focus (Radix). Five seconds, not six; no cap of three. Undo exists only for removed draft lines. | OV-05 |
| UI02-58 | Search/notifications | **partial** | The UI-01 specs exist (`tests/e2e/shell/universal-header.spec.ts`, `top-bar.spec.ts`, `lazy-panels.spec.ts`). None has run under version 2. | OV-07, WP05-17, WP06-03 |
| UI02-59 | Approval race | **partial** | Decisions carry an idempotency key (`components/approvals/approvals-api.ts`); `tests/e2e/modules/approvals.spec.ts`. A stale-version refusal was not confirmed in this audit. | WP05-02, WP06-03 |
| UI02-60 | Task claim race | **existing** | AUD-02: `app/api/tasks/[taskId]/claim/route.ts`, `Task.version`, `docs/task-mutations.md`, `tests/e2e/modules/task-reliability.spec.ts`. | WP05-03, WP06-03 |
| UI02-61 | Comments/mentions | **partial** | `components/collaboration/collaboration-panel.tsx` with mentions; `tests/api/collaboration/collaboration-service.test.ts`, `tests/e2e/collaboration/workflows.spec.ts`. A duplicate-safe retry was not confirmed. | WP05-03, WP05-17 |
| UI02-62 | Upload lifecycle | **existing** | Per-file queue with progress, failure and retry and idempotent upload intents (`components/documents/upload-queue.tsx`, `upload-client.ts`, `docs/document-lifecycle.md`, `tests/e2e/forms/aud09-uploads.spec.ts`). | WP05-01 |
| UI02-63 | Revision identity | **existing** | `components/documents/document-versions.tsx`, `docs/document-lifecycle.md`, `docs/document-reference-model.md`, `tests/e2e/modules/documents.spec.ts`. | WP05-01, WP05-09, WP05-16 |
| UI02-64 | Document permissions | **partial** | `docs/security/document-export-policy.md`, `tests/security/private-fields.test.ts`. Preview, download and edit as three separate capabilities, and the provider's save state, were not confirmed in this audit. | WP05-01, WP05-10 |
| UI02-65 | Calendar/board dragging | **partial** | The calendar's drag has the event form as its alternative (`docs/a11y/surface-inventory.md`, Calendar rows). The sales pipeline board has no Move to action recorded. | WP05-04, WP05-05, WP05-15 |
| UI02-66 | Planning/timesheet | **existing** | Domain locks and periods are server rules: `docs/project-planning.md`, `docs/timesheets.md`, `tests/e2e/modules/planning.spec.ts`, `timesheets.spec.ts`. | WP05-05, WP05-14 |
| UI02-67 | Chart accessibility | **partial** | The five chart components expose their values without hover (AUD-11). Title, unit, period and scope are not part of their contract. | WP04-07, WP04-08 |
| UI02-68 | Print/report | **missing** | No global print rule. Two print routes exist; one carries its own `@media print` block, the other none. | WP04-07, WP04-09 |
| UI02-69 | Role editor | **partial** | `/organization/access` shows position, source and effective access per module; the delegation ceiling is server-side (`tests/e2e/modules/organization-access.spec.ts`). `/settings/roles` is a read-only list. | WP05-18, WP05-19 |
| UI02-70 | Integration states | **partial** | `/settings/integrations`, `/admin/system/integrations`, `lib/core/integrations`. The six states of §22.4 are not a shared vocabulary. | WP05-18, WP05-19 |
| UI02-71 | 3D separation | **existing** | `tests/architecture/project-3d-boundaries.test.ts`, `tests/e2e/modules/project-3d.spec.ts`, `tests/security/platform-boundary.test.ts`. | WP05-20 |
| UI02-72 | Mobile reachability | **partial** | 35 responsive specs cover version 1 (MOB-01..11, AUD-04; `docs/mobile/coverage-manifest.md`). None has run under version 2, whose table text is wider. | WP02-09, WP05-12, WP05-13, WP05-14, WP06-05 |
| UI02-73 | Assistive technology | **partial** | Axe and keyboard specs (`tests/e2e/a11y/aud11-*.spec.ts`), forced-colours rules. The manual screen-reader gates were never run. | WP06-04 |
| UI02-74 | Security rendering | **partial** | `tests/unit/announcements/announcement-rules.test.ts`, `tests/unit/storage/file-rules.test.ts`, `tests/api/collaboration/collaboration-service.test.ts`. No test under version 2's components. | WP06-03 |
| UI02-75 | Permission revocation | **partial** | Every read authorises on the server (`tests/security/*`, `pnpm verify:authorization`, which already reports about 58 older findings). Stale client state after a revocation is tested for devices, sessions and organisation grants only. | WP06-03 |
| UI02-76 | Session/demo identity | **conflicting** | Eight-hour policy and full identity replacement by sign-out and sign-in (`docs/session-security.md`, `tests/architecture/no-role-override.test.ts`). This branch also carries a one-click quick-login panel on `/login`, which §28 forbids in production. | OV-08, PREFS-02, WP06-07 |
| UI02-77 | Safe prefetch | **existing** | NAV-03: `lib/navigation/intent-prefetch.ts`, `tests/unit/navigation/intent-prefetch.test.ts`, `docs/navigation/NAV-03-release-evidence.md` §5. | WP06-03 |
| UI02-78 | Performance | **partial** | A benchmark harness and a client-bundle gate exist (`tests/e2e/perf/*`, `scripts/check-client-bundle.ts`). Nothing of version 2 has been measured. | WP06-06 |
| UI02-79 | Migration/rollback | **partial** | The flag `NESTO_DESIGN_SYSTEM` and its production guard (`scripts/verify-production-guards.ts`). The version-1 comparison tool is outside the repository; no rollback has been rehearsed. | WP06-07 |
| UI02-80 | Professional completion | **partial** | Known honest absences are recorded (no Billing, no Group Settings, no support route: `docs/ui/UI-01-universal-header-gap-analysis.md`). Controls were not audited one by one. | WP06-01, WP06-07 |

## (b) Component and state register

The names are the PRD's (§26.1, lines 826-828). "Importers" is the number of files in `app/` and `components/`
that import the file. "States found" lists the states of PRD §9 (line 315) that a scan found in the component's
source by class or attribute; none was exercised. "Version 2" says whether the component has its own version-2
answer (`ds2:` classes or a rule in `tokens-v2.css`) or is restyled by tokens alone. The focus ring is one global
`:focus-visible` rule (`styles/globals.css:333`), so every focusable element has it whether or not its component
names the state; it is listed below only where a component adds a ring of its own.

### Primitives

| PRD name | Where | Importers | Version 2 | States found | Absent | In the catalog | Duplicates |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Tokens | `styles/tokens.css`, `styles/tokens-v2.css`, `config/theme.ts` | — | yes | not applicable | — | no | none; `tests/unit/a11y/theme-drift.test.ts` keeps config and CSS in step |
| Typography | the `--nesto-text-*` scale and `text-page` … `text-micro` utilities (`styles/globals.css`) | — | yes | not applicable | — | no | 37 files set a literal size; 19 files ask for the serif face |
| Button | `components/ui/button.tsx` | 421 | yes (`ds2:`) | hover, pressed, disabled, loading | selected, expanded, read-only, success, empty, permission: not applicable to a button | yes | 98 files draw a raw `<button>` |
| Link | `components/navigation/nav-link.tsx` (guarded navigation, prefetch); no `ui/link` | 398 | no | none of its own: the caller styles it | hover underline, focus ring and the external-link label of §10.2 are not in the component | no | `next/link` is used directly beside it |
| IconButton | `components/ui/icon-button.tsx` | 5 | yes | hover (through Button), pressed as a toggle, tooltip at 400ms | loading (left out of its props), disabled reason | yes | `Button size="icon"` is used directly in most places |
| Badge | `components/ui/badge.tsx`; status mapping in `components/modules/status-badge.tsx` | 192 / 68 | token-only | tones (neutral, info, success, warning, danger) | not interactive: the other states do not apply | yes | about twenty module badges wrap it (`AdminStatusBadge`, `BudgetRiskBadge`, `MilestoneStatusBadge`, `TimesheetStatusBadge`, `PublicationBadge`, `StockLevelBadge`, …) |
| Tag | `components/ui/tag.tsx` | 2 | yes | hover, pressed (remove) | selected | yes | `components/data/filter-chips.tsx`, `components/workspace/company-tag.tsx` |
| Field | `Field` and `FormSection` in `components/forms/form-contract.tsx`; `ui/label`, `ui/input`, `ui/textarea`, `ui/form-select`, `ui/select` | 146 (Input) | Input, Textarea, Select trigger: yes; Field, Label, FormSelect: token-only | focus-visible ring of their own, disabled, error; read-only on FormSelect | success, loading, permission-unavailable | yes (inputs, selects, search) | `FormFields` in `components/engineering/form-kit.tsx`; two selects (`Select` Radix, `FormSelect` native); `SearchField` beside `search/search-page-field.tsx` |
| Checkbox | `components/ui/checkbox.tsx` | 33 | token-only | checked, disabled | indeterminate, error, focus ring of its own | yes | none |
| Radio | `components/ui/radio.tsx` (native) | 1 | token-only | disabled | error | yes | hand-built radiogroups in `settings/theme-preference.tsx` and `settings/display-preferences.tsx` |
| Switch | `components/ui/switch.tsx` | 15 | token-only | checked, disabled | pending and error recovery (§13.2) | yes | none |
| Tooltip | `components/ui/tooltip.tsx` | 11 | token-only | expanded | the 400/100ms timing is in `IconButton` only | through IconButton | none |
| Popover | `components/ui/popover.tsx` | 5 | radius by rule in `tokens-v2.css` | expanded | collision and bounded height are Radix defaults, not checked | no | `components/ui/glass-panel.tsx` (shell panels) |
| Menu | `components/ui/dropdown-menu.tsx` | 41 | radius by rule | focus-visible, expanded, disabled, danger item | selected item | no | `components/data/record-action-sheet.tsx`, `components/detail/entity-action-sheet.tsx` (phone) |
| Dialog | `components/ui/dialog.tsx`, guarded by `components/unsaved/guarded-root.tsx`; `ui/confirm-dialog.tsx` | 74 / 74 | token-only | expanded, locked while saving | loading, error inside the dialog are the caller's | no | `FormDialog` and `ReasonDialog` in `engineering/form-kit.tsx`; `finance/reject-dialog.tsx` |
| Drawer | `components/ui/drawer.tsx`; `ui/bottom-sheet.tsx` on phones | 15 / 3 | token-only | expanded | the 480-640px width of §14.2 | no | none |
| Skeleton | `components/ui/skeleton.tsx`, `ui/loading-state.tsx`, `layout/page-skeletons.tsx`, `modules/section-skeletons.tsx` | 18 / 83 / 46 | token-only | loading, reduced motion, forced colours | — | inside the table entry | four files and `app/admin/_dashboard/list-skeleton.tsx` |
| Alert | no `Alert` primitive. `InlineError` and `SectionError` in `components/ui/error-state.tsx`; `SaveMessages` in `components/unsaved/editor-status.tsx` | 6 / 36 | token-only | error | info, warning and success banners | no | ad hoc banners (`hse` stop-work banner, `platform/password-change-notice.tsx`) |
| Toast | `components/ui/toast.tsx` | 183 | token-only | tones, pause on hover and focus | six seconds, cap of three | no | none |

### Patterns

| PRD name | Where | Importers | Version 2 | States found | Absent | In the catalog | Duplicates |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DataTable | `components/data/data-table.tsx` on `components/ui/table.tsx` | 50 / 64 | Table: yes; DataTable: token-only | hover, focus-visible, selected row, sorted column, loading and empty (catalog), phone record cards | inline edit, pinned and resized columns, totals row | Table only | 32 files draw a raw `<table>` |
| FilterBar | `components/data/list-toolbar.tsx`, `filter-chips.tsx`, `filter-sheet.tsx`, `sort-header.tsx`, `pagination.tsx` | 47 / 79 | token-only | hover, focus-visible, selected, empty | an Apply step for complex builders | no | `platform/organization-filters.tsx`, `finance/register-filters.tsx`, `hr/date-range-filter.tsx`, `approvals/approval-filters.tsx`, `engineering/project-filter.tsx`, `project-planning/report-filter-form.tsx`, and GET forms written in pages |
| SavedViewSelector | missing (type only: `lib/data/query-state.ts`) | — | — | — | everything | no | — |
| MetricStrip | `components/ui/metric-strip.tsx` | 1 | built for version 2 | hover and focus on a drilldown cell, loading, error, no access | — | yes | `dashboard/kpi-card.tsx`, six `*-kpis.tsx`, `MetricGrid` in `engineering/engineering-ui.tsx`, 43 files with a local figure function |
| ProjectCard | `components/projects/portfolio/project-card.tsx` (not on `Card`) | its own folder only | no | hover, focus-visible, loading | selected, archived, denied, broken image | a specimen built on Card | `project-compact-row.tsx` |
| DocumentCard | missing: documents are tables everywhere | — | — | — | everything | no | — |
| RecordHeader | `components/modules/record-header.tsx` (`RecordHeader`, `RecordContextHeader`) | 129 | token-only | none of its own | updated time and record version (§18.1) | no | `ui/page-header.tsx`, the h1 block in `modules/module-page.tsx`, `modules/settings-page-header.tsx`, `UnitShell` |
| ActionBar | `StickyActions` in `components/ui/sticky.tsx`; `SelectionBar` in `components/data/selection.tsx`; `headerActionsClass` in `ui/page-header.tsx` | 2 | token-only | pressed, disabled, loading (selection bar) | one component for page, form-footer and selection actions | no | form footers are written per form |
| EntityPicker | `components/forms/relation-selector.tsx` | 1 | token-only | all but pressed and success | — | no | `meetings/people-picker.tsx`, `modules/assign-member-control.tsx`, preloaded `FormSelect` lists |
| FileUploader | `components/documents/document-uploader.tsx`, `upload-queue.tsx`, `field/evidence-capture.tsx` | 6 / 11 | token-only | selected, loading, error, success, permission | drag-and-drop was not confirmed | no | `forms/upload-field.tsx` (0 importers), `hr/employee-file-upload.ts`, `platform/logo-upload.tsx` |
| ActivityList | `components/activity/activity-view.tsx` | 1 | token-only | hover, selected, expanded, loading, error, empty | — | no | `hse/record-activity.tsx`, `qaqc/record-activity.tsx`, `inventory/record-activity.tsx`, `sales/sales-activity.tsx`, `contracts/contract-activity.tsx`, and history lists written in pages |
| EmptyState | `components/ui/empty-state.tsx` (`EmptyState`, `NoResultsState`) | 165 | token-only | empty, no-results, first use | — | inside the table entry | one-line empties written inline in 82 routes; `EmptyNote` in `engineering-ui.tsx` |
| StatusTimeline | missing as a shared pattern | — | — | — | everything | no | four `approval-history.tsx` (finance, procurement, sales, contracts) and `hr/employment-timeline.tsx` |
| OnThisPage / Ruler | `components/ui/scroll-ruler.tsx`, `ui/page-sections.tsx`, `layout/page-sections.tsx`, `lib/ui/ruler-math.ts` | 4 | built for version 2 | hover, focus-visible, pressed (drag), selected section, expanded panel, section unavailable | — | yes | `engineering/section-nav.tsx`, the public site's own section navigation |

### Duplicates: two or more components doing one job

| Job | Components | Count |
| --- | --- | --- |
| Form kit | `components/forms/record-form.tsx` with `form-contract.tsx` (125 importers) and `components/engineering/form-kit.tsx` (31 importers, 22 of them outside Engineering and Contractors: workforce, platform, people, organization, HR, HSE) | 2 |
| Page heading block | `ui/page-header.tsx` (50), `modules/module-page.tsx` (142), `modules/record-header.tsx` (129), `modules/settings-page-header.tsx` (17) | 4 |
| Figure or KPI | `ui/metric-strip.tsx`, `dashboard/kpi-card.tsx`, `contracts/contract-kpis.tsx`, `hse/hse-kpis.tsx`, `inventory/inventory-kpis.tsx`, `procurement/procurement-kpis.tsx`, `qaqc/qaqc-kpis.tsx`, `sales/sales-kpis.tsx`, `MetricGrid` in `engineering/engineering-ui.tsx`, plus 43 files with a local `Stat`, `Figure`, `Metric`, `Panel`, `Row` or `AttentionPanel` function | 9 + 43 |
| Attention panel | an `AttentionPanel` function in each of `app/(nesto)/{sales,contracts,qaqc,procurement,inventory,hr}/page.tsx`; `components/notifications/attention-list.tsx` | 7 |
| Approval queue | `components/approvals/approvals-shell.tsx` and an `approval-queue.tsx` in finance, hse, qaqc, contracts, procurement | 6 |
| Record documents | `components/documents/record-documents.tsx` (22) and a `record-documents.tsx` in sales, contracts, qaqc, hse, inventory, hr, finance | 8 |
| Record activity | `components/activity/activity-view.tsx` and `hse/record-activity.tsx`, `qaqc/record-activity.tsx`, `inventory/record-activity.tsx`, `sales/sales-activity.tsx`, `contracts/contract-activity.tsx` | 6 |
| Export link | `lib/core/export/export-control.tsx` and an `export-link.tsx` in contracts, hse, qaqc, inventory, hr, sales, plus `settings/audit-export-link.tsx` and `finance/register-export-button.tsx` | 9 |
| Line-item editor | `finance/line-items-field.tsx`, `finance/line-rows.tsx`, `procurement/line-items.tsx`, `inventory/stock-lines.tsx` | 4 |
| Approval history | `approval-history.tsx` in finance, procurement, sales, contracts | 4 |
| Skeleton | `ui/skeleton.tsx`, `ui/loading-state.tsx`, `layout/page-skeletons.tsx`, `modules/section-skeletons.tsx`, `app/admin/_dashboard/list-skeleton.tsx` | 5 |
| Select | `ui/select.tsx` (Radix, 4 importers) and `ui/form-select.tsx` (native, 154); kept apart on purpose | 2 |
| Tabs | `ui/tabs.tsx` (0 importers), `modules/module-tabs.tsx`, `navigation/context-tabs.tsx`, and six hand-built `role="tablist"` (calendar shell, activity view, activity panel, meeting workspace, approvals shell, offline project view) | 9 |
| Phone test hook | `components/layout/use-phone.ts`, `components/ui/use-breakpoint.ts`, `components/calendar/use-is-phone.ts` | 3 |
| Search field | `ui/search-field.tsx`, `search/search-page-field.tsx`, `layout/global-search.tsx`, `platform/platform-search.tsx` | 4 (two are the universal search, by surface) |
| Date-only helper | `components/finance/local-date.ts`, `components/hr/local-day.ts`, `lib/forms/dates.ts` | 3 |

Shared files that nothing imports: `components/charts/bar-chart.tsx`, `components/charts/sparkline.tsx`, `components/data/list-refresh.tsx`, `components/forms/form-steps.tsx`, `components/forms/unit-input.tsx`, `components/forms/upload-field.tsx`, `components/layout/user-menu.tsx`, `components/ui/icon.tsx`, `components/ui/responsive-grid.tsx`, `components/ui/stack.tsx`, `components/ui/tabs.tsx`, `components/ui/technical-viewport.tsx`. `ui/tabs.tsx`, `forms/form-steps.tsx`,
`forms/unit-input.tsx` and `forms/upload-field.tsx` are the PRD's own patterns, built and never adopted;
`layout/user-menu.tsx` is the header menu UI-01 replaced.

### What the catalog covers

`app/dev/ui` (development only) has entries for Button, IconButton, Card, MetricStrip, Badge, Tag, Table, Input,
Textarea, Select, Search, Checkbox, Radio, Switch and the ruler, with switches for scheme, density and version.
It has no entry for Dialog, Drawer, Menu, Popover, Tooltip, Toast, the state components, DataTable, the filter
bar, the form kit or charts; tickets OV-01, OV-06,
WP03-01, WP03-08 and WP04-08 add them. It documents states by specimen; it does not document props, roles or
keyboard behaviour per entry as §26.2 asks.

## (c) What the repository already implements, by PRD section

Later stages extend these; none needs rebuilding.

| PRD section | Already there | Where | Left to do |
| --- | --- | --- | --- |
| §5 Route coverage | An inventory of the authenticated pages (460 when it was last generated) with guard and loading boundary; navigation and state inventory per module and role | `docs/navigation/NAV-01-route-inventory.md` (generated by `scripts/navigation/route-inventory.ts`), `docs/ux/navigation-inventory.md`, `docs/perf/route-manifest.md` | Owner, permissions and tests per route are in those documents, not in the register: join them when the script is checked in (WP02-06) |
| §6 Tokens, type, density | Version-1 tokens; version-2 overrides scoped to `:root[data-ds="2"]`; density and touch; contrast test over both | `styles/tokens.css`, `styles/tokens-v2.css`, `lib/layout/design-state.ts`, `tests/unit/a11y/contrast.test.ts`, `docs/a11y/contrast.md` | Shell geometry tokens; the leftovers in the signal table |
| §7 Shell and navigation | Three shells with the universal header; sticky breadcrumb bar and context tabs with More; workspace switch; skip link; route-change focus; immediate navigation feedback | `components/layout/*`, `components/navigation/*`, ADR 0012-0015, `docs/shell-fast-reentry-quick-create-activity.md`, UI-01 analysis | Version-2 geometry; the platform and group shells lack the skip link, the announcer and boundaries; scroll restore |
| §7.4 Dirty forms | The whole contract: prompt, history guard, guarded dialogs, save outcomes, stale-tab refusal | `docs/unsaved-work.md`, `docs/unsaved-work-manifest.md`, ADR 0018 | Nothing but its look under version 2 |
| §7.5 Sign-in and system pages | Username and password sign-in, recovery, invitation, maintenance, device and workspace unavailable, in-shell 403 and 404 | `app/(public)/*`, `docs/authentication-local.md`, `docs/session-security.md` | §7.5's state list checked page by page |
| §8 Ruler | Complete in code: math, rail, drag, keyboard, sections, On this page, preference | `lib/ui/ruler-math.ts`, `components/ui/scroll-ruler.tsx`, `components/ui/page-sections.tsx`, `components/layout/page-sections.tsx` | Wire 106 more routes; a checked-in browser spec; screen-reader pass; frame cost |
| §9-§10 States, buttons, badges | Button, IconButton, Badge, Tag with version-2 states; status mapping in one place | `components/ui/*`, `components/modules/status-badge.tsx` | Adoption: see the duplicates table |
| §11 Cards and metrics | Card, CardLink, MetricStrip; a metric registry and a KPI registry | `components/ui/card.tsx`, `metric-strip.tsx`, `lib/core/reporting/metric.registry.ts`, `config/kpis.ts` | No product page uses MetricStrip or CardLink yet |
| §12 Tables | Server sort, filter and paging in the URL with tie-breakers; column show and hide with per-person storage; filter chips and phone filter sheet; phone record cards and selection mode; one CSV exporter with limits and formula guarding; a manifest of every list | `components/data/*`, `lib/tables/*`, `lib/data/*`, `lib/core/export/*`, `docs/tables/list-manifest.md`, `docs/mobile/responsive-data-view.md` | Resize, pin, desktop selection, all-matching, inline edit, saved views, export jobs |
| §13 Forms | Field contract with error summary and focus; decimal and date normalisation; line editors; upload queue; steps component | `components/forms/*`, `lib/forms/*`, `docs/forms/form-manifest.md`, `docs/mobile/mobile-forms.md` | One field anatomy across both kits; one line editor; date controls |
| §12.5, §13.3 Versions and conflicts | Task version, mutation and conflict review; 29 models with a version column; unknown-outcome handling on the client | `docs/task-mutations.md`, ADR 0017, `lib/unsaved/outcome.ts` | A common envelope and idempotency beyond uploads, approvals and jobs |
| §14 Overlays | Dialog, Drawer, BottomSheet, Menu, Popover, Tooltip, ConfirmDialog; guarded closing; safe initial focus; one shell panel at a time | `components/ui/*`, `components/unsaved/guarded-root.tsx`, `lib/navigation/panel-host.ts`, `lib/a11y/overlay-focus.ts` | Version-2 sizes and timings; confirmation copy |
| §15 Search, notifications, account | Universal search with results page, activity centre, notification preferences and quiet hours, account panel, What's New, Help | `components/layout/global-search.tsx`, `activity-bell.tsx`, `components/shell/*`, `docs/notifications`, UI-01 analysis | Panel sizes; entity preview; a notification inbox for people who are not company members (UI-01 gap) |
| §16 States and feedback | Empty, no-results, error variants, skeletons per page kind, live announcer, toasts by tone, connectivity status in the app shell | `components/ui/empty-state.tsx`, `error-state.tsx`, `components/layout/page-skeletons.tsx`, `live-announcer.tsx`, `components/offline/*` | Toast timing and cap; session-expiry warning |
| §17 Dashboards | Role registry for widgets; group and company dashboards on one route; project overview; platform dashboard; My Day and My Work | `config/dashboards.ts`, `config/widgets.ts`, `components/dashboard/*`, `components/productivity/*` | The §17 structure on all of them |
| §18 Record, review, claim, comments | Record header, collaboration panel with mentions, Approvals Center with providers and delegation, task claim with a single winner | `components/modules/record-header.tsx`, `components/collaboration/*`, `docs/approvals.md`, `docs/task-mutations.md` | One queue pattern; sections for the ruler |
| §19 Documents | Document lifecycle, versions, upload sessions, PDF and image viewers, field capture, provider integration | `docs/document-lifecycle.md`, `docs/document-reference-model.md`, `docs/document-provider-integration.md`, `components/documents/*` | Grid view and card; viewer chrome |
| §20 Calendar, planning, capture | Calendar with month, week and agenda and a provider registry; meetings workspace; planning timeline with keyboard alternatives; timesheets; daily logs; HSE and QA/QC capture; offline field work | `docs/calendar.md`, `docs/meetings.md`, `docs/project-planning.md`, `docs/timesheets.md`, `docs/daily-logs.md`, `docs/mobile/offline-*.md` | Presentation only |
| §21 Charts, reports, print | Five accessible chart components; report pages per module; currency grouping service | `components/charts/*`, `lib/core/reporting/*` | Report template; print stylesheet |
| §22 Platform Admin and access | Organizations, users, memberships, grants, roles, entitlements and plans, audit, system pages, recovery, 3D authoring; scoped group and company user management | `docs/account-administration.md`, `docs/audits/AUD-ADMIN-01.md`, `docs/organization.md`, `docs/security/*` | Shared filters, badge and dialogs |
| §24 Mobile | Phone shell with bottom bar, record cards, bottom sheets, phone forms, capture, offline, native shell | `docs/mobile/*` (59 documents), 35 responsive specs | A pass under version 2 |
| §25 Accessibility, language | AUD-11 fixes and inventory; English and Albanian dictionaries per module; glossary | `docs/a11y/*`, `lib/i18n/*`, `docs/ux/glossary.md` | Manual screen-reader gates; version-2 run |
| §26 Architecture and catalog | Three layers already exist in practice; development catalog; page-section registry with the `PageUiContract` shape | `app/dev/ui`, `components/ui/page-sections.tsx` | Template and policy per route as data; design checks |
| §28 Security | Authorisation sweep, access manifest, security test suite, demo switch as sign-out and sign-in, production guards | `docs/security/*`, `tests/security/*`, `scripts/verify-authorization.ts`, `scripts/verify-production-guards.ts` | The quick-login panel |
| §29 Performance | Intent prefetch with limits, benchmark harness, client-bundle gate, query-count spec | ADR 0012-0014, `docs/navigation/NAV-0*-release-evidence.md`, `tests/e2e/perf/*` | Version-2 measurements |
| §33 Rollout | Versioned design system behind an environment flag, decided per request on the server; a cookie override in development only | `lib/layout/design-state.ts`, `lib/layout/design-server.ts`, `docs/dev/environment.md` | Telemetry of the version; rehearsal |

### Modules (PRD §23)

The PRD's matrix names coverage, not proof of existence. What exists:

| PRD module | In the repository | Note |
| --- | --- | --- |
| Projects | `projects` | card grid with search only, by an earlier product decision |
| Units/Sales | `projects` (structure, unit page), `sales` (project sales inventory, unit sales) | |
| Clients/CRM | `clients`, `sales` (leads, opportunities, proposals, pipeline) | |
| Finance | `finance` | |
| Procurement | `procurement` | |
| Legal/Contracts | `contracts` | |
| Documents | `documents` | no folder tree: §19.1's tree, drag-and-drop move and folder breadcrumbs are not applicable |
| Engineering/Architecture | `engineering`, `contractors` | registers of RFIs, submittals, drawings, transmittals; no separate architecture drawing queue |
| Inventory | `inventory` | |
| HR/People | `hr`, `people`, `team`, `workforce` | |
| Tasks/Collaboration | `tasks`, the collaboration panel | no board: lists only |
| Calendar/Meetings | `calendar`, `meetings` | |
| Approvals | `approvals` and five module queues | |
| Timesheets | `timesheets` | |
| Site Diary | `dailyLogs` | |
| HSE | `hse` | |
| Milestones | `projects` (planning, `/projects/milestones`) | |
| Announcements | `announcements` | |
| Reports | 14 report routes across modules | no report module of its own |
| Microsoft 365/integrations | `/settings/integrations`, `/admin/system/integrations`, document provider integration | mail and file views: not applicable, none present |
| Platform Admin | `platform:*` | |
| (not in the PRD's matrix) | `qaqc`, `organization`, `settings`, `company`, `support`, `search`, `activity`, `productivity`, `help`, `group:*`, `auth`, `marketing`, `project-3d` | all exist and are in the register |
| External portal | none | not applicable |

Routes by module, with the ticket that owns each family:

| Module | Routes | Migrated | Token-only | Needs work | N/A | Templates | Tickets |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `hse` | 59 | 0 | 36 | 23 | 0 | form 27, record 17, directory 11, overview 2, review 1, report 1 | WP04-04, WP04-07, WP05-02, WP05-12 |
| `inventory` | 44 | 0 | 41 | 3 | 0 | record 16, form 15, directory 10, overview 2, report 1 | WP04-04, WP04-07, WP05-11 |
| `qaqc` | 39 | 0 | 33 | 5 | 1 | form 15, record 10, directory 9, overview 2, review 1, system 1, report 1 | WP04-04, WP04-07, WP05-02, WP05-13 |
| `finance` | 33 | 0 | 27 | 6 | 0 | record 12, form 10, directory 6, overview 2, review 1, report 1, settings 1 | WP04-04, WP04-07, WP05-02, WP05-06, WP05-07 |
| `hr` | 27 | 0 | 23 | 4 | 0 | record 11, form 7, directory 6, explorer 1, overview 1, report 1 | WP04-04, WP04-07, WP05-10 |
| `sales` | 26 | 0 | 23 | 3 | 0 | form 10, record 8, directory 5, overview 1, board 1, report 1 | WP04-04, WP04-07, WP05-06, WP05-15 |
| `projects` | 25 | 0 | 17 | 6 | 2 | record 9, directory 5, system 3, form 2, settings 2, explorer 1, overview 1, timeline 1, report 1 | WP04-02, WP04-07, WP05-05, WP05-06 |
| `contracts` | 24 | 0 | 19 | 5 | 0 | directory 8, record 7, form 4, review 3, overview 1, report 1 | WP04-04, WP04-07, WP05-02, WP05-09 |
| `procurement` | 23 | 0 | 15 | 8 | 0 | form 9, record 5, directory 4, review 2, settings 1, overview 1, report 1 | WP04-04, WP04-07, WP05-02, WP05-08 |
| `engineering` | 19 | 0 | 1 | 18 | 0 | directory 11, record 4, overview 2, report 1, settings 1 | WP04-04, WP04-07, WP05-16 |
| `settings` | 19 | 1 | 13 | 4 | 1 | settings 18, system 1 | WP05-18 |
| `contractors` | 15 | 0 | 1 | 14 | 0 | record 10, directory 4, overview 1 | WP04-04, WP05-16 |
| `platform:system` | 15 | 0 | 13 | 2 | 0 | settings 14, overview 1 | WP04-04, WP04-11, WP05-19 |
| `clients` | 14 | 0 | 13 | 1 | 0 | record 8, directory 3, form 2, overview 1 | WP04-04, WP05-15 |
| `tasks` | 12 | 0 | 11 | 1 | 0 | directory 6, record 3, form 2, overview 1 | WP04-04, WP05-03 |
| `platform:3d` | 11 | 0 | 5 | 6 | 0 | record 5, directory 3, admin-canvas 1, viewer 1, settings 1 | WP05-20 |
| `meetings` | 10 | 0 | 9 | 1 | 0 | directory 5, record 2, form 2, report 1 | WP04-09, WP05-04 |
| `team` | 10 | 0 | 9 | 1 | 0 | directory 4, record 3, form 2, overview 1 | WP04-04, WP05-10 |
| `marketing` | 10 | 0 | 10 | 0 | 0 | system 10 | WP06-08 |
| `platform:users` | 10 | 0 | 9 | 1 | 0 | directory 6, settings 3, record 1 | WP05-19 |
| `documents` | 9 | 0 | 3 | 6 | 0 | explorer 4, record 2, form 2, overview 1 | WP04-04, WP05-01 |
| `dailyLogs` | 8 | 0 | 5 | 3 | 0 | directory 2, report 2, review 1, settings 1, record 1, form 1 | WP04-07, WP04-09, WP05-14 |
| `organization` | 8 | 0 | 6 | 2 | 0 | record 3, directory 3, settings 1, overview 1 | WP04-04, WP05-18 |
| `system` | 6 | 0 | 6 | 0 | 0 | system 6 | WP02-07 |
| `people` | 6 | 0 | 2 | 0 | 4 | system 4, record 1, directory 1 | WP05-10 |
| `workforce` | 6 | 0 | 6 | 0 | 0 | directory 3, form 1, record 1, settings 1 | WP05-10 |
| `platform:modules` | 6 | 0 | 4 | 2 | 0 | settings 5, directory 1 | WP05-19 |
| `timesheets` | 5 | 0 | 0 | 5 | 0 | review 2, form 1, report 1, settings 1 | WP04-07, WP05-14 |
| `auth` | 5 | 0 | 5 | 0 | 0 | system 5 | WP02-07 |
| `platform:audit` | 5 | 0 | 4 | 1 | 0 | directory 4, record 1 | WP05-19 |
| `announcements` | 4 | 0 | 1 | 3 | 0 | form 2, record 1, directory 1 | WP05-17 |
| `productivity` | 3 | 0 | 0 | 2 | 1 | overview 2, system 1 | WP04-05, WP05-17 |
| `help` | 3 | 0 | 3 | 0 | 0 | system 3 | WP05-17 |
| `support` | 3 | 0 | 3 | 0 | 0 | record 2, directory 1 | WP05-17 |
| `platform:organizations` | 3 | 0 | 1 | 2 | 0 | directory 2, record 1 | WP05-19 |
| `calendar` | 2 | 0 | 0 | 2 | 0 | calendar 2 | WP05-04 |
| `company` | 2 | 0 | 2 | 0 | 0 | record 2 | WP05-18 |
| `notifications` | 2 | 0 | 1 | 0 | 1 | system 2 | WP05-17 |
| `project-3d` | 2 | 0 | 0 | 2 | 0 | viewer 2 | WP05-20 |
| `platform:projects` | 2 | 0 | 0 | 2 | 0 | record 1, directory 1 | WP05-19 |
| `group:companies` | 2 | 0 | 0 | 2 | 0 | directory 2 | WP05-21 |
| `activity` | 1 | 0 | 1 | 0 | 0 | directory 1 | WP05-17 |
| `approvals` | 1 | 0 | 0 | 1 | 0 | review 1 | WP05-02 |
| `dashboard` | 1 | 0 | 0 | 1 | 0 | overview 1 | WP04-03 |
| `search` | 1 | 0 | 1 | 0 | 0 | directory 1 | WP05-17 |
| `offline` | 1 | 0 | 1 | 0 | 0 | system 1 | WP02-07 |
| `platform:account` | 1 | 0 | 1 | 0 | 0 | settings 1 | WP05-19 |
| `platform:help` | 1 | 0 | 1 | 0 | 0 | system 1 | WP05-19 |
| `platform:dashboard` | 1 | 1 | 0 | 0 | 0 | overview 1 | WP04-11 |
| `platform:whats-new` | 1 | 0 | 1 | 0 | 0 | system 1 | WP05-19 |
| `dev-catalog` | 1 | 1 | 0 | 0 | 0 | system 1 | — |
| `group:account` | 1 | 0 | 1 | 0 | 0 | settings 1 | WP05-21 |
| `group:help` | 1 | 0 | 1 | 0 | 0 | system 1 | WP05-21 |
| `group:overview` | 1 | 0 | 0 | 1 | 0 | overview 1 | WP04-05 |
| `group:roles` | 1 | 0 | 1 | 0 | 0 | settings 1 | WP05-21 |
| `group:users` | 1 | 0 | 0 | 1 | 0 | directory 1 | WP05-21 |
| `group:whats-new` | 1 | 0 | 1 | 0 | 0 | system 1 | WP05-21 |

## (d) Domain and backend gaps

These are not presentation work. Each needs a contract, and five need a migration. They are kept apart because
the port-3000 server runs a database without this branch's migrations and must keep working: anything that reads
a new table has to tolerate its absence or sit behind the version-2 flag.

| Gap | PRD | Today | Needs | Migration | Ticket |
| --- | --- | --- | --- | --- | --- |
| Per-user UI preferences | §27, §27.1 | Four browser cookies (`nesto.theme`, `nesto.density`, `nesto.ruler`, `nesto.sidebar`); a second person on the browser inherits them | A model, GET and PATCH with a version, cookie mirror for first paint, clearing on sign-out | yes | PREFS-01, PREFS-02 |
| Saved views | §12.6, §27.1 | A type only (`SavedViewShape`) | Model, CRUD API with versions, validation of the filter AST per list, sharing capability | yes | WP03-05 |
| All-matching selection and bulk execution | §12.4 | Explicit ids, authorised one by one; phone-only selection | A server-issued expiring selection token, preview of eligibility, per-item outcomes, a job for long runs | yes (token and job rows) | WP03-06 |
| Export jobs | §12.7 | One synchronous exporter that refuses past its limits | Job states, stored file with expiry, permission-checked download | yes | WP03-07 |
| Idempotency for ordinary mutations | §27.3 | Keys for uploads, approval decisions and jobs only | A key and a status lookup so a timeout is not retried blind | yes (or reuse `JobIdempotencyKey`) | WP03-13 |
| Expected version everywhere | §12.5, §27 | 29 models carry `version`; the rest are last-write-wins | A version on each model that gains inline editing, with a conflict answer | per model | WP03-13, WP03-14 |
| Error envelope | §27.3 | Codes and field errors exist (`lib/forms/errors.ts`, `lib/unsaved/outcome.ts`); the request id is logged, not returned everywhere | Request id, retryability and current version in every error body | no | WP03-13 |
| Entity preview read | §15, §27 | None | A whitelisted preview per entity type | no | OV-09 |
| Session-expiry warning | §1.1, §16.1 | None | The expiry time exposed to the client; a reauthentication path | no | OV-08 |
| Metric definitions | §11.3 | Two registries without freshness or drilldown | Those two fields, and every figure read through the registry | no | WP04-01 |
| Notification inbox for non-members | UI-01 §9 | A notification is addressed to a company member; Platform Admin and group-only people have an honest empty bell | A recipient model that is not a member | yes | none: carried from UI-01, outside UI-02's packages |
| Design-system version in telemetry | §33.2 | Navigation telemetry exists without it | One field | no | WP06-07 |

## (e) Risks and recommended order

### Risks

| Risk | Why | Mitigation |
| --- | --- | --- |
| Version 1 changes by accident | 467 routes share the primitives; a class moved without `ds2:` changes today's look on the port-3000 server | Tokens or the `ds2:` variant only; run the version-1 check after each ticket; expect nearly every capture to be identical |
| A broken intermediate state takes both dev servers down | They hot-reload from one folder; an `@import` of a missing file did it for seven minutes | Create a file before anything imports it; check `/login` on both ports after a risky edit |
| Migrations the port-3000 database does not have | PREFS-01, WP03-05, WP03-06, WP03-07 add tables | Additive only; never `prisma migrate dev`; reads tolerate a missing table or sit behind the flag |
| The quick-login panel reaches a merge | One click signs in as a seeded person; §28 forbids it in production | The user's decision, recorded in WP06-07 as a blocker; agents do not edit those files |
| The public site is restyled without anyone looking | `data-ds` is on `<html>`; ten marketing pages take the version-2 colours and were never captured | WP06-08: pin them to version 1 or capture and accept |
| "Token-only" is a prediction | 390 routes were judged by rule, not by eye | WP-06 captures every route family in both versions; a route that looks wrong moves to its module ticket |
| A shared file marks a whole module | `engineering-ui.tsx` and `hse-format.tsx` alone account for 47 needs-work routes | Fix the shared file first inside WP05-12 and WP05-16; the count drops at once |
| Two form kits drift further | 31 files import the engineering kit, 22 of them outside Engineering and Contractors (workforce, platform, people, organization, HR, HSE) | WP03-08 gives both one field anatomy before any module form is touched |
| Wider table text breaks phones | 14px against version 1's 13px; one grid already pushed a phone sideways | WP06-05 at 320 and 390px; the capture tool reports horizontal overflow |
| Scroll restore fights an existing rule | Every page opens at its top today, on purpose | WP02-04 restores on history traversal only, through the AUD-03 history guard |
| The 3D files may be in someone else's hands | `docs/a11y/surface-inventory.md` records `components/3d/**` as another session's files, not to be edited | WP05-20 last, after confirming with the user; the scan's largest counts are there and are mostly tool layout |
| No test has run under version 2 | 128 end-to-end specs, none sets `data-ds` | WP06-03 adds the switch to the harness first |
| Memory on the development machine | 16 GB; a type-check with the default heap crashes without printing errors | One heavy job at a time; the type-check with an 8 GB heap; a crash is not a pass |

### Recommended order

1. **Decisions first** (no code): the three open questions of the foundation stage (behaviour under the old look, the
   version-1 font fault, the quick-login panel) and the public site (WP06-08).
2. **WP02-06, then WP02-01 to WP02-03.** The register script and its test go in first so nothing escapes
   classification; then shell geometry, because every later capture depends on the sticky stack.
3. **OV-01 to OV-06 and WP03-08.** Overlays, state components and the field anatomy are shared by everything that
   follows and need no backend.
4. **WP04-01, then WP04-02 to WP04-05.** The metric contract, then the overviews: they are what a person compares
   first between the two versions, and they wire 27 of the eligible routes.
5. **WP03-01 to WP03-04 and WP03-15.** Table anatomy, desktop selection, column controls and the three reference
   implementations.
6. **PREFS-01 and PREFS-02, then WP03-05 to WP03-07 and WP03-13.** The backend block, in one run of migrations.
7. **WP-05 by size of win:** WP05-16 and WP05-12 first (one shared file each clears most of their routes), then
   WP05-19 (Platform Admin, which §22.1 puts in the first wave), then the remaining modules, WP05-20 last.
8. **WP04-06 to WP04-11** alongside the modules that need them (cards with Projects and Documents, reports and
   print with Finance).
9. **WP-06** throughout for the checks, and as a final pass for the evidence.

### Tickets

77 tickets; every one of the 150 needs-work routes is covered by at least one.

| Work package | Tickets | S | M | L |
| --- | --- | --- | --- | --- |
| WP-02 shell and navigation | 9 | 2 | 7 | 0 |
| OVERLAYS | 9 | 4 | 4 | 1 |
| WP-03 tables, filters, forms, saved views | 15 | 1 | 6 | 8 |
| PREFS | 3 | 1 | 2 | 0 |
| WP-04 overview, cards, metrics, reports, print | 11 | 1 | 7 | 3 |
| WP-05 domain surfaces | 21 | 0 | 7 | 14 |
| WP-06 accessibility, resilience, release | 9 | 2 | 6 | 1 |

| Ticket | Size | Title | Acceptance | Depends on |
| --- | --- | --- | --- | --- |
| WP02-01 | M | Shell geometry under version 2: 208/64px sidebar, 64/60/56px header, 32px breadcrumbs, 40px project tabs | UI02-03, UI02-04, UI02-05 | — |
| WP02-02 | M | Sidebar behaviour: gold edge rule on the active item, neutral hover, rail tooltips, no hover auto-expand | UI02-05, UI02-28 | WP02-01 |
| WP02-03 | M | Sticky geometry: banners and page toolbars join the measured stack; table heads and anchors read it | UI02-04 | WP02-01 |
| WP02-04 | M | Back restores the scroll anchor of a list or record (filters already restore from the URL) | UI02-06 | — |
| WP02-05 | M | One page-header and toolbar pattern for module, record and settings pages | UI02-02, UI02-15 | WP02-01 |
| WP02-06 | S | Page contract registry: template, scroll region, ruler policy per route, checked against the route register | UI02-01, UI02-16 | — |
| WP02-07 | M | Sign-in, recovery, invitation and system pages on the focused form layout | UI02-10, UI02-56 | — |
| WP02-08 | M | Platform Admin and Group shells: skip link, live announcer, loading boundaries, same header rules | UI02-02, UI02-03 | WP02-01 |
| WP02-09 | S | Mobile project tabs and context tabs: one scrollable row with a labelled More control | UI02-72 | WP02-01 |
| OV-01 | M | Dialog, Drawer and BottomSheet under version 2: 480-640px drawer, full-width small screens, 180-220ms, no stacked dialogs | UI02-53, UI02-54 | — |
| OV-02 | S | Menus, popovers and select lists: 8px gap, collision handling, bounded height, focus ring | UI02-53 | OV-01 |
| OV-03 | S | Tooltip timing: 400ms open, 100ms close, everywhere | UI02-30 | — |
| OV-04 | M | Confirmation quality: object and consequence in the copy, safer default focus, typed confirmation for organisation deletion | UI02-55 | OV-01 |
| OV-05 | S | Toasts: about six seconds, pause on hover and focus, at most three, never over a footer action | UI02-57 | — |
| OV-06 | M | State components: first load, refresh, empty, no matches, no permission, module unavailable, partial failure, offline | UI02-56, UI02-33 | — |
| OV-07 | S | Search, Notifications and Account panels at 680 / 400 / 320px with the version-2 parts | UI02-58, UI02-03 | OV-01 |
| OV-08 | M | Session expiry warning and reauthentication prompt | UI02-76 | OV-01 |
| OV-09 | L | Entity preview popover with a whitelisted preview read | UI02-30 | OV-02 |
| WP03-01 | M | DataTable anatomy under version 2: result count, toolbar, chips, sticky header, totals, pagination at 25/50/100 | UI02-40 | — |
| WP03-02 | S | Raw tables onto the Table primitive | UI02-13, UI02-40 | WP03-01 |
| WP03-03 | M | Row selection on desktop: page-only header checkbox, count, selection bar | UI02-42, UI02-29 | WP03-01 |
| WP03-04 | L | Column controls: resize and pin with keyboard alternatives, beside the existing show/hide | UI02-41 | WP03-01 |
| WP03-05 | L | Saved views: model, API and SavedViewSelector | UI02-45 | WP03-01, PREFS-01 |
| WP03-06 | L | All-matching selection token, bulk preview and bulk execution with per-item outcomes | UI02-42, UI02-43 | WP03-03 |
| WP03-07 | L | Totals and export: page or all-filtered label, chosen columns, export jobs with status | UI02-46 | WP03-01 |
| WP03-08 | M | Form kit under version 2: label, control, help, error; 720-880px width; required convention; error summary | UI02-47, UI02-48, UI02-32 | — |
| WP03-09 | M | Raw fields onto Input, FormSelect and Textarea | UI02-47, UI02-13, UI02-14 | WP03-08 |
| WP03-10 | L | One line-item editor for invoices, quotes, orders and stock documents | UI02-47, UI02-49 | WP03-08 |
| WP03-11 | M | Date, date-time and date-range controls with explicit time zone and blocked invalid ranges | UI02-52 | WP03-08 |
| WP03-12 | M | Entity picker and dependent fields: scoped search, states, an explicit notice when a dependent value is cleared | UI02-51 | WP03-08 |
| WP03-13 | L | Mutation envelope: request id, retryability, current version; idempotency key and status lookup after a timeout | UI02-50, UI02-44 | — |
| WP03-14 | L | Inline editing pattern with validation, commit, cancel and conflict | UI02-44 | WP03-13 |
| WP03-15 | L | Reference implementations: Finance invoices list and form, Projects directory, Admin Users | UI02-40, UI02-47, UI02-02 | WP03-01, WP03-08, WP03-10 |
| PREFS-01 | M | UiPreferences per user: model, GET and PATCH /api/me/ui-preferences with a version | UI02-11, UI02-13, UI02-17 | — |
| PREFS-02 | M | Preference controls save to the server, mirror to cookies for first paint, clear on sign-out and user change, sync across tabs | UI02-11, UI02-12, UI02-76 | PREFS-01 |
| PREFS-03 | S | Persistence order for lists: URL, saved view, personal default, product default; table preferences join it | UI02-41, UI02-45 | WP03-05, PREFS-01 |
| WP04-01 | M | Metric contract and MetricStrip for every module KPI grid | UI02-36, UI02-37, UI02-38 | — |
| WP04-02 | L | Project overview on the canonical structure: summary metrics, image and attention, financials, milestones, activity | UI02-39, UI02-16, UI02-35 | WP04-01 |
| WP04-03 | L | Company dashboard and its widgets: three to five metrics, role sections, honest bars | UI02-39, UI02-37, UI02-36 | WP04-01 |
| WP04-04 | L | Module overview template with the ruler: Finance, HR, HSE, Inventory, Procurement, QA/QC, Sales, Contracts, Clients, Tasks, Documents, Engineering, Team, Organization and the project module dashboards | UI02-39, UI02-16 | WP04-01, WP02-05 |
| WP04-05 | M | Group overview and Personal Work pages | UI02-39, UI02-09 | WP04-01 |
| WP04-06 | M | Card families: project, document, action, person, shortcut and comparison cards on Card and CardLink | UI02-34, UI02-35, UI02-28 | — |
| WP04-07 | M | Report template: filters, as-of time, sections with the ruler, generate and export | UI02-68, UI02-16, UI02-67 | WP04-01, WP04-08 |
| WP04-08 | M | Chart conventions: title, unit, period, scope, table alternative, series palette with one gold focal series | UI02-67, UI02-14 | — |
| WP04-09 | M | Print: one print stylesheet that removes the shell and the ruler, repeats table headers and keeps totals with their context | UI02-68 | WP04-07 |
| WP04-10 | M | Record detail template: compact header, grouped fields, secondary column, sections registered for the ruler | UI02-16, UI02-33 | WP02-05 |
| WP04-11 | S | Platform Admin overview: finish the leftovers of the foundation stage | UI02-02, UI02-39 | WP04-01 |
| WP05-01 | L | Documents: explorer list and grid, preview chrome, upload tray, version detail | UI02-62, UI02-63, UI02-64 | WP03-01, WP04-06, OV-06 |
| WP05-02 | L | Approvals Center and the five module approval queues on one review-queue pattern | UI02-59, UI02-55 | WP03-01, OV-01, OV-04 |
| WP05-03 | M | Tasks: lists, detail, edit with conflict review, comments and mentions | UI02-60, UI02-61 | WP03-01, WP03-08, WP04-10 |
| WP05-04 | L | Calendar and meetings: view controls, event cards, list fallback, meeting workspace | UI02-65, UI02-52 | WP03-11, OV-01 |
| WP05-05 | L | Planning timeline and milestones | UI02-66, UI02-65 | OV-01, WP03-01 |
| WP05-06 | L | Projects, structure, units and the unit page | UI02-34, UI02-35, UI02-09 | WP04-06, WP03-01, WP04-10 |
| WP05-07 | L | Finance: registers, record pages, forms and group reports | UI02-38, UI02-46, UI02-49 | WP03-15, WP03-10, WP04-10 |
| WP05-08 | M | Procurement: requests, RFQs, quote comparison, orders, suppliers | UI02-38, UI02-55 | WP03-10, WP04-10, WP05-02 |
| WP05-09 | M | Contracts: registers, contract record and tabs, amendments, requests | UI02-63, UI02-55 | WP03-01, WP04-10, WP05-02 |
| WP05-10 | L | HR, People, Team and Workforce: directories, profile, restricted records | UI02-34, UI02-64, UI02-33 | WP03-01, WP03-08, WP04-10, WP04-06 |
| WP05-11 | M | Inventory: stock tables, movement documents, warehouses, items | UI02-47, UI02-38 | WP03-01, WP03-10, WP04-10 |
| WP05-12 | L | HSE: registers, severity detail, capture forms, checklist execution | UI02-47, UI02-72 | WP03-01, WP03-08, WP04-10 |
| WP05-13 | M | QA/QC: inspections, defects, NCRs, corrective actions, templates | UI02-47, UI02-72 | WP03-01, WP03-08, WP04-10 |
| WP05-14 | L | Site diary and timesheets: capture, week grid, review | UI02-66, UI02-72, UI02-49 | WP03-08, OV-01, WP04-07 |
| WP05-15 | L | Sales and Clients: pipeline board, leads, opportunities, proposals, client profile | UI02-65, UI02-34 | WP03-01, WP04-06, WP04-10 |
| WP05-16 | L | Engineering and Contractors: registers, RFI and submittal workspaces, work packages | UI02-63, UI02-47 | WP03-01, WP03-08, WP04-01, WP04-10 |
| WP05-17 | M | Announcements, activity, notifications, search results, support and help | UI02-58, UI02-61 | OV-06, WP03-08 |
| WP05-18 | L | Organization, company and settings: access and roles, modules, integrations, numbering, devices | UI02-69, UI02-70, UI02-08 | WP03-08, WP03-01, OV-04 |
| WP05-19 | L | Platform Admin: organizations, users, modules and entitlements, audit, projects, system | UI02-02, UI02-08, UI02-69, UI02-70 | WP03-15, WP03-08, WP02-08, OV-04 |
| WP05-20 | L | 3D: authoring chrome in Platform Admin and the three viewers | UI02-71, UI02-26 | OV-01, WP03-09 |
| WP05-21 | M | Group surface: companies, users, roles, account | UI02-08, UI02-09, UI02-02 | WP02-08, WP03-08, WP03-01 |
| WP06-01 | M | Design checks in the test suite: raw colours, hand-drawn controls, duplicate primitives, click containers | UI02-14, UI02-80 | WP02-06 |
| WP06-02 | M | Contrast beyond the opaque pairs: disabled, alpha blends, status tints, chart series, focus surroundings | UI02-14 | — |
| WP06-03 | L | Acceptance evidence: one row of evidence for UI02-01 to UI02-80 and the twelve journeys as end-to-end specs under version 2 | UI02-01, UI02-06, UI02-07, UI02-18, UI02-19, UI02-20, UI02-21, UI02-22, UI02-24, UI02-25, UI02-58, UI02-59, UI02-60, UI02-74, UI02-75, UI02-77 | WP02-06 |
| WP06-04 | M | Accessibility pass under version 2: axe on every surface, forced colours, reduced motion, 200% and 400% zoom, screen-reader notes | UI02-73, UI02-31, UI02-15, UI02-27, UI02-29 | WP06-03 |
| WP06-05 | M | Phone and tablet pass under version 2 at 320, 390, 768 and 1024px | UI02-72, UI02-13, UI02-27 | WP06-03 |
| WP06-06 | M | Performance budgets: ruler script size and frame cost, pending feedback, no layout shift on hover | UI02-78, UI02-23 | WP06-03 |
| WP06-07 | M | Rollout and rollback: flag, version in telemetry, rollback rehearsal, the open housekeeping decisions | UI02-79, UI02-76, UI02-80 | WP06-03, PREFS-02 |
| WP06-08 | S | Public site under version 2: pin it to version 1 or verify it page by page | UI02-10 | — |
| WP06-09 | S | Albanian and English for every new string; long-label checks | UI02-15 | — |

## Not finished in this stage

1. **Visual baseline.** WP-00's exit list includes one; this stage was documentation only, with no screenshots and
   no load on the servers. The foundation stage's captures of twenty routes exist outside the repository.
2. **Baseline task-completion observations and performance** (§32 WP-00, §33.2) were not taken.
3. **Owner per route** (§5, UI02-01) is not in the register.
4. **Reading every page.** Template and status were judged by rule and by sample, as described above.
5. **Running anything.** No test, type-check or capture was run; the three files are data and prose.
