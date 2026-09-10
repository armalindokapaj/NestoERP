"use client";

import { useId } from "react";

import { useSidebar } from "@/components/layout/sidebar-provider";
import { Switch } from "@/components/ui/switch";

/**
 * Navigation width preference (design spec §14, §88).
 *
 * A real setting, not a placeholder: it drives the same cookie-backed state as
 * the collapse control in the sidebar itself, so changing it here takes effect
 * immediately and survives navigation and sign-out.
 */
export function NavigationPreference() {
  const { state, toggle } = useSidebar();
  const id = useId();
  const collapsed = state === "collapsed";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <label htmlFor={id} className="text-card font-semibold text-fg">
          Collapsed navigation
        </label>
        <p className="mt-1 text-table text-fg-muted">
          Show the sidebar as an icon rail. On tablet-sized screens the rail is
          always used, whatever this is set to.
        </p>
      </div>
      <Switch
        id={id}
        checked={collapsed}
        onCheckedChange={toggle}
        aria-label="Collapsed navigation"
      />
    </div>
  );
}
