"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

import { Building2, Home, Landmark, NestoProjects, type IconComponent } from "@/components/icons";
import { useTranslations } from "@/components/i18n/i18n-provider";
import { getIcon } from "@/components/layout/nav-icon";
import Link from "@/components/navigation/nav-link";
import { PendingDot, usePendingDestination } from "@/components/navigation/navigation-feedback";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { isNavigationItemActive, type NavigationGroup, type NavigationItem } from "@/config/navigation";
import { cn } from "@/lib/utils/cn";

const GROUP_ICONS: Record<NavigationGroup["group"], IconComponent> = {
  primary: Home,
  work: NestoProjects,
  department: Landmark,
  company: Building2,
};

/**
 * The desktop Dock (docs/ui/UI-04-navigation-layouts.md): one tab per
 * navigation group in a bar at the bottom of the window, from `lg`. Each tab
 * opens its own menu of that group's modules above it; the tab holding the
 * module you are in is marked. A module's sections stay on the page, in its
 * tab row.
 *
 * Renders what the one navigation resolver produced for this person. Content
 * keeps clear of the bar by `--nesto-bottom-nav-space` (styles/globals.css),
 * so no page pads itself.
 */
export function DesktopDock({ navigation }: { navigation: NavigationGroup[] }) {
  const t = useTranslations("shell");
  const pathname = usePathname();
  const [open, setOpen] = React.useState<NavigationGroup["group"] | null>(null);
  React.useEffect(() => setOpen(null), [pathname]);

  const groupLabel = (group: NavigationGroup["group"]) =>
    group === "primary" ? t("dock.home") : group === "department" ? t("dock.departments") : t(`groups.${group}`);

  return (
    <nav
      aria-label={t("dock.label")}
      data-desktop-dock
      data-shell-region
      className="fixed bottom-5 left-1/2 z-[var(--nesto-z-shell-tabs)] flex -translate-x-1/2 items-center gap-1 rounded-[20px] border border-[light-dark(rgb(255_255_255/0.75),rgb(255_255_255/0.1))] bg-surface/[0.92] p-1.5 shadow-menu backdrop-blur-xl backdrop-saturate-[1.3] max-lg:hidden"
    >
      {navigation.map((group) => {
        const Icon = GROUP_ICONS[group.group];
        const current = group.items.some((item) => isNavigationItemActive(item, pathname));
        const label = groupLabel(group.group);
        return (
          <Popover key={group.group} open={open === group.group} onOpenChange={(next) => setOpen(next ? group.group : null)}>
            <PopoverTrigger asChild>
              <button
                type="button"
                data-testid={`dock-${group.group}`}
                data-current={current || undefined}
                className={cn(
                  "relative flex h-14 min-w-[5.5rem] flex-col items-center justify-center gap-1 rounded-[14px] px-3 font-mono text-[0.625rem] font-medium uppercase tracking-[0.08em] transition-colors",
                  open === group.group ? "bg-hover text-fg" : current ? "text-accent-strong" : "text-fg-muted hover:bg-hover hover:text-fg",
                  current && "after:absolute after:bottom-1 after:h-0.5 after:w-4 after:rounded-full after:bg-accent",
                )}
              >
                <Icon aria-hidden="true" className="size-5" />
                {label}
              </button>
            </PopoverTrigger>
            <PopoverContent side="top" align="center" sideOffset={12} className="w-[min(40rem,calc(100vw-3rem))] p-3" data-testid={`dock-menu-${group.group}`}>
              <p className="nesto-eyebrow px-2 pb-2 pt-1 text-fg-subtle">{label}</p>
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-0.5">
                {group.items.map((item) => (
                  <li key={item.key}>
                    <DockLink item={item} active={isNavigationItemActive(item, pathname)} onDone={() => setOpen(null)} />
                  </li>
                ))}
              </ul>
            </PopoverContent>
          </Popover>
        );
      })}
    </nav>
  );
}

function DockLink({ item, active, onDone }: { item: NavigationItem; active: boolean; onDone: () => void }) {
  const t = useTranslations("modules");
  const Icon = getIcon(item.icon);
  const pending = usePendingDestination(item.href);
  return (
    <Link
      href={item.href}
      navSource="sidebar"
      intent
      onNavigate={onDone}
      aria-current={active ? "page" : undefined}
      data-pending={pending || undefined}
      className={cn(
        "relative flex min-h-10 items-center gap-3 rounded-lg px-3 text-body transition-colors",
        active ? "bg-primary text-primary-fg" : "text-fg hover:bg-hover",
      )}
    >
      <Icon aria-hidden="true" className={cn("size-[18px] shrink-0", active ? "text-current" : "text-fg-subtle")} />
      <span className="min-w-0 flex-1 truncate">{t(`${item.key}.label`)}</span>
      {pending ? <PendingDot className="text-accent" /> : null}
    </Link>
  );
}
