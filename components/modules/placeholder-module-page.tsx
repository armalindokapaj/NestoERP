import { ModulePlaceholder } from "@/components/modules/module-placeholder";
import { ModuleShell, resolveTab, tabLabel } from "@/components/modules/module-shell";
import { modules, type ModuleKey } from "@/config/modules";
import { requirePermission } from "@/lib/auth/session";

/**
 * A module that has its structure but not yet its functionality (spec §31, §68).
 *
 * The route, header, tabs, permission and placeholder are all real — only the
 * feature is missing, so building it later means replacing this one call.
 */
export async function PlaceholderModulePage({
  moduleKey,
  searchParams,
}: {
  moduleKey: ModuleKey;
  searchParams: Promise<{ tab?: string }>;
}) {
  const activeModule = modules[moduleKey];
  await requirePermission(activeModule.viewPermission);

  const { tab } = await searchParams;
  const activeTab = resolveTab(moduleKey, tab);

  return (
    <ModuleShell moduleKey={moduleKey} activeTab={activeTab}>
      <ModulePlaceholder title={`${activeModule.label} ${tabLabel(moduleKey, activeTab)}`} />
    </ModuleShell>
  );
}
