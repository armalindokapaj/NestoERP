import type { Metadata } from "next";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { NestoLogo } from "@/components/layout/nesto-logo";
import { requirePlatformContext } from "@/lib/context/platform-context";

export const metadata: Metadata = {
  title: { template: "%s · NESTO Platform", default: "NESTO Platform" },
};

/**
 * The Platform Admin's own area (E-06 §116, §128).
 *
 * Outside the application shell on purpose: the shell is built from a company
 * context, and a platform session has none. Nothing in a company's sidebar
 * links here, and nothing here links into a company.
 */
export default async function PlatformAdminLayout({ children }: { children: React.ReactNode }) {
  const context = await requirePlatformContext();

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <NestoLogo />
            <span className="rounded-md border border-line px-2 py-0.5 text-meta font-medium text-fg-muted">
              Platform
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-table text-fg-muted">{context.fullName}</span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
