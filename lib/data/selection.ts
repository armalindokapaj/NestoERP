/**
 * The rules of list selection (MOB-03 §30, §31), as pure functions over sets of
 * canonical record ids, so the provider stays a thin shell and the rules are
 * testable without a browser.
 */
export function toggleId(current: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(current);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export function selectAll(visibleIds: readonly string[]): ReadonlySet<string> {
  return new Set(visibleIds);
}

/**
 * Drops ids that are no longer on the page (a refresh, a sync, a deleted
 * record). Returns the same set when nothing changed, so React does not
 * re-render for nothing.
 */
export function pruneToVisible(current: ReadonlySet<string>, visibleIds: readonly string[]): ReadonlySet<string> {
  const visible = new Set(visibleIds);
  const kept = [...current].filter((id) => visible.has(id));
  return kept.length === current.size ? current : new Set(kept);
}

/** Whether a query change should clear the selection: any change to what the list shows. */
export function selectionSurvivesQueryChange(previousQuery: string, nextQuery: string): boolean {
  return previousQuery === nextQuery;
}

export function allVisibleSelected(ids: ReadonlySet<string>, visibleIds: readonly string[]): boolean {
  return visibleIds.length > 0 && visibleIds.every((id) => ids.has(id));
}
