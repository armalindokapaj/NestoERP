"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Menu, X } from "lucide-react";

import { LocaleSwitch } from "@/components/i18n/locale-switch";
import { NestoLogo } from "@/components/layout/nesto-logo";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { siteNav } from "@/config/marketing";
import type { SiteCopy } from "@/lib/i18n/site";
import { cn } from "@/lib/utils/cn";

/**
 * Public site header (design spec §82).
 *
 * Deliberately separate from the application shell: a visitor who has not
 * signed in should never see product navigation, and the two lists have
 * nothing in common beyond the wordmark.
 *
 * The only client-side behaviour on the whole marketing site is this drawer,
 * the language switch and the contact form — everything else is
 * server-rendered and inert. The words arrive as props from the server layout,
 * so only the header's own strings reach the browser.
 */
export function SiteHeader({
  copy,
  nav,
  category,
}: {
  copy: SiteCopy["header"];
  nav: SiteCopy["nav"];
  category: string;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const isCurrent = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-canvas/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-5 sm:px-8">
        <Link href="/" aria-label={copy.home} className="rounded-md">
          <NestoLogo />
        </Link>

        <span aria-hidden="true" className="hidden h-4 w-px bg-line-strong xl:block" />
        <p className="nesto-eyebrow hidden whitespace-nowrap text-fg-subtle xl:block">{category}</p>

        <nav aria-label={copy.siteNavigation} className="ml-auto hidden items-center gap-7 lg:flex">
          {siteNav.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={isCurrent(link.href) ? "page" : undefined}
              className={cn(
                "whitespace-nowrap text-table font-medium transition-colors hover:text-fg",
                isCurrent(link.href) ? "text-fg" : "text-fg-muted",
              )}
            >
              {nav[link.key]}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 lg:ml-6">
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link href="/login">{copy.signIn}</Link>
          </Button>
          {/* On a phone this moves into the menu; the hero
              repeats it just below. */}
          <Button asChild size="sm" className="max-sm:hidden">
            <Link href="/contact">{copy.requestAccess}</Link>
          </Button>

          <ThemeToggle />
          <LocaleSwitch label={copy.language} />

          <Drawer open={open} onOpenChange={setOpen}>
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-label={copy.openMenu}
              className="grid size-11 shrink-0 place-items-center rounded-full text-fg transition-colors hover:bg-hover active:bg-hover lg:hidden"
            >
              <Menu aria-hidden="true" className="size-[22px]" strokeWidth={1.6} />
            </button>

            {/* The same menu as the app's hamburger: from the right, canvas ground, gold accents, rounded cards, a pinned foot. */}
            <DrawerContent side="right" className="bg-canvas">
              <DrawerTitle className="sr-only">{copy.drawerTitle}</DrawerTitle>
              <div className="flex h-14 shrink-0 items-center justify-between border-b border-accent/25 pl-4 pr-2">
                <NestoLogo />
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label={copy.closeMenu}
                  className="grid size-11 shrink-0 place-items-center rounded-full text-fg-muted transition-colors hover:bg-hover hover:text-fg"
                >
                  <X aria-hidden="true" className="size-5" strokeWidth={1.6} />
                </button>
              </div>

              <nav aria-label={copy.siteNavigation} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
                <ul className="overflow-hidden rounded-[18px] border border-line bg-surface">
                  {[...siteNav.map((link) => ({ href: link.href, label: nav[link.key] })), { href: "/faq", label: nav.faq }].map((link) => (
                    <li key={link.href} className="border-b border-line last:border-b-0">
                      <Link
                        href={link.href}
                        onClick={() => setOpen(false)}
                        aria-current={isCurrent(link.href) ? "page" : undefined}
                        className={cn(
                          "flex min-h-12 items-center justify-between gap-3 px-4 text-body font-medium transition-colors active:bg-accent-soft",
                          isCurrent(link.href) ? "bg-accent-soft text-accent-strong" : "text-fg",
                        )}
                      >
                        {link.label}
                        <ChevronRight aria-hidden="true" strokeWidth={1.6} className="size-4 shrink-0 text-accent-strong" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>

              <div className="mt-auto shrink-0 space-y-2 border-t border-accent/25 p-4">
                <Button asChild size="md" className="w-full sm:hidden">
                  <Link href="/contact" onClick={() => setOpen(false)}>
                    {copy.requestAccess}
                  </Link>
                </Button>
                <Button asChild variant="secondary" size="md" className="w-full">
                  <Link href="/login" onClick={() => setOpen(false)}>
                    {copy.signIn}
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
