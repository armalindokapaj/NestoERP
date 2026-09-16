import type { Metadata } from "next";
import Link from "next/link";

import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("forgot.metaTitle") };
}

/**
 * There is no self-service password reset in V0.1 (PRD #50 §3, §268).
 *
 * Resetting a password is an administrator's action, taken through the team
 * screens and communicated however that organisation already communicates —
 * NESTO sends no mail to make an account usable, and an installation with no
 * mail transport configured at all works exactly the same way (§18, §325).
 */
export default async function ForgotPasswordPage() {
  const t = await getTranslations("auth");

  return (
    <div className="mx-auto w-full max-w-md space-y-6 px-4 py-16">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t("forgot.title")}</h1>
        <p className="text-muted-foreground text-sm">{t("forgot.description")}</p>
      </div>
      <Link href="/login" className="text-primary text-sm font-medium underline-offset-4 hover:underline">
        {t("forgot.backToSignIn")}
      </Link>
    </div>
  );
}
