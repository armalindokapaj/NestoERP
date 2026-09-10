"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { useSidebar } from "@/components/layout/sidebar-provider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Collapse / expand control (design spec §14).
 *
 * Only offered at desktop width. Below that the rail is decided by the
 * viewport, so a toggle would promise something it cannot deliver.
 */
export function SidebarToggle() {
  const { state, toggle } = useSidebar();
  const collapsed = state === "collapsed";
  const label = collapsed ? "Expand sidebar" : "Collapse sidebar";
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={toggle}
          aria-label={label}
          className="hidden size-8 place-items-center rounded-md text-fg-subtle transition-colors hover:bg-hover hover:text-fg xl:grid"
        >
          <Icon aria-hidden="true" className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}
