import type { Metadata } from "next";
import Link from "next/link";

import { FocusedFormPage, FocusedHeading, focusedLinkClass } from "@/components/layout/focused-page";
import { getTranslations } from "@/lib/i18n/server";
import { getDesignState } from "@/lib/layout/design-server";
import { ForgotPasswordForm } from "./forgot-password-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("forgot.metaTitle") };
}

/**
 * Self-service recovery (ADM-01). A link goes only to a verified recovery
 * email; an account without one is reset by its administrator, as before
 * (PRD #50 §19, §20).
 */
export default async function ForgotPasswordPage() {
  const [t, tShell, { version }] = await Promise.all([getTranslations("auth"), getTranslations("shell"), getDesignState()]);

  // Version 2: the same focused layout as sign-in (UI-02 §7.5).
  if (version === "2") {
    return (
      <FocusedFormPage homeLabel={tShell("homeLink")}>
        <FocusedHeading title={t("forgot.title")} description={t("forgot.description")} />
        <ForgotPasswordForm />
        <div className="mt-6 text-center">
          <Link href="/login" className={focusedLinkClass}>
            {t("forgot.backToSignIn")}
          </Link>
        </div>
      </FocusedFormPage>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md space-y-6 px-4 py-16">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t("forgot.title")}</h1>
        <p className="text-muted-foreground text-sm">{t("forgot.description")}</p>
      </div>
      <ForgotPasswordForm />
      <Link href="/login" className="text-primary text-sm font-medium underline-offset-4 hover:underline">
        {t("forgot.backToSignIn")}
      </Link>
    </div>
  );
}
