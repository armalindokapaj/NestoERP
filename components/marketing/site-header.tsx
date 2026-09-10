"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";

import { NestoLogo } from "@/components/layout/nesto-logo";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { site, siteNav } from "@/config/marketing";
import { cn } from "@/lib/utils/cn";

/**
 * Public site header (design spec §82).
 *
 * Deliberately separate from the application shell: a visitor who has not
 * signed in should never see product navigation, and the two lists have
 * nothing in common beyond the wordmark.
 *
 * The only client-side behaviour on the whole marketing site is this drawer
 * and the contact form — everything else is server-rendered and inert.
 */
export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const isCurrent = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-canvas/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-5 sm:px-8">
        <Link href="/" aria-label={`${site.category} — home`} className="rounded-md">
          <NestoLogo />
        </Link>

        <span aria-hidden="true" className="hidden h-4 w-px bg-line-strong lg:block" />
        <p className="nesto-eyebrow hidden text-fg-subtle lg:block">{site.category}</p>

        <nav aria-label="Site" className="ml-auto hidden items-center gap-7 md:flex">
          {siteNav.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={isCurrent(link.href) ? "page" : undefined}
              className={cn(
                "text-table font-medium transition-colors hover:text-fg",
                isCurrent(link.href) ? "text-fg" : "text-fg-muted",
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 md:ml-6">
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link href="/login">Sign in</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/contact">Request access</Link>
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
              <DrawerTitle className="sr-only">Site navigation</DrawerTitle>
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

              <nav aria-label="Site" className="flex flex-col gap-1 p-3">
                {siteNav.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setOpen(false)}
                    aria-current={isCurrent(link.href) ? "page" : undefined}
                    className={cn(
                      "rounded-md px-3 py-2.5 text-body font-medium transition-colors hover:bg-hover hover:text-fg",
                      isCurrent(link.href) ? "bg-hover text-fg" : "text-fg-muted",
                    )}
                  >
                    {link.label}
                  </Link>
                ))}
                <Link
                  href="/faq"
                  onClick={() => setOpen(false)}
                  className="rounded-md px-3 py-2.5 text-body font-medium text-fg-muted transition-colors hover:bg-hover hover:text-fg"
                >
                  Questions
                </Link>
              </nav>

              <div className="mt-auto border-t border-line p-3">
                <Button asChild variant="secondary" size="md" className="w-full">
                  <Link href="/login" onClick={() => setOpen(false)}>
                    Sign in
                  </Link>
                </Button>
              </div>
            </DrawerContent>
          </Drawer>
        </div>
      </div>
    </header>
  );
}
