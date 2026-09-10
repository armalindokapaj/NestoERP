import type { Metadata } from "next";
import Link from "next/link";

import { BrandPanel } from "@/components/layout/brand-panel";
import { NestoLogo } from "@/components/layout/nesto-logo";
import { DEMO_PASSWORD, demoAccountsInRoleOrder } from "@/config/demo-company";
import { roles } from "@/config/roles";
import { isDevMode } from "@/lib/auth/dev-role";
import { DemoAccounts } from "./demo-accounts";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in",
};

/**
 * Login (spec §7; design spec §83, §84).
 *
 * Split layout on desktop — brand visual beside the form. Below the desktop
 * breakpoint the visual drops away entirely and the form stands alone (§84),
 * because a decorative panel above a login form is just something to scroll
 * past on a phone.
 *
 * Authenticated visitors never reach here — middleware sends them to /dashboard.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl } = await searchParams;

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
          <div className="w-full max-w-lg">
            <h1 className="text-section font-semibold text-fg">Welcome back</h1>
            <p className="mb-6 mt-1.5 text-body text-fg-muted">
              Sign in to continue to your workspace.
            </p>

            <LoginForm callbackUrl={callbackUrl} />

            {isDevMode ? (
              <DemoAccounts
                accounts={demoAccountsInRoleOrder.map((account) => ({
                  role: account.role,
                  code: roles[account.role].code,
                  label: roles[account.role].label,
                  email: account.email,
                }))}
                password={DEMO_PASSWORD}
              />
            ) : null}
          </div>
        </main>

        <footer className="shrink-0 px-4 py-6 sm:px-8">
          <p className="text-meta text-fg-subtle">© {new Date().getFullYear()} NESTO</p>
        </footer>
      </div>
    </div>
  );
}
