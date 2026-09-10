"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { Menu, X } from "lucide-react";

import { NestoLogo } from "@/components/layout/nesto-logo";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import type { RoleKey } from "@/config/roles";

/**
 * Mobile and tablet-portrait navigation (design spec §38, §39).
 *
 * Same configuration as the desktop sidebar — one navigation model, two
 * presentations. Selecting a page navigates and closes the drawer.
 */
export function MobileNav({ role, companyName }: { role: RoleKey; companyName: string }) {
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
        <div className="flex h-14 items-center justify-between border-b border-line px-4">
          <NestoLogo />
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close navigation"
            className="grid size-8 place-items-center rounded-md text-fg-muted transition-colors hover:bg-hover hover:text-fg"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <SidebarNav role={role} onNavigate={() => setOpen(false)} inDrawer />
        </div>

        <div className="border-t border-line px-4 py-3">
          <p className="truncate text-meta text-fg-subtle">{companyName}</p>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
