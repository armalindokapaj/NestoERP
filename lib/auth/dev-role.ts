import { isRoleKey, type RoleKey } from "@/config/roles";

/**
 * Development role switcher (spec §66).
 *
 * The override lives in a cookie so it can be read identically from middleware
 * (edge) and from server components. Every read is gated on isDevMode, so the
 * switcher can never take effect in a production build.
 */
export const DEV_ROLE_COOKIE = "nesto.dev-role";

/** Sentinel telling the switcher to drop the override and use the real role. */
export const RESET_DEV_ROLE = "__actual__";

export const isDevMode = process.env.NODE_ENV !== "production";

export function resolveRole(actualRole: RoleKey, cookieValue?: string | null): RoleKey {
  if (!isDevMode) return actualRole;
  if (!cookieValue) return actualRole;
  return isRoleKey(cookieValue) ? cookieValue : actualRole;
}
