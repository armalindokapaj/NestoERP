"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";

import { NestoLogo } from "@/components/layout/nesto-logo";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";

/**
 * Public site navigation (design spec §82).
 *
 * Deliberately separate from the ERP drawer: a visitor who has not signed in
 * should never see application navigation, and the two lists have nothing in
 * common beyond the wordmark.
 */
const LINKS = [
  { label: "Product", href: "/#platform" },
  { label: "Solutions", href: "/#teams" },
  { label: "About", href: "/#about" },
];

export function PublicNav() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <nav aria-label="Site navigation" className="ml-4 hidden items-center gap-6 md:flex">
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="text-table font-medium text-fg-muted transition-colors hover:text-fg"
          >
            {link.label}
          </Link>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-2">
        <Button asChild size="sm">
          <Link href="/login">Login</Link>
        </Button>

        <Drawer open={open} onOpenChange={setOpen}>
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            className="grid size-9 place-items-center rounded-md text-fg-muted transition-colors hover:bg-hover hover:text-fg md:hidden"
          >
            <Menu aria-hidden="true" className="size-[18px]" />
          </button>

          <DrawerContent side="left" className="bg-surface">
            <DrawerTitle className="sr-only">NESTO site navigation</DrawerTitle>
            <div className="flex h-16 items-center justify-between border-b border-line px-4">
              <NestoLogo />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="grid size-8 place-items-center rounded-md text-fg-muted transition-colors hover:bg-hover hover:text-fg"
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            </div>

            <div className="flex flex-col gap-1 p-3">
              {LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="rounded-md px-3 py-2.5 text-body font-medium text-fg-muted transition-colors hover:bg-hover hover:text-fg"
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </DrawerContent>
        </Drawer>
      </div>
    </>
  );
}
