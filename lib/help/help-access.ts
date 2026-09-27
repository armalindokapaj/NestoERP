import { modules, type ModuleKey } from "@/config/modules";
import { navigationItems } from "@/config/navigation";
import type { Permission } from "@/config/permissions";
import { can, canAccessModule } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";
import { resolveGroupContexts } from "@/lib/context/workspace-access";
import { resolveWorkspaceNavigation } from "@/lib/workspace/navigation";

/**
 * Whose help a reader gets (AUD-05 §7, §8, UX-16): the modules they can open in
 * the workspace they are in — the sidebar's own answer, reused, not asked for
 * again per module — plus Announcements, which the Activity bell reaches
 * instead of the sidebar. A module they cannot open has no help page for them:
 * help never advertises what somebody cannot use.
 *
 * `holds` answers whether an action's permission is held here: in a company
 * workspace by that company; in the Group workspace by at least one company
 * the person may enter, where the action's page then asks which company.
 */
export async function helpAccess(context: UserContext): Promise<{ modules: ModuleKey[]; holds: (permission: Permission) => boolean }> {
  const navigation = await resolveWorkspaceNavigation(context);
  const visible = new Set<ModuleKey>(navigation.flatMap((group) => group.items.map((item) => item.module)));

  if (context.workspace.scopeType === "COMPANY") {
    if (canAccessModule(context, "announcements")) visible.add("announcements");
    return { modules: order(visible), holds: (permission) => can(context, permission) };
  }

  const companies = await resolveGroupContexts(context);
  return {
    modules: order(visible),
    holds: (permission) => companies.some((company) => can(company, permission)),
  };
}

function order(keys: Set<ModuleKey>): ModuleKey[] {
  const inNavigation = navigationItems({ permissions: [...keys].map((key) => modules[key].permission), enabledModules: [...keys] }).map((item) => item.module);
  return [...inNavigation, ...[...keys].filter((key) => !inNavigation.includes(key))];
}
