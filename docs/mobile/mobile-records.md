# Mobile records (MOB-03)

`components/data/mobile-record.tsx`

- `MobileRecordCard`: title, subtitle, status badge, optional value, `facts`
  (label/value lines), `details` (collapsed), `actions`, `selection`.
- `MobileRecordRow`: the compact variant of the same props.
- Markers used by tests and CSS: `data-record-card`, `data-card-link`, `data-card-actions`.
- **Actions**: `RecordActionSheet` (a BottomSheet from a "More" button, 44px
  targets) with `SheetActionLink` / `SheetActionButton`. Same actions as the
  desktop menu; the server still authorizes every one.
- **Refresh**: `ListRefresh` re-fetches the current server query (`router.refresh`),
  it never changes the query.
- **Selection** (`components/data/selection.tsx`, `lib/data/selection.ts`):
  `SelectionProvider`, `SelectModeToggle`, `SelectRecordCheckbox`, `SelectionBar`,
  `BulkAction`. Ids are canonical record ids; selection is pruned to the visible
  page and cleared when the query changes. **Shipped and unit-tested, but no list
  opts in yet: no bulk endpoint exists.** A list opts in with `selectable` on `DataTable`.
