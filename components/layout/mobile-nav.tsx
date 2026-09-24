"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
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
 */
export function MobileNav({
  navigation,
  isDemo,
}: {
  navigation: NavigationGroup[];
  isDemo: boolean;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const t = useTranslations("shell");

  // Close the drawer whenever navigation actually happens.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("openNavigation")}
        className="grid size-9 place-items-center rounded-md text-fg-muted transition-colors hover:bg-hover hover:text-fg lg:hidden"
      >
        <Menu className="size-[18px]" />
      </button>

      <DrawerContent side="left">
        <DrawerTitle className="sr-only">{t("navigationTitle")}</DrawerTitle>
        <div className="flex shrink-0 items-center gap-2 px-3 pb-3 pt-4" data-testid="drawer-header">
          <div className="min-w-0 flex-1">
            <OrganizationWorkspaceHeader variant="drawer" onSwitchStart={() => setOpen(false)} />
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={t("closeNavigation")}
            className="grid size-8 shrink-0 place-items-center rounded-md text-fg-muted transition-colors hover:bg-hover hover:text-fg"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* min-h-0: without it this flex child refuses to shrink below its
            content and pushes the footer past the bottom of the drawer. */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <SidebarNav navigation={navigation} onNavigate={() => setOpen(false)} inDrawer />
        </div>

        <div className="shrink-0 border-t border-line px-4 py-3.5">
          <PoweredBy isDemo={isDemo} version />
        </div>
      </DrawerContent>
    </Drawer>
  );
}
