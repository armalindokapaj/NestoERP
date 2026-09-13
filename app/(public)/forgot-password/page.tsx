import type { Metadata } from "next";
import Link from "next/link";

import { BrandPanel } from "@/components/layout/brand-panel";
import { NestoLogo } from "@/components/layout/nesto-logo";
import { getTranslations } from "@/lib/i18n/server";
import { ForgotPasswordForm } from "./forgot-password-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("forgot.metaTitle") };
}

/** Password reset (spec §8). Same split composition as login (design spec §83). */
export default async function ForgotPasswordPage() {
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
            <h1 className="text-section font-semibold text-fg">{t("forgot.title")}</h1>
            <p className="mb-6 mt-1.5 text-body text-fg-muted">{t("forgot.description")}</p>

            <ForgotPasswordForm />

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

        <footer className="shrink-0 px-4 py-6 sm:px-8">
          <p className="text-meta text-fg-subtle">© {new Date().getFullYear()} NESTO</p>
        </footer>
      </div>
    </div>
  );
}
