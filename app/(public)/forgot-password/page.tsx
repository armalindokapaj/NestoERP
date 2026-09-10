import type { Metadata } from "next";
import Link from "next/link";

import { BrandPanel } from "@/components/layout/brand-panel";
import { NestoLogo } from "@/components/layout/nesto-logo";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = {
  title: "Reset password",
};

/** Password reset (spec §8). Same split composition as login (design spec §83). */
export default function ForgotPasswordPage() {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,42%)_minmax(0,1fr)]">
      <BrandPanel />

      <div className="flex min-h-dvh flex-col bg-surface lg:min-h-0">
        <header className="flex h-16 shrink-0 items-center px-4 sm:px-8 lg:hidden">
          <Link href="/" aria-label="NESTO home">
            <NestoLogo />
          </Link>
        </header>

        <main className="flex flex-1 items-center justify-center px-4 py-8 sm:px-8">
          <div className="w-full max-w-md">
            <h1 className="text-section font-semibold text-fg">Reset your password</h1>
            <p className="mb-6 mt-1.5 text-body text-fg-muted">
              Enter your email and we&apos;ll send you a reset link.
            </p>

            <ForgotPasswordForm />

            <div className="mt-6 text-center">
              <Link
                href="/login"
                className="text-table text-fg-muted underline-offset-4 transition-colors hover:text-fg hover:underline"
              >
                Back to login
              </Link>
            </div>
          </div>
        </main>

        <footer className="shrink-0 px-4 py-6 sm:px-8">
          <p className="text-meta text-fg-subtle">© {new Date().getFullYear()} NESTO</p>
        </footer>
      </div>
    </div>
  );
}
