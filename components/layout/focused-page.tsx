import Link from "next/link";
import type { ReactNode } from "react";

import { BrandPanel } from "@/components/layout/brand-panel";
import { NestoLogo } from "@/components/layout/nesto-logo";
import { cn } from "@/lib/utils/cn";

/**
 * The focused form layout (design spec §83, §84; UI-02 §7.5): the brand visual
 * beside one column that holds one task — signing in, recovering an account,
 * accepting an invitation. Below the desktop breakpoint the visual drops away
 * and the form stands alone under the logo.
 *
 * It mounts no shell: no sidebar, no workspace, no ruler and no notifications
 * exist before a session does (§7.5). So the brand panel keeps its serif
 * display type under version 2 (styles/tokens-v2.css, "Display type").
 *
 * The invitation drew this itself, tag for tag as it is here, and sign-in still
 * does (app/(public)/login/page.tsx); version 2 puts the recovery pages on it
 * too.
 */
export function FocusedFormPage({ homeLabel, children }: { /** The logo link's name, in the reader's language. */ homeLabel: string; children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,42%)_minmax(0,1fr)]">
      <BrandPanel />

      <div className="flex min-h-dvh flex-col bg-surface lg:min-h-0">
        <header className="flex h-16 shrink-0 items-center px-4 sm:px-8 lg:hidden">
          <Link href="/" aria-label={homeLabel}>
            <NestoLogo />
          </Link>
        </header>

        <main className="flex flex-1 items-center justify-center px-4 py-8 sm:px-8">
          <div className="w-full max-w-lg">{children}</div>
        </main>

        <footer className="shrink-0 px-4 py-6 sm:px-8">
          <p className="text-meta text-fg-subtle">© {new Date().getFullYear()} NESTO</p>
        </footer>
      </div>
    </div>
  );
}

/** The one heading of a focused page and the line under it, as sign-in has them. */
export function FocusedHeading({ title, description, className }: { title: ReactNode; description?: ReactNode; className?: string }) {
  return (
    <>
      <h1 className="text-section font-semibold text-fg">{title}</h1>
      {description ? <p className={cn("mb-6 mt-1.5 text-body text-fg-muted", className)}>{description}</p> : null}
    </>
  );
}

/** A quiet way out under a focused form: back to sign-in, a new link. */
export const focusedLinkClass = "text-table text-fg-muted underline-offset-4 transition-colors hover:text-fg hover:underline";
