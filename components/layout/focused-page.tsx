import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft } from "@/components/icons";

import { LocaleSwitch } from "@/components/i18n/locale-switch";
import { BrandPanel } from "@/components/layout/brand-panel";
import { BrandSkyline } from "@/components/layout/brand-skyline";
import { NestoLogo } from "@/components/layout/nesto-logo";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { brand } from "@/config/brand";
import { getSiteCopy } from "@/lib/i18n/server";
import { cn } from "@/lib/utils/cn";

/**
 * The focused form layout (design spec §83, §84; UI-02 §7.5; UI-05 §5): the
 * brand drawing beside one column that holds one task — signing in,
 * recovering an account, accepting an invitation. On a phone the drawing
 * shrinks to a band of skyline above the form.
 *
 * It mounts no shell: no sidebar, no workspace and no notifications exist
 * before a session does (§7.5). Only the theme and the language, which a
 * visitor may want before they sign in.
 */
export async function FocusedFormPage({ homeLabel, children }: { /** The logo link's name, in the reader's language. */ homeLabel: string; children: ReactNode }) {
  const { header } = await getSiteCopy();

  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,44%)_minmax(0,1fr)]">
      <BrandPanel />
      <div className="flex min-h-dvh flex-col bg-canvas lg:min-h-0">
        <header className="flex h-16 shrink-0 items-center gap-2 px-4 sm:px-8">
          <Link href="/" aria-label={homeLabel} className="lg:hidden">
            <NestoLogo />
          </Link>
          <Link href="/" className="hidden items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-muted transition-colors hover:text-fg lg:inline-flex">
            <ArrowLeft aria-hidden="true" className="size-3.5" />
            {homeLabel}
          </Link>
          <span className="ml-auto" />
          <ThemeToggle />
          <LocaleSwitch label={header.language} />
        </header>
        <div aria-hidden="true" className="relative h-[150px] overflow-hidden bg-[#0f141a] lg:hidden">
          <BrandSkyline className="absolute inset-x-0 bottom-0 h-[260px] w-full" />
        </div>
        <main className="flex flex-1 items-center justify-center px-4 py-10 sm:px-8">
          <div className="w-full max-w-lg">{children}</div>
        </main>
        <footer className="shrink-0 px-4 py-6 sm:px-8">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-fg-subtle">
            © {new Date().getFullYear()} {brand.name} · {brand.version}
          </p>
        </footer>
      </div>
    </div>
  );
}

/** The one heading of a focused page and the line under it, as sign-in has them. */
export function FocusedHeading({ title, description, className }: { title: ReactNode; description?: ReactNode; className?: string }) {
  return (
    <>
      <h1 className="text-[48px] leading-[0.92] text-fg sm:text-[64px] font-display">{title}</h1>
      {description ? <p className={cn("nesto-standfirst mb-8 mt-2 text-[19px] leading-snug sm:text-[21px]", className)}>{description}</p> : null}
    </>
  );
}

/** A quiet way out under a focused form: back to sign-in, a new link. */
export const focusedLinkClass = "text-table text-fg-muted underline-offset-4 transition-colors hover:text-fg hover:underline";
