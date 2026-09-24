import { clearActivityCache } from "@/lib/activity/client";
import { clearSearchHomeCache } from "@/lib/productivity/client";

/**
 * Everything this tab holds about the signed-in person, emptied at once: on
 * Logout and on a demo-user switch (Fast Re-entry §87, Profile Menu §44).
 *
 * Favorites, Recent Work, permissions and the workspace are server-rendered and
 * go with the session; both callers then load the next page in full, so no
 * component state survives either. What remains in memory is listed here.
 */
export function resetUserScopedClientState(): void {
  clearSearchHomeCache();
  clearActivityCache();
}
