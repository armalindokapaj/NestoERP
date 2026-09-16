/**
 * The Projects page's URL, written from the browser (E-05A §48).
 *
 * The page reads it with `parsePortfolioQuery`; this is the other direction.
 * Only the page's own names are written — `company`, `type` — and any page of
 * "Load more" is dropped, because a changed filter starts the list again.
 */
export const ASSIGNED_ROLE_VALUE = "@assigned";

export type PortfolioUrlUpdate = {
  q?: string | null;
  status?: string | null;
  favorites?: string | null;
  company?: string | null;
  role?: string | null;
  type?: string | null;
  location?: string | null;
  sort?: string | null;
  /** Clear Filters: search, status, favorites, filters and sort all go (E-05A §19). */
  clear?: boolean;
};

const PAGE_KEYS = ["q", "status", "favorites", "company", "role", "type", "location", "sort"] as const;

export function portfolioHref(pathname: string, current: URLSearchParams, update: PortfolioUrlUpdate): string {
  const next = new URLSearchParams();
  if (!update.clear) {
    for (const key of PAGE_KEYS) {
      const value = key in update ? update[key] : current.get(key);
      if (value) next.set(key, value);
    }
  }
  const query = next.toString();
  return query ? `${pathname}?${query}` : pathname;
}
