"use client";

import { usePathname } from "next/navigation";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { getIcon } from "@/components/layout/nav-icon";
import Link from "@/components/navigation/nav-link";
import { PendingDot, usePendingDestination } from "@/components/navigation/navigation-feedback";
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
  // Accepted and on its way: marked at once, apart from the active state, which follows the committed URL (NAV-04).
  const pending = usePendingDestination(item.href);

  /* Light accent ground, accent icon and text, plus a 2px left marker
     (PRD #3 §12). */
  const link = (
    <Link
      href={item.href}
      navSource={dense ? "mobile" : "sidebar"}
      // The five approved module destinations are prepared on deliberate intent (NAV-03 §7).
      intent
      // Only an accepted navigation closes the drawer; a modified click leaves it open (N02).
      onNavigate={() => onNavigate?.()}
      aria-current={active ? "page" : undefined}
      // The rail hides the text label with display:none, which also removes it from the
      // accessible name; the name is stated so a rail icon is never announced as just "link" (AUD-11 AV-06).
      aria-label={label}
      data-pending={pending || undefined}
      className={cn(
        "nesto-nav-item group relative flex items-center gap-3 overflow-hidden rounded-lg px-3 text-body font-medium transition-colors",
        // 44px rows in the drawer and under touch (AUD-04 §4, MW-02); the mouse rail is unchanged.
        dense ? "min-h-11 py-2.5" : "py-2.5 touch:min-h-11",
        active ? "bg-accent-soft text-accent-strong" : "text-fg-muted hover:bg-hover hover:text-fg",
      )}
    >
      {active ? (
        <span aria-hidden="true" className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-accent" />
      ) : null}
      <Icon
        aria-hidden="true"
        strokeWidth={1.6}
        className={cn(
          "size-[18px] shrink-0",
          active ? "text-accent" : "text-accent-strong group-hover:text-accent",
        )}
      />
      <span className="nesto-nav-label truncate">{label}</span>
      {pending ? <PendingDot className="absolute right-2 top-1/2 -translate-y-1/2 text-accent" /> : null}
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
              <p className="nesto-nav-group-label nesto-eyebrow mb-2 px-3 text-accent-strong">
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
