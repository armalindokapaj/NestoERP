import { moduleList, type ModuleKey } from "@/config/modules";
import { navigationItems, resolveNavigation, type NavigationGroup } from "@/config/navigation";
import { supportsGroupWorkspace } from "@/config/workspace";
import type { UserContext } from "@/lib/context/types";
import { resolveGroupContexts } from "@/lib/context/workspace-access";

/**
 * The sidebar for the active workspace (Workspace Context §24-§27).
 *
 *   User + Workspace + Enabled Modules + Effective Permissions = Sidebar
 *
 * Company workspace: the company's enabled modules that the person's permissions
 * there reach — the resolver the shell always had. Group workspace: a module is
 * offered when the Group workspace supports it (`MODULE_GROUP_SUPPORT`) and at
 * least one company the person may enter both enables it and lets them open it.
 * Not "enabled somewhere and permitted somewhere else": the two must hold in the
 * same company, or the item would appear and the page refuse it (§25).
 *
 * Recomputed from the session on every render, never remembered: a workspace
 * change leaves nothing of the old sidebar behind (§27).
 */
export async function resolveWorkspaceNavigation(context: UserContext): Promise<NavigationGroup[]> {
  if (context.workspace.scopeType === "COMPANY") {
    return resolveNavigation({ permissions: context.permissions, enabledModules: context.enabledModules });
  }

  const visible = new Set<ModuleKey>();
  for (const company of await resolveGroupContexts(context)) {
    for (const item of navigationItems({ permissions: company.permissions, enabledModules: company.enabledModules })) {
      if (supportsGroupWorkspace(item.module)) visible.add(item.module);
    }
  }

  return resolveNavigation({
    permissions: moduleList.filter((definition) => visible.has(definition.key)).map((definition) => definition.permission),
    enabledModules: [...visible],
  });
}
