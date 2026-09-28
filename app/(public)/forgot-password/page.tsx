import type { Metadata } from "next";
import Link from "next/link";

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
  const t = await getTranslations("auth");

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
