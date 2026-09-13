"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { getIcon } from "@/components/layout/nav-icon";
import { useSidebar } from "@/components/layout/sidebar-provider";
import { Divider } from "@/components/ui/divider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isNavigationItemActive, type NavigationGroup, type NavigationItem } from "@/config/navigation";
import { cn } from "@/lib/utils/cn";

function NavItem({
  item,
  active,
  showTooltip,
  dense,
  onNavigate,
}: {
  item: NavigationItem;
  active: boolean;
  showTooltip: boolean;
  /** The drawer has a fixed height to fill; the desktop rail does not. */
  dense: boolean;
  onNavigate?: () => void;
}) {
  const Icon = getIcon(item.icon);
  const t = useTranslations("modules");
  const label = t(`${item.key}.label`);

  /* Light accent ground, accent icon and text, plus a 2px left marker
     (PRD #3 §12). */
  const link = (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "nesto-nav-item group relative flex items-center gap-3 overflow-hidden rounded-lg px-3 text-body font-medium transition-colors",
        dense ? "py-2.5" : "py-2.5",
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
      <span className="nesto-nav-label truncate">{label}</span>
    </Link>
  );

  /* A 72px rail is only usable if the icons can name themselves (PRD #3 §83).
     Tooltips never appear on the expanded sidebar. */
  if (!showTooltip) return link;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Renders whatever the navigation resolver produced (PRD #3 §98, §99).
 *
 * There is no role branching in here, and no second navigation definition for
 * the drawer: the desktop sidebar and the mobile drawer render the same
 * resolved groups, and only the presentation differs.
 */
export function SidebarNav({
  navigation,
  onNavigate,
  inDrawer = false,
}: {
  navigation: NavigationGroup[];
  onNavigate?: () => void;
  inDrawer?: boolean;
}) {
  const pathname = usePathname();
  const { isRail } = useSidebar();
  const t = useTranslations("shell");

  return (
    <nav
      aria-label={t("mainNavigation")}
      className={cn("flex flex-col px-3 py-2", inDrawer ? "gap-4" : "gap-6")}
    >
      {navigation.map((group, index) => (
        <div key={group.group}>
          {group.group !== "primary" ? (
            <>
              <p className="nesto-nav-group-label nesto-eyebrow mb-2 px-3 text-fg-subtle">
                {t(`groups.${group.group}`)}
              </p>
              {/* The rail has no room for group headings, so a hairline keeps
                  the groups legible instead (PRD #3 §84). */}
              {index > 0 ? <Divider className="nesto-nav-divider mx-2.5 mb-3" /> : null}
            </>
          ) : null}
          <div className="space-y-0.5">
            {group.items.map((item) => (
              <NavItem
                key={item.key}
                item={item}
                active={isNavigationItemActive(item, pathname)}
                showTooltip={isRail && !inDrawer}
                dense={inDrawer}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}
