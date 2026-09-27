"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { useSidebar } from "@/components/layout/sidebar-provider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Collapse / expand control (design spec §14).
 *
 * It lives in the top bar rather than inside the sidebar. A 72px rail has room
 * for one thing in its header, and that thing is the mark — which is the link
 * home, so it cannot also be the control that changes the navigation width. Out
 * here the button holds one position in both states.
 *
 * Only offered at desktop width. Below 1200px the rail is decided by the
 * viewport, so a toggle would promise something it cannot deliver.
 *
 * The negative margin pulls it back through the top bar's 32px desktop gutter
 * to sit 12px off the sidebar border — the same inner gutter the rail uses, so
 * the control reads as belonging to the navigation it moves.
 */
export function SidebarToggle() {
  const { state, toggle } = useSidebar();
  const t = useTranslations("shell");
  const collapsed = state === "collapsed";
  const label = collapsed ? t("expandSidebar") : t("collapseSidebar");
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={toggle}
          aria-label={label}
          className="hidden size-8 shrink-0 place-items-center rounded-md text-fg-subtle transition-colors hover:bg-hover hover:text-fg xl:-ml-5 xl:grid touch:size-11"
        >
          <Icon aria-hidden="true" className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
