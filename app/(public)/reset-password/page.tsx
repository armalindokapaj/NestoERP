import type { Metadata } from "next";
import Link from "next/link";

import { BrandPanel } from "@/components/layout/brand-panel";
import { NestoLogo } from "@/components/layout/nesto-logo";
import { Button } from "@/components/ui/button";
import { checkResetToken } from "@/lib/auth/password-reset";
import { getTranslations } from "@/lib/i18n/server";
import { ResetPasswordForm } from "./reset-password-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("reset.metaTitle") };
}

/**
 * Reset password (PRD #6 §56).
 *
 * The token is validated on the server before the form is rendered, so an
 * expired or already-used link says so immediately rather than after somebody
 * has typed a password twice.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const state = token ? await checkResetToken(token) : "INVALID";
  const [t, tShell] = await Promise.all([getTranslations("auth"), getTranslations("shell")]);

  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,42%)_minmax(0,1fr)]">
      <BrandPanel />

      <div className="flex min-h-dvh flex-col bg-surface lg:min-h-0">
        <header className="flex h-16 shrink-0 items-center px-4 sm:px-8 lg:hidden">
          <Link href="/" aria-label={tShell("homeLink")}>
            <NestoLogo />
          </Link>
        </header>

        <main className="flex flex-1 items-center justify-center px-4 py-8 sm:px-8">
          <div className="w-full max-w-md">
            <h1 className="text-section font-semibold text-fg">{t("reset.title")}</h1>
            <p className="mb-6 mt-1.5 text-body text-fg-muted">{t("reset.description")}</p>

            {state === "VALID" && token ? (
              <ResetPasswordForm token={token} />
            ) : (
              <div className="rounded-lg border border-line bg-surface-muted px-5 py-6 text-center">
                <p className="text-card font-semibold text-fg">
                  {state === "EXPIRED" ? t("reset.expired") : t("reset.invalid")}
                </p>
                <p className="mt-1 text-table text-fg-muted">{t("reset.linkRules")}</p>
                <Button asChild variant="secondary" className="mt-4">
                  <Link href="/forgot-password">{t("reset.requestNewLink")}</Link>
                </Button>
              </div>
            )}

            <div className="mt-6 text-center">
              <Link
                href="/login"
                className="text-table text-fg-muted underline-offset-4 transition-colors hover:text-fg hover:underline"
              >
                {t("backToLogin")}
              </Link>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
