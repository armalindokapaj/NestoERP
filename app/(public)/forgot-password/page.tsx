import type { Metadata } from "next";
import Link from "next/link";

import { FocusedFormPage, FocusedHeading, focusedLinkClass } from "@/components/layout/focused-page";
import { getTranslations } from "@/lib/i18n/server";
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
  const [t, tShell] = await Promise.all([getTranslations("auth"), getTranslations("shell")]);

  // The same focused layout as sign-in.
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
