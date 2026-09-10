import Link from "next/link";

import type { ModuleDefinition } from "@/config/modules";
import { cn } from "@/lib/utils/cn";

/**
 * Module sub-navigation (spec §31).
 * Tabs are links carrying ?tab=, so every tab is a real, shareable URL rather
 * than hidden client state.
 */
export function ModuleTabs({
  module,
  activeTab,
}: {
  module: ModuleDefinition;
  activeTab: string;
}) {
  if (module.tabs.length === 0) return null;

  return (
    <div className="-mx-1 overflow-x-auto">
      <nav
        aria-label={`${module.label} sections`}
        className="flex min-w-max items-center gap-1 border-b border-line px-1"
      >
        {module.tabs.map((tab) => {
          const active = tab.slug === activeTab;
          return (
            <Link
              key={tab.slug}
              href={`${module.href}?tab=${tab.slug}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-table font-medium transition-colors",
                active
                  ? "border-accent text-fg"
                  : "border-transparent text-fg-muted hover:text-fg",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
