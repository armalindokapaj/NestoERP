import { navigationOf, resolveNavigation, type Navigation, type NavigationItem } from "@/config/navigation";
import { supportsGroupWorkspace } from "@/config/workspace";
import type { UserContext } from "@/lib/context/types";
import { resolveGroupContexts } from "@/lib/context/workspace-access";
import { sectionLabel } from "@/lib/i18n/modules/common/labels";
import { getTranslations } from "@/lib/i18n/server";

/**
 * The navigation for the active workspace (Workspace Context §24-§27): the
 * logo's panel and the Ribbon's tabs (config/navigation.ts).
 *
 *   User + Workspace + Enabled Modules + Effective Permissions = Navigation
 *
 * Company workspace: the company's enabled modules, and their sections, that
 * the person's permissions there reach. Group workspace: an item is offered
 * when the Group workspace supports its module (`MODULE_GROUP_SUPPORT`) and at
 * least one company the person may enter both enables it and lets them open
 * it. Not "enabled somewhere and permitted somewhere else": the two must hold
 * in the same company, or the item would appear and the page refuse it (§25).
 *
 * Every label leaves here in the reader's language — a module's name, a
 * section's, or one of the shell's own — so the bar draws them as they are.
 *
 * Recomputed from the session on every render, never remembered: a workspace
 * change leaves nothing of the old navigation behind (§27).
 */
export async function resolveWorkspaceNavigation(context: UserContext): Promise<Navigation> {
  if (context.workspace.scopeType === "COMPANY") {
    return translated(resolveNavigation({ permissions: context.permissions, enabledModules: context.enabledModules }));
  }

  const keys = new Set<string>();
  for (const company of await resolveGroupContexts(context)) {
    const navigation = resolveNavigation({ permissions: company.permissions, enabledModules: company.enabledModules });
    for (const group of [...navigation.menu, ...navigation.ribbon]) {
      for (const item of group.items) if (supportsGroupWorkspace(item.module)) keys.add(item.key);
    }
  }
  return translated(navigationOf(keys));
}

async function translated(navigation: Navigation): Promise<Navigation> {
  const [names, common, shell] = await Promise.all([getTranslations("modules"), getTranslations("common"), getTranslations("shell")]);
  const label = (item: NavigationItem): string => {
    const from = item.labelFrom;
    if (from.kind === "module") return names(`${item.module}.label`);
    if (from.kind === "section") return sectionLabel(common, item.module, { key: from.section, label: item.label });
    return shell(`nav.${from.key}`);
  };
  const each = (groups: Navigation["menu"]) => groups.map((group) => ({ ...group, items: group.items.map((item) => ({ ...item, label: label(item) })) }));
  return { menu: each(navigation.menu), ribbon: each(navigation.ribbon) };
}
