import { isMembershipRoleKey, type RoleKey } from "@/config/roles";

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

/**
 * Development conveniences are off anywhere that is not a developer's machine.
 *
 * APP_ENV is the authority where it is set, so a staging deployment built with
 * NODE_ENV=development still refuses the switcher — security behaviour is never
 * inferred from a value that happens to be lying around (PRD #34 §11,
 * PRD #30 §261, §349).
 *
 * Computed from process.env directly rather than through the validated env
 * schema, because this module is imported by edge middleware where the full
 * server environment is not present.
 */
const ENVIRONMENT = process.env.APP_ENV ?? process.env.NODE_ENV ?? "development";

export const isDevMode = ENVIRONMENT !== "production" && ENVIRONMENT !== "staging";

export function resolveRole(actualRole: RoleKey, cookieValue?: string | null): RoleKey {
  if (!isDevMode) return actualRole;
  if (!cookieValue) return actualRole;
  return isMembershipRoleKey(cookieValue) ? cookieValue : actualRole;
}
