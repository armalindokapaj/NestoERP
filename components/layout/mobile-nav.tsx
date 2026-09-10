"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { Menu, X } from "lucide-react";

import { NestoLogo } from "@/components/layout/nesto-logo";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { brand } from "@/config/brand";
import type { NavigationGroup } from "@/config/navigation";

/**
 * Mobile and tablet-portrait navigation (design spec §38, §39).
 *
 * Same configuration as the desktop sidebar — one navigation model, two
 * presentations. Selecting a page navigates and closes the drawer.
 */
export function MobileNav({
  navigation,
  companyName,
}: {
  navigation: NavigationGroup[];
  companyName: string;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close the drawer whenever navigation actually happens.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        className="grid size-9 place-items-center rounded-md text-fg-muted transition-colors hover:bg-hover hover:text-fg lg:hidden"
      >
        <Menu className="size-[18px]" />
      </button>

      <DrawerContent side="left">
        <DrawerTitle className="sr-only">NESTO navigation</DrawerTitle>
        <div className="flex shrink-0 items-start justify-between gap-3 px-4 pb-4 pt-5">
          <NestoLogo showMark={false} size="lg" tagline={brand.tagline} />
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close navigation"
            className="-mr-1 grid size-8 shrink-0 place-items-center rounded-md text-fg-muted transition-colors hover:bg-hover hover:text-fg"
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
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <p className="min-w-0 truncate text-meta font-medium text-fg">{companyName}</p>
            <span className="shrink-0 text-micro tabular-nums text-fg-subtle">{brand.version}</span>
          </div>
          <div className="flex items-center gap-2.5">
            <NestoLogo showWordmark={false} size="sm" />
            <span className="nesto-eyebrow min-w-0 flex-1 truncate text-fg-subtle">
              {brand.descriptor}
            </span>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
