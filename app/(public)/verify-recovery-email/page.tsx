import type { Metadata } from "next";

import { FocusedFormPage, FocusedHeading } from "@/components/layout/focused-page";
import { getTranslations } from "@/lib/i18n/server";
import { getDesignState } from "@/lib/layout/design-server";
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
  const [t, tShell, { version }] = await Promise.all([getTranslations("auth"), getTranslations("shell"), getDesignState()]);
  const { token } = await searchParams;
  // Version 2: the same focused layout as sign-in (UI-02 §7.5).
  if (version === "2") {
    return (
      <FocusedFormPage homeLabel={tShell("homeLink")}>
        <FocusedHeading title={t("verifyRecovery.title")} description={t("verifyRecovery.description")} />
        <VerifyRecoveryEmail token={token ?? ""} />
      </FocusedFormPage>
    );
  }
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
