# MOB-03 data UI audit

Taken 2026-09-30 at HEAD 801a8f60 plus the MOB-01/02 changes, before any MOB-03 code.

## What is already one system

| Concern | Where | State |
|---|---|---|
| Table | `components/data/data-table.tsx` `DataTable`, 50 consumers, 253 rows in `docs/tables/list-manifest.md` | One desktop table and one phone card list rendered from the same columns and records; CSS chooses (`md`). |
| Query state | URL query string: `lib/tables/list-url.ts`, `components/data/list-toolbar.tsx`, module parsers (`lib/modules/shared/list-query`) | Search, filters, sort, page and limit all live in the URL. Back, refresh and shared links reproduce a list. Changing anything returns to page 1; Clear keeps unrelated keys. |
| Search | `ListToolbar` | Server-side, immediate on Enter/blur, no client filtering of loaded rows. |
| Filters | `FilterSheet`, `FilterChips`, `lib/tables/filter-draft.ts` | Staged phone sheet (Apply / Cancel / Clear), count badge, removable chips, Clear all. |
| Sort | `TableSortSelect`, `SortHeaderCell`, `lib/tables/sort.ts` | Header sort on desktop; labelled select on phone; only server-allowlisted orders. |
| Pagination | `components/data/pagination.tsx` | Server pages, "1-25 of 73", page size per list. |
| Column preferences | `TableColumnsScope`, `lib/tables/preferences.ts` | Per-device, validated against the columns. |
| Empty, no results, error, loading | `EmptyState`, `NoResultsState`, `listEmptyKind`, `ErrorState`, `SkeletonTable/Cards` | Distinguishes first run from filtered-to-nothing. |
| Status | `components/modules/status-badge.tsx` | Text plus colour, one vocabulary in `lib/utils/status.ts`. |
| Row actions | `actions(record)` on `DataTable`, module action menus | On a card: a bordered strip under the values. |
| Redaction | Server DTOs | A column can only render what the server sent; presentation never widens a DTO (AUD-08 DT-09). |

## Phone card as found

Title link stretched over the card, a chevron, one `dt/dd` line for **every** other column, then the actions strip. Correct and accessible, but:

1. Every column is a line, so a 12-column table becomes a 12-line card. No hierarchy (identity, status, 2-4 facts, the rest).
2. No place for a leading avatar or thumbnail, a prominent value, or a subtitle.
3. No compact row for identity-first lists (people, contacts, files).
4. No selection mode and no bulk-action bar.
5. Row actions always take a full strip; no `...` action sheet.
6. No accessible summary sentence for the card.
7. The card is inline in `DataTable`, so nothing else can reuse it (search results, related lists, selectors).

## Gaps and decisions

| PRD | Decision |
|---|---|
| Record card, compact row (§9-§13) | New `components/data/mobile-record.tsx`: `MobileRecordCard`, `MobileRecordRow`. `DataTable`'s phone list renders through it; the DOM markers tests rely on (`data-record-card`, `data-card-link`, `data-card-actions`) are kept. |
| Field hierarchy (§10, §11, §54) | `TableColumn.priority`: `primary` (title), `secondary` (default, unchanged), `detail` (behind a "More details" disclosure on the phone card only). `DataTable mobile={...}` adds subtitle, status, value, leading and an accessible label. Presentation metadata only, never authorization. |
| Selection and bulk (§30-§33) | `components/data/selection.tsx`: `SelectionProvider` (clears on any query or workspace change), `SelectModeToggle`, `SelectRecordCheckbox`, `SelectionBar`, `useSelection`. The bar uses `data-sticky-action-bar`, so MOB-02's bottom nav steps aside. Bulk actions are children that read `useSelection()`; destructive ones go through `ConfirmDialog`. Nothing is selectable unless a page opts in. |
| Action sheet (§34) | `RecordActionSheet` on `BottomSheet`; the page supplies only actions the person may take. |
| Query types (§85, §84) | `lib/data/query-state.ts`: `DataFilter`, `DataSort`, `DataQueryState`, `DataSelectionState`, `MobileRecordPresentation`, `parseQueryState`, `serializeQueryState`, `activeFilterCount`, `toSavedView` (a persistable shape; saved views themselves are not built). |
| Sort sheet (§25) | Kept as the labelled select (it applies at once and is server-allowlisted). Deviation recorded in `mobile-filters.md`. |
| Load more (§28, §29) | Not added. Server pagination stays explicit (PRD: do not replace it automatically; financial and legal lists prefer pages). Phone paging is the existing Previous/Next with the count. |
| Refresh (§64) | `ListRefresh` button (`router.refresh()` through the guarded router). |
| Hover-only actions | None found in `DataTable`; row actions are visible buttons. |
| N+1, projection (§87, §88) | List queries include what the row shows; no per-row fetch found in the migrated lists. |

## Classification of representative screens

| Screen | Kind | Phone status before | Migration |
|---|---|---|---|
| Projects (`/projects`) | GRID (portfolio cards) | Already responsive | Unchanged; owned by MOB-05. |
| Tasks (`components/tasks/task-table.tsx`) | TABLE | Cards, flat | `mobile`: title, status, priority, due date, project. |
| Units (project units list) | TABLE | Cards, flat | `mobile`: code, project, status, value, floor and area. |
| Team / employees (`components/team/team-table.tsx`) | TABLE | Cards, flat | Compact person row. |
| Documents (`components/documents/document-table.tsx`) | TABLE | Cards, flat | Compact file row with type. |
| Finance invoices (`components/finance/invoice-table.tsx`) | TABLE | Cards, flat | Reference, counterparty, exact amount, status, due date. |
| Timesheet grid, planning timeline, quote comparison | TECHNICAL | Own contained scroller | Unchanged (§53). |
| Remaining ~45 `DataTable` lists | TABLE | Partially responsive (flat cards) | Work as before; adopt `priority`/`mobile` per `mobile-records.md`. |

No `/mobile/*` list route or endpoint exists or is added.
