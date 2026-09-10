import * as React from "react";

import { ModuleHeader } from "@/components/modules/module-header";
import { ModuleTabs } from "@/components/modules/module-tabs";
import { modules, type ModuleKey } from "@/config/modules";

/**
 * Every module page uses this structure (spec §31; design spec §28):
 * title, description, primary action, tab navigation, filters, then content.
 */
export function ModuleShell({
  moduleKey,
  activeTab,
  actions,
  filters,
  children,
}: {
  moduleKey: ModuleKey;
  activeTab: string;
  actions?: React.ReactNode;
  filters?: React.ReactNode;
  children: React.ReactNode;
}) {
  const activeModule = modules[moduleKey];

  return (
    <div className="space-y-5">
      <ModuleHeader module={activeModule} actions={actions} />

      <ModuleTabs module={activeModule} activeTab={activeTab} />

      {filters ? <div>{filters}</div> : null}

      <div>{children}</div>
    </div>
  );
}

/** Narrows a ?tab= value to a slug the module actually has. */
export function resolveTab(moduleKey: ModuleKey, requested?: string | string[]): string {
  const activeModule = modules[moduleKey];
  if (activeModule.tabs.length === 0) return "";

  const value = Array.isArray(requested) ? requested[0] : requested;
  const match = activeModule.tabs.find((tab) => tab.slug === value);
  return match?.slug ?? activeModule.tabs[0].slug;
}

export function tabLabel(moduleKey: ModuleKey, slug: string): string {
  const activeModule = modules[moduleKey];
  return activeModule.tabs.find((tab) => tab.slug === slug)?.label ?? activeModule.label;
}
