import { settingsSections, type SettingsSection } from "@/config/settings";
import type { UserContext } from "@/lib/context/types";
import { can, canAccessModule } from "./can";

/**
 * Which settings sections a user may open (PRD #5 §39).
 *
 * Pure, like the rest of lib/access, so the guarantee below can be unit tested
 * without a database or a session: Profile and Appearance describe the person
 * rather than the company, so they survive whatever the role's Settings module
 * access is, and every authenticated user therefore has a /settings page with
 * something on it. The company sections stay behind settings.manage.
 */
export function visibleSettingsSections(
  context: Pick<UserContext, "permissions" | "moduleAccess">,
): SettingsSection[] {
  const hasModule = canAccessModule(context, "settings");

  return settingsSections.filter(
    (section) => section.personal || (hasModule && can(context, section.permission)),
  );
}
