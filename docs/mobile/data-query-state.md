# Data query state (MOB-03)

The URL query string is the canonical state of every list. `lib/data/query-state.ts`
is its typed view (edge-safe, no React):

- `parseQueryState(query, keys)` / `serializeQueryState(state, keys)`: round-trip
  search, filters, sort, page, limit and any other route keys.
- `activeFilterCount(state, defaults)`: the number shown on the filter trigger.
- `toSavedView(state, extras)`: the saved-view shape from the same state.
- `dropRelationFilters(state, params)`: remove filters that name another
  workspace's records when the workspace changes.
- `DEFAULT_QUERY_KEYS`: `search`, `sort`, `page`, `limit`.

Nothing here decides visibility: the server's parsers and authorization remain
authoritative, and client state is never trusted for scope.
