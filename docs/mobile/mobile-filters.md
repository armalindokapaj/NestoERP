# Mobile filters, sort and search (MOB-03)

- Filters open in the existing `FilterSheet`; the trigger shows the active count
  and chips (`filter-chips.tsx`) show what is applied. "Clear filters" keeps the sort and search.
- Sort stays the labelled select (`table-sort-select.tsx`). **Deviation:** no
  separate sort sheet was built; the select is already a native picker on phones.
- Pagination stays explicit server pagination. **Deviation:** no load-more or
  infinite scroll, so the page count, back navigation and query all stay honest.
- Search is a server query (`search` param); the phone keyboard action submits it.
- The query survives opening a record and coming back (Back restores the URL).
