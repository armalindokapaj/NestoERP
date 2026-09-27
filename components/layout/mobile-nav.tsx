"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { OrganizationWorkspaceHeader } from "@/components/layout/organization-workspace-header";
import { PoweredBy } from "@/components/layout/powered-by";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import type { NavigationGroup } from "@/config/navigation";

/**
 * Mobile and tablet-portrait navigation (design spec §38, §39).
 *
 * Same configuration as the desktop sidebar — one navigation model, two
 * presentations. Selecting a page navigates and closes the drawer.
 *
 * The organization header leads it, as it leads the sidebar (OW §48): pressing
 * it opens the workspace choice as a bottom sheet, and the drawer closes as a
 * switch starts. NESTO signs the foot (OW §71).
 *
 * On a phone (AUD-04 §4, MW-02): the open and close controls are 44px targets;
 * the list scrolls on its own and opens with the active module in view; a
 * navigation closes the drawer and puts focus on the page it leads to, not back
 * on the hamburger, so a keyboard or screen-reader user carries on from the top
 * of the new content. If unsaved work holds the navigation (AUD-03), the page
 * and its editor stay where they are and the prompt keeps focus.
 */
export function MobileNav({
  navigation,
  isDemo,
  footer,
}: {
  navigation: NavigationGroup[];
  isDemo: boolean;
  /** Extra controls for the foot, below sm only (the development user switcher). */
  footer?: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const pathname = usePathname();
  const t = useTranslations("shell");
  const list = React.useRef<HTMLDivElement>(null);
  // Set when the drawer closes because a destination was chosen.
  const navigated = React.useRef(false);

  // Close the drawer whenever navigation actually happens — a link, Back, or a
  // redirect — so no overlay is ever left behind over the new page.
  React.useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <button
        type="button"
        onClick={() => {
          navigated.current = false;
          setOpen(true);
        }}
        aria-label={t("openNavigation")}
        aria-expanded={open}
        className="grid size-11 place-items-center rounded-md text-fg-muted transition-colors hover:bg-hover hover:text-fg lg:hidden"
      >
        <Menu className="size-[18px]" />
      </button>

      <DrawerContent
        side="left"
        onOpenAutoFocus={() => {
          // The active module in view, inside the list's own scroll box only.
          requestAnimationFrame(() => {
            const scroller = list.current;
            const active = scroller?.querySelector<HTMLElement>('[aria-current="page"]');
            if (!scroller || !active) return;
            const box = scroller.getBoundingClientRect();
            const item = active.getBoundingClientRect();
            if (item.top < box.top || item.bottom > box.bottom) {
              scroller.scrollTop += item.top - box.top - (box.height - item.height) / 2;
            }
          });
        }}
        onCloseAutoFocus={(event) => {
          if (!navigated.current) return;
          navigated.current = false;
          event.preventDefault();
          // Another dialog took over (the unsaved-work prompt): it owns focus now.
          const owner = document.activeElement?.closest('[role="dialog"], [role="alertdialog"]');
          if (owner) return;
          const main = document.getElementById("nesto-main");
          main?.focus({ preventScroll: true });
        }}
      >
        <DrawerTitle className="sr-only">{t("navigationTitle")}</DrawerTitle>
        <div className="flex shrink-0 items-center gap-2 px-3 pb-3 pt-4" data-testid="drawer-header">
          <div className="min-w-0 flex-1">
            <OrganizationWorkspaceHeader variant="drawer" onSwitchStart={() => setOpen(false)} />
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={t("closeNavigation")}
            className="-mr-1 grid size-11 shrink-0 place-items-center rounded-md text-fg-muted transition-colors hover:bg-hover hover:text-fg"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* min-h-0: without it this flex child refuses to shrink below its
            content and pushes the footer past the bottom of the drawer. */}
        <div ref={list} className="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-testid="drawer-navigation">
          <SidebarNav
            navigation={navigation}
            onNavigate={() => {
              navigated.current = true;
              setOpen(false);
            }}
            inDrawer
          />
        </div>

        <div className="shrink-0 space-y-3 border-t border-line px-4 py-3.5">
          {footer ? <div className="sm:hidden">{footer}</div> : null}
          <PoweredBy isDemo={isDemo} version />
        </div>
      </DrawerContent>
    </Drawer>
  );
}
