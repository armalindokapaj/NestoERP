"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  isModuleEnabled,
  MODULE_ZONES,
  modules,
  zoneLabels,
  type ModuleDefinition,
} from "@/config/modules";
import { navigationForRole } from "@/config/navigation";
import type { RoleKey } from "@/config/roles";
import { getIcon } from "@/components/layout/nav-icon";
import { useSidebar } from "@/components/layout/sidebar-provider";
import { Divider } from "@/components/ui/divider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils/cn";

function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function SidebarItem({
  module,
  active,
  showTooltip,
  onNavigate,
}: {
  module: ModuleDefinition;
  active: boolean;
  showTooltip: boolean;
  onNavigate?: () => void;
}) {
  const Icon = getIcon(module.icon);

  /* §13: light indigo ground, indigo icon and text, plus a 2px left marker. */
  const link = (
    <Link
      href={module.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "nesto-nav-item group relative flex items-center gap-2.5 overflow-hidden rounded-md px-2.5 py-2 text-table font-medium transition-colors",
        active ? "bg-accent-soft text-accent-strong" : "text-fg-muted hover:bg-hover hover:text-fg",
      )}
    >
      {active ? (
        <span aria-hidden="true" className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-accent" />
      ) : null}
      <Icon
        aria-hidden="true"
        className={cn(
          "size-[18px] shrink-0",
          active ? "text-accent" : "text-fg-subtle group-hover:text-fg-muted",
        )}
      />
      <span className="nesto-nav-label truncate">{module.label}</span>
    </Link>
  );

  /* A 72px rail is only usable if the icons can name themselves (§14). */
  if (!showTooltip) return link;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{module.label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Renders the sidebar straight from configuration (spec §10, §50, §12).
 *
 * There is no role branching in here: whichever modules the role's navigation
 * lists are the modules that appear. Anything the role cannot open is absent
 * rather than disabled (§48).
 */
export function SidebarNav({
  role,
  onNavigate,
  inDrawer = false,
}: {
  role: RoleKey;
  onNavigate?: () => void;
  inDrawer?: boolean;
}) {
  const pathname = usePathname();
  const { isRail } = useSidebar();
  const moduleKeys = navigationForRole(role);

  const zones = MODULE_ZONES.map((zone) => ({
    zone,
    label: zoneLabels[zone],
    items: moduleKeys
      .filter(isModuleEnabled)
      .map((key) => modules[key])
      .filter((module) => module.zone === zone),
  })).filter((group) => group.items.length > 0);

  return (
    <nav aria-label="Main navigation" className="flex flex-col gap-5 px-3 py-4">
      {zones.map((group, index) => (
        <div key={group.zone}>
          {group.label ? (
            <>
              <p className="nesto-nav-group-label mb-1.5 px-2.5 text-micro font-semibold uppercase tracking-[0.1em] text-fg-subtle">
                {group.label}
              </p>
              {/* The rail has no room for group headings, so a hairline keeps
                  the zones legible instead (§14). */}
              {index > 0 ? (
                <Divider className="nesto-nav-divider mx-2.5 mb-3" />
              ) : null}
            </>
          ) : null}
          <div className="space-y-0.5">
            {group.items.map((module) => (
              <SidebarItem
                key={module.key}
                module={module}
                active={isActive(pathname, module.href)}
                showTooltip={isRail && !inDrawer}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}
