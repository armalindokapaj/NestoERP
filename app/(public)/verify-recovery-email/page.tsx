import type { Metadata } from "next";

import { getTranslations } from "@/lib/i18n/server";
import { VerifyRecoveryEmail } from "./verify-recovery-email";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("verifyRecovery.metaTitle"), referrer: "no-referrer" };
}

type Props = { searchParams: Promise<{ token?: string }> };

/**
 * Confirms a new recovery email (ADM-01). Confirmation is a button press, not
 * the page load, so a mail scanner that opens links cannot confirm for anyone.
 */
export default async function VerifyRecoveryEmailPage({ searchParams }: Props) {
  const t = await getTranslations("auth");
  const { token } = await searchParams;
  return (
    <div className="mx-auto w-full max-w-md space-y-6 px-4 py-16">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t("verifyRecovery.title")}</h1>
        <p className="text-muted-foreground text-sm">{t("verifyRecovery.description")}</p>
      </div>
      <VerifyRecoveryEmail token={token ?? ""} />
    </div>
  );
}
